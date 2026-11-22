'use strict';
/*
 * CanteenQ server. No npm dependencies: Node 18+ only.
 * - REST API for login, menu, orders, payment confirmation
 * - Server-Sent Events (/api/events) so phones update live
 * - Data saved to a JSON file (data/db.json)
 * - Serves the customer page (/) and the counter page (/counter)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const STAFF_PASS = process.env.STAFF_PASS || '1234';
const UPI_ID = process.env.UPI_ID || 'canteen@upi';
const PAYMENT_MODE = process.env.PAYMENT_MODE === 'live' ? 'live' : 'demo';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MS = 7 * 24 * 3600 * 1000;
const UNPAID_MS = 15 * 60 * 1000;
const KEEP_MS = 30 * 24 * 3600 * 1000;

const DEFAULT_MENU = [
  { id: 1, name: 'Masala Dosa', price: 60, cat: 'Meals', veg: 1 },
  { id: 2, name: 'Veg Thali', price: 90, cat: 'Meals', veg: 1 },
  { id: 3, name: 'Chole Bhature', price: 70, cat: 'Meals', veg: 1 },
  { id: 4, name: 'Chicken Biryani', price: 120, cat: 'Meals', veg: 0 },
  { id: 5, name: 'Veg Fried Rice', price: 80, cat: 'Meals', veg: 1 },
  { id: 6, name: 'Samosa (2 pcs)', price: 25, cat: 'Snacks', veg: 1 },
  { id: 7, name: 'Veg Sandwich', price: 40, cat: 'Snacks', veg: 1 },
  { id: 8, name: 'Paneer Roll', price: 65, cat: 'Snacks', veg: 1 },
  { id: 9, name: 'Egg Roll', price: 55, cat: 'Snacks', veg: 0 },
  { id: 10, name: 'Maggi', price: 45, cat: 'Snacks', veg: 1 },
  { id: 11, name: 'Cutting Chai', price: 10, cat: 'Drinks', veg: 1 },
  { id: 12, name: 'Cold Coffee', price: 50, cat: 'Drinks', veg: 1 },
  { id: 13, name: 'Fresh Lime Soda', price: 30, cat: 'Drinks', veg: 1 },
];

/* ---------------- storage ---------------- */
function freshDb() {
  return { seq: 100, menu: DEFAULT_MENU.map((m) => ({ ...m, on: true })), users: {}, sessions: {}, orders: [] };
}
function loadDb() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const base = freshDb();
    return {
      seq: Number(d.seq) || base.seq,
      menu: Array.isArray(d.menu) && d.menu.length ? d.menu : base.menu,
      users: d.users || {},
      sessions: d.sessions || {},
      orders: Array.isArray(d.orders) ? d.orders : [],
    };
  } catch (e) {
    return freshDb();
  }
}
let db = loadDb();
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    try { saveNow(); } catch (e) { console.error('Could not save data:', e.message); }
  }, 150);
}

/* ---------------- helpers ---------------- */
class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function setHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 50000) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' ? v : {});
      } catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/* simple in-memory rate limiting */
const hits = new Map();
function rateOver(key, max, windowMs, count) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  if (count) h.n++;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60000).unref();

/* ---------------- sessions ---------------- */
function newSession(role, user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[sha(token)] = { role, mobile: user.mobile, name: user.name, t: Date.now() };
  save();
  return token;
}
function sessionFrom(req, url) {
  let tk = '';
  const a = req.headers.authorization || '';
  if (a.startsWith('Bearer ')) tk = a.slice(7);
  else if (url.pathname === '/api/events') tk = url.searchParams.get('token') || '';
  if (!tk) return null;
  const key = sha(tk);
  const s = db.sessions[key];
  if (!s) return null;
  if (Date.now() - s.t > SESSION_MS) { delete db.sessions[key]; save(); return null; }
  return { ...s, key };
}

/* ---------------- orders ---------------- */
const UPI_URL = (o) =>
  `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=CanteenQ&am=${o.total}.00&cu=INR&tn=${encodeURIComponent(o.token)}`;
function pub(o, role) {
  const r = { id: o.id, token: o.token, name: o.name, items: o.items, total: o.total, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || null };
  if (role === 'staff') r.mobileTail = o.mobile.slice(-4);
  if (o.status === 'awaiting_payment') r.upiUrl = UPI_URL(o);
  return r;
}
function loadInfo() {
  const n = db.orders.filter((o) => o.status === 'new' || o.status === 'preparing').length;
  const lvl = n <= 2 ? 1 : n <= 5 ? 2 : 3;
  return { n, lvl, level: ['', 'Quiet', 'Busy', 'Rush hour'][lvl], waitMin: 3 + n * 2 };
}
function housekeeping() {
  const now = Date.now();
  let changed = false;
  for (const o of db.orders) {
    if (o.status === 'awaiting_payment' && now - o.createdAt > UNPAID_MS) { o.status = 'expired'; changed = true; }
  }
  const before = db.orders.length;
  db.orders = db.orders.filter((o) => !(['collected', 'cancelled', 'expired'].includes(o.status) && now - o.createdAt > KEEP_MS));
  if (db.orders.length !== before) changed = true;
  for (const [k, s] of Object.entries(db.sessions)) if (now - s.t > SESSION_MS) { delete db.sessions[k]; changed = true; }
  if (changed) save();
}
setInterval(housekeeping, 60000).unref();

/* ---------------- live updates (SSE) ---------------- */
const clients = new Set();
function broadcast(payload, pred) {
  const msg = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (!pred || pred(c.session)) { try { c.res.write(msg); } catch (e) { clients.delete(c); } }
  }
}
function tellOrder(o, status, custNotify, staffNotify) {
  const base = { type: 'order', orderId: o.id, status };
  broadcast({ ...base, notify: custNotify || null }, (s) => s.role === 'customer' && s.mobile === o.mobile);
  broadcast({ ...base, notify: staffNotify || null }, (s) => s.role === 'staff');
}
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch (e) { clients.delete(c); } } }, 25000).unref();

function markPaid(o) {
  o.status = 'new';
  o.paidAt = Date.now();
  save();
  const n = o.items.reduce((s, i) => s + i.qty, 0);
  tellOrder(o, 'new',
    { kind: 'info', title: 'Payment received', sub: `Order ${o.token} sent to the canteen.` },
    { kind: 'new', title: `New order ${o.token}`, sub: `${n} item${n > 1 ? 's' : ''} · ₹${o.total}` });
}

/* ---------------- validation ---------------- */
function validateLogin(b, role) {
  const fields = {};
  const name = String(b.name || '').trim();
  const mobile = String(b.mobile || '').trim();
  if (name.length < 2 || name.length > 60) fields.name = 'Enter your full name.';
  if (!/^[6-9]\d{9}$/.test(mobile)) fields.mobile = 'Enter a valid 10-digit mobile number.';
  let uid = '';
  let kind = 'Student';
  if (role === 'customer') {
    uid = String(b.uid || '').trim();
    if (uid.length < 3 || uid.length > 30) fields.uid = 'Enter your roll number or employee ID.';
    kind = b.kind === 'Office' ? 'Office' : 'Student';
  }
  return { fields, name, mobile, uid, kind };
}
const NEXT = { new: 'preparing', preparing: 'ready', ready: 'collected' };

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = req.socket.remoteAddress || 'x';

  if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true });

  if (p === '/api/payments/webhook' && m === 'POST') {
    // Connect your payment provider here. Verify the provider's own signature in production.
    if (!WEBHOOK_SECRET) throw new HttpError(404, 'Webhook is not enabled');
    if (!safeEqual(req.headers['x-webhook-secret'] || '', WEBHOOK_SECRET)) throw new HttpError(403, 'Bad secret');
    const b = await readJson(req);
    const o = db.orders.find((x) => x.id === Number(b.orderId));
    if (!o) throw new HttpError(404, 'Order not found');
    if (Number(b.amount) !== o.total) throw new HttpError(400, 'Amount does not match the order');
    if (o.status === 'awaiting_payment') markPaid(o);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/login' && m === 'POST') {
    if (rateOver('login:' + ip, 40, 60000, true)) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
    const b = await readJson(req);
    const role = b.role === 'staff' ? 'staff' : 'customer';
    const v = validateLogin(b, role);
    if (Object.keys(v.fields).length) throw new HttpError(400, 'Check the highlighted fields.', v.fields);
    if (role === 'staff') {
      if (rateOver('staff-fail:' + ip, 5, 60000, false)) throw new HttpError(429, 'Too many wrong passcodes. Try again in a minute.');
      if (!safeEqual(b.pass || '', STAFF_PASS)) {
        rateOver('staff-fail:' + ip, 5, 60000, true);
        throw new HttpError(401, 'Wrong passcode.', { pass: 'Wrong passcode.' });
      }
      const user = { name: v.name, mobile: v.mobile };
      return send(res, 200, { token: newSession('staff', user), user });
    }
    const user = { name: v.name, mobile: v.mobile, uid: v.uid, kind: v.kind };
    db.users[v.mobile] = user;
    return send(res, 200, { token: newSession('customer', user), user });
  }

  const s = sessionFrom(req, url);
  if (!s) throw new HttpError(401, 'Please log in again.');

  if (p === '/api/logout' && m === 'POST') { delete db.sessions[s.key]; save(); return send(res, 200, { ok: true }); }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: { name: s.name, mobile: s.mobile, role: s.role, ...(db.users[s.mobile] || {}) } });

  if (p === '/api/state' && m === 'GET') {
    housekeeping();
    const customer = s.role === 'customer';
    const menu = customer ? db.menu.filter((x) => x.on) : db.menu;
    const orders = customer
      ? db.orders.filter((o) => o.mobile === s.mobile).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
      : db.orders.filter((o) => ['new', 'preparing', 'ready'].includes(o.status)).sort((a, b) => a.paidAt - b.paidAt);
    return send(res, 200, { config: { paymentMode: PAYMENT_MODE, upiId: UPI_ID }, menu, load: loadInfo(), orders: orders.map((o) => pub(o, s.role)) });
  }

  if (p === '/api/events' && m === 'GET') {
    if (clients.size >= 2000) throw new HttpError(503, 'Too many connections');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const c = { res, session: s };
    clients.add(c);
    req.on('close', () => clients.delete(c));
    return;
  }

  if (p === '/api/orders' && m === 'POST') {
    if (s.role !== 'customer') throw new HttpError(403, 'Only customers can place orders.');
    const b = await readJson(req);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw new HttpError(400, 'Add at least one item.');
    const qty = new Map();
    for (const it of b.items) {
      const id = Number(it && it.id);
      const q = Number(it && it.qty);
      if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1 || q > 20) throw new HttpError(400, 'Invalid item or quantity.');
      qty.set(id, (qty.get(id) || 0) + q);
    }
    const items = [];
    for (const [id, q] of qty) {
      const mi = db.menu.find((x) => x.id === id);
      if (!mi || !mi.on) throw new HttpError(400, 'An item in your cart is no longer available.');
      if (q > 20) throw new HttpError(400, 'Maximum 20 of one item.');
      items.push({ id: mi.id, name: mi.name, price: mi.price, qty: q });
    }
    const open = db.orders.filter((o) => o.mobile === s.mobile && o.status === 'awaiting_payment');
    for (const o of open) o.status = 'cancelled';
    const id = ++db.seq;
    const o = {
      id, token: 'T-' + id, name: s.name, mobile: s.mobile, items,
      total: items.reduce((t, i) => t + i.price * i.qty, 0),
      status: 'awaiting_payment', createdAt: Date.now(), paidAt: null,
    };
    db.orders.push(o);
    save();
    return send(res, 201, { order: pub(o, 'customer') });
  }

  const om = /^\/api\/orders\/(\d+)\/(pay|cancel|status)$/.exec(p);
  if (om) {
    const o = db.orders.find((x) => x.id === Number(om[1]));
    const action = om[2];
    if (action === 'status') {
      if (m !== 'PATCH') throw new HttpError(405, 'Method not allowed');
      if (s.role !== 'staff') throw new HttpError(403, 'Only canteen staff can do this.');
      const b = await readJson(req);
      if (!o) throw new HttpError(404, 'Order not found');
      if (NEXT[o.status] !== b.status) throw new HttpError(409, 'That order cannot move to that status.');
      o.status = b.status;
      save();
      if (b.status === 'preparing') tellOrder(o, 'preparing', { kind: 'info', title: `Order ${o.token} accepted`, sub: 'The kitchen has started on it.' });
      else if (b.status === 'ready') tellOrder(o, 'ready', { kind: 'ready', title: `Order ${o.token} is ready!`, sub: 'Come to the counter and collect it.' });
      else tellOrder(o, 'collected', null);
      return send(res, 200, { order: pub(o, 'staff') });
    }
    if (m !== 'POST') throw new HttpError(405, 'Method not allowed');
    if (s.role !== 'customer') throw new HttpError(403, 'Only customers can do this.');
    if (!o || o.mobile !== s.mobile) throw new HttpError(404, 'Order not found');
    if (o.status !== 'awaiting_payment') throw new HttpError(409, 'This order is no longer waiting for payment.');
    if (action === 'pay') {
      if (PAYMENT_MODE !== 'demo') throw new HttpError(403, 'Payment is confirmed automatically by the bank.');
      markPaid(o);
    } else {
      o.status = 'cancelled';
      save();
    }
    return send(res, 200, { order: pub(o, 'customer') });
  }

  const mm = /^\/api\/menu\/(\d+)$/.exec(p);
  if (mm && m === 'PATCH') {
    if (s.role !== 'staff') throw new HttpError(403, 'Only canteen staff can do this.');
    const b = await readJson(req);
    const item = db.menu.find((x) => x.id === Number(mm[1]));
    if (!item) throw new HttpError(404, 'Item not found');
    if (typeof b.on !== 'boolean') throw new HttpError(400, 'Send on: true or false.');
    item.on = b.on;
    save();
    broadcast({ type: 'menu' });
    return send(res, 200, { item });
  }

  throw new HttpError(404, 'Not found');
}

/* ---------------- static files ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, { error: 'Bad request' }); }
  if (rel.includes('\0')) return send(res, 400, { error: 'Bad request' });
  if (rel === '/') rel = '/index.html';
  else if (rel === '/counter') rel = '/counter.html';
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  setHeaders(res);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) {
      if (!res.headersSent) return send(res, e.status, { error: e.message, fields: e.fields });
      return;
    }
    console.error(e);
    if (!res.headersSent) return send(res, 500, { error: 'Something went wrong on the server.' });
  }
});

function shutdown() { try { saveNow(); } catch (e) { /* ignore */ } process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`CanteenQ running on http://localhost:${PORT}  (counter: /counter)`);
  console.log(`Payment mode: ${PAYMENT_MODE}${PAYMENT_MODE === 'demo' ? ' (the "I have paid" button confirms payment)' : ''}`);
  if (STAFF_PASS === '1234') console.log('Warning: using the default staff passcode 1234. Set STAFF_PASS before real use.');
});
