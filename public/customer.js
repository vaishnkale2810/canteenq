(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = CQ.esc, inr = CQ.inr, ago = CQ.ago;
  var api = function (p, o) { return CQ.api('cust', p, o); };

  var S = {
    user: null, screen: 'menu', tab: 'menu', cat: 'All', cart: {}, payId: null, lastId: null,
    busy: false, err: {}, form: {}, es: null,
    data: { menu: [], orders: [], load: { level: 'Quiet', lvl: 1, waitMin: 3, n: 0 }, config: { paymentMode: 'demo', upiId: '' } },
  };

  /* ---------- helpers ---------- */
  var menuItem = function (id) { return S.data.menu.filter(function (m) { return m.id === id; })[0]; };
  var order = function (id) { return S.data.orders.filter(function (o) { return o.id === id; })[0]; };
  var myOrders = function () {
    return S.data.orders.filter(function (o) { return ['new', 'preparing', 'ready', 'collected'].indexOf(o.status) > -1; });
  };
  function cartItems() {
    return Object.keys(S.cart).map(function (k) {
      var m = menuItem(+k), q = S.cart[k];
      return m && q > 0 ? { id: m.id, name: m.name, price: m.price, qty: q } : null;
    }).filter(Boolean);
  }
  var cartTotal = function () { return cartItems().reduce(function (s, i) { return s + i.price * i.qty; }, 0); };
  var cartCount = function () { return cartItems().reduce(function (s, i) { return s + i.qty; }, 0); };
  var statusText = function (s) {
    return { new: 'Waiting for the canteen to accept', preparing: 'Being prepared now', ready: 'Ready. Come and collect it', collected: 'Collected. Enjoy!' }[s] || s;
  };
  var statusIdx = function (s) { return { new: 0, preparing: 1, ready: 2, collected: 3 }[s]; };
  function errToast(e) { CQ.toast($('#toasts'), e.message || 'Something went wrong', '', 'info', 5000); }

  /* ---------- screens ---------- */
  function bar(title, back) {
    return '<div class="appbar">' + (back ? '<button class="ghost" data-act="back" aria-label="Back">← Back</button>' : '') +
      '<h1>' + esc(title) + '</h1>' + (back ? '' : '<button class="ghost" data-act="logout">Log out</button>') + '</div>';
  }
  function nav() {
    var rdy = myOrders().filter(function (o) { return o.status === 'ready'; }).length;
    return '<nav class="nav"><button data-act="tab" data-tab="menu" ' + (S.tab === 'menu' ? 'aria-current="page"' : '') + '>Menu</button>' +
      '<button data-act="tab" data-tab="orders" ' + (S.tab === 'orders' ? 'aria-current="page"' : '') + '>My orders' + (rdy ? ' <span class="badge">' + rdy + ' ready</span>' : '') + '</button></nav>';
  }
  function menuScreen() {
    var l = S.data.load, cats = ['All', 'Meals', 'Snacks', 'Drinks'];
    var items = S.data.menu.filter(function (m) { return S.cat === 'All' || m.cat === S.cat; });
    return bar('Hi, ' + S.user.name.split(' ')[0] + ' · ' + S.user.kind) + '<div class="body">' +
      '<div class="load"><div><b>' + esc(l.level) + ' at the counter</b>About ' + l.waitMin + ' min wait · ' + l.n + ' order' + (l.n === 1 ? '' : 's') + ' ahead</div>' +
      '<div class="meter" aria-hidden="true"><i class="' + (l.lvl >= 1 ? 'on' : '') + '"></i><i class="' + (l.lvl >= 2 ? 'on' : '') + '"></i><i class="' + (l.lvl >= 3 ? 'on' : '') + '"></i></div></div>' +
      '<div class="chips" role="group" aria-label="Filter menu">' + cats.map(function (k) {
        return '<button data-act="cat" data-cat="' + k + '" aria-pressed="' + (S.cat === k) + '">' + k + '</button>';
      }).join('') + '</div>' +
      (items.length ? items.map(function (m) {
        var q = S.cart[m.id] || 0;
        return '<div class="item"><div class="tile ' + m.cat + '" aria-hidden="true">' + esc(m.name[0]) + '</div><div class="info"><div class="nm"><span class="vd ' + (m.veg ? '' : 'nv') + '" title="' + (m.veg ? 'Veg' : 'Non-veg') + '"></span>' + esc(m.name) + '</div><div class="price">' + inr(m.price) + '</div></div>' +
          (q ? '<div class="step"><button data-act="dec" data-id="' + m.id + '" aria-label="Remove one ' + esc(m.name) + '">−</button><b>' + q + '</b><button data-act="inc" data-id="' + m.id + '" aria-label="Add one ' + esc(m.name) + '">+</button></div>'
             : '<button class="add" data-act="inc" data-id="' + m.id + '" aria-label="Add ' + esc(m.name) + ' to cart">Add</button>') + '</div>';
      }).join('') : '<div class="empty">Nothing available in this section right now.</div>') +
      (cartCount() ? '<button class="cartbar" data-act="cart"><span>View cart · ' + cartCount() + ' item' + (cartCount() > 1 ? 's' : '') + '</span><span>' + inr(cartTotal()) + '</span></button>' : '') +
      '</div>' + nav();
  }
  function cartScreen() {
    var its = cartItems();
    return bar('Your cart', true) + '<div class="body">' + (its.length ? its.map(function (i) {
      return '<div class="item"><div class="info"><div class="nm">' + esc(i.name) + '</div><div class="muted">' + inr(i.price) + ' each</div></div><div class="step"><button data-act="dec" data-id="' + i.id + '" aria-label="Remove one ' + esc(i.name) + '">−</button><b>' + i.qty + '</b><button data-act="inc" data-id="' + i.id + '" aria-label="Add one ' + esc(i.name) + '">+</button></div><div class="price" style="min-width:56px;text-align:right">' + inr(i.price * i.qty) + '</div></div>';
    }).join('') +
      '<div class="card row"><span>Total to pay</span><span class="amt" style="font-size:1.8rem">' + inr(cartTotal()) + '</span></div>' +
      '<button class="btn" data-act="pay" style="margin-top:auto" ' + (S.busy ? 'disabled' : '') + '>' + (S.busy ? '<span class="spin"></span> Preparing payment…' : 'Pay ' + inr(cartTotal()) + ' with QR') + '</button>'
      : '<div class="empty">Your cart is empty. Go back and pick something tasty.</div>') + '</div>';
  }
  function payScreen(o) {
    var live = S.data.config.paymentMode === 'live';
    return bar('Scan to pay', true) + '<div class="body">' +
      '<div class="amt">' + inr(o.total) + '</div><div class="qrbox" role="img" aria-label="UPI payment QR code for ' + inr(o.total) + '">' + CQ.qr(o.upiUrl, S.data.config.upiId) + '</div>' +
      '<p class="muted" style="text-align:center;margin:0">Order <b>' + esc(o.token) + '</b>. Open GPay, PhonePe, Paytm or any UPI app and scan.<br>UPI ID: <b>' + esc(S.data.config.upiId) + '</b></p>' +
      (live ? '<div class="btn lime" role="status"><span class="spin"></span> Waiting for payment confirmation…</div><div class="hint">This screen updates by itself once the bank confirms the payment.</div>'
            : '<button class="btn lime" data-act="paid" ' + (S.busy ? 'disabled' : '') + '>' + (S.busy ? '<span class="spin"></span> Checking payment…' : 'I have paid') + '</button><div class="hint">Demo mode: tap the button after scanning. Set PAYMENT_MODE=live on the server to wait for real payment confirmation.</div>') + '</div>';
  }
  function linesOf(o) {
    return '<ul class="lines">' + o.items.map(function (i) { return '<li>' + i.qty + '× ' + esc(i.name) + '</li>'; }).join('') + '</ul>';
  }
  function tracker(o) {
    var i = statusIdx(o.status), steps = ['Placed', 'Preparing', 'Ready'];
    return '<div class="track">' + steps.map(function (s, k) {
      return '<div class="' + (k <= i ? 'on ' : '') + (k === i && i < 3 ? 'now' : '') + '">' + s + '</div>';
    }).join('') + '</div>';
  }
  function doneScreen(o) {
    return bar('Order confirmed') + '<div class="body">' +
      '<div class="token"><small>Payment successful</small><div class="t">' + esc(o.token) + '</div><small>Show this number at the counter</small></div>' +
      (o.status === 'ready' ? '<div class="readybanner"><b>Your order is ready!</b>Come to the counter and collect it.</div>'
        : '<div class="card"><div class="row"><b>' + statusText(o.status) + '</b><span class="pill ' + o.status + '">' + o.status + '</span></div>' + (o.status === 'collected' ? '' : tracker(o)) + '</div>') +
      '<div class="card"><div class="row"><b>Order summary</b><b>' + inr(o.total) + '</b></div>' + linesOf(o) + '</div>' +
      '<button class="btn" data-act="newmenu" style="margin-top:auto">Back to menu</button></div>' + nav();
  }
  function ordersScreen() {
    var mine = myOrders();
    return bar('My orders') + '<div class="body">' + (mine.length ? mine.map(function (o) {
      return '<div class="card" style="' + (o.status === 'ready' ? 'border:3px solid var(--lime)' : '') + '"><div class="row"><h3>' + esc(o.token) + '</h3><span class="pill ' + o.status + '">' + o.status + '</span></div>' +
        '<div class="muted">' + ago(o.paidAt || o.createdAt) + ' · ' + inr(o.total) + '</div>' + linesOf(o) +
        (o.status === 'ready' ? '<div class="readybanner" style="margin-top:10px"><b>Ready to collect</b>Show ' + esc(o.token) + ' at the counter.</div>' : o.status !== 'collected' ? tracker(o) : '') + '</div>';
    }).join('') : '<div class="empty">No orders yet. Your orders and their status will show up here.</div>') + '</div>' + nav();
  }

  function render() {
    var el = $('#app'), b = el.querySelector('.body'), st = b ? b.scrollTop : 0, h;
    if (!S.user) {
      h = CQ.loginForm('cust', S.form, S.err);
    } else {
      if (S.screen === 'pay') {
        var po = order(S.payId);
        if (!po) S.screen = 'menu';
        else if (po.status === 'cancelled' || po.status === 'expired') { S.screen = 'cart'; }
        else if (po.status !== 'awaiting_payment') { S.screen = 'done'; S.lastId = po.id; S.cart = {}; }
      }
      if (S.screen === 'cart') h = cartScreen();
      else if (S.screen === 'pay') h = payScreen(order(S.payId));
      else if (S.screen === 'done' && order(S.lastId)) h = doneScreen(order(S.lastId));
      else h = S.tab === 'orders' ? ordersScreen() : menuScreen();
    }
    el.innerHTML = h;
    var nb = el.querySelector('.body'); if (nb) nb.scrollTop = st;
  }

  /* ---------- data + live updates ---------- */
  function refresh() {
    return api('/state').then(function (d) { S.data = d; render(); }).catch(function (e) {
      if (e.status === 401) hardLogout();
    });
  }
  function onEvent(ev) {
    refresh().then(function () {
      var n = ev && ev.notify;
      if (!n) return;
      CQ.toast($('#toasts'), n.title, n.sub, n.kind, n.kind === 'ready' ? 10000 : 5000);
      if (n.kind === 'ready') CQ.deviceAlert(n.title, n.sub);
    });
  }
  function start() {
    return refresh().then(function () {
      if (S.es) S.es.close();
      S.es = CQ.connect('cust', onEvent, refresh);
      myOrders().filter(function (o) { return o.status === 'ready'; }).forEach(function (o) {
        CQ.toast($('#toasts'), 'Order ' + o.token + ' is ready!', 'Come to the counter and collect it.', 'ready', 10000);
      });
    });
  }
  function hardLogout() {
    CQ.store('cq_cust', null);
    if (S.es) { S.es.close(); S.es = null; }
    S.user = null; S.cart = {}; S.screen = 'menu'; S.tab = 'menu'; S.err = {};
    render();
  }

  /* ---------- events ---------- */
  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    var v = CQ.formValues(f, true);
    S.form = v;
    var e = CQ.validate('customer', v);
    if (Object.keys(e).length) { S.err = e; render(); var first = $('.err:not(:empty)'); if (first && first.previousElementSibling) first.previousElementSibling.focus(); return; }
    S.err = {};
    CQ.askNotify();
    api('/login', { method: 'POST', body: { role: 'customer', name: v.name, mobile: v.mobile, uid: v.uid, kind: v.kind } })
      .then(function (r) { CQ.store('cq_cust', r.token); S.user = r.user; S.form = {}; return start(); })
      .catch(function (x) { S.err = x.fields || { name: x.message }; render(); });
  });

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-act]');
    if (!a) return;
    var act = a.getAttribute('data-act'), id = +a.getAttribute('data-id');
    switch (act) {
      case 'cat': S.cat = a.getAttribute('data-cat'); render(); break;
      case 'inc': S.cart[id] = (S.cart[id] || 0) + 1; render(); break;
      case 'dec': S.cart[id] = Math.max(0, (S.cart[id] || 0) - 1); if (!S.cart[id]) delete S.cart[id]; render(); break;
      case 'cart': S.screen = 'cart'; render(); break;
      case 'back':
        if (S.screen === 'pay' && S.payId) api('/orders/' + S.payId + '/cancel', { method: 'POST' }).catch(function () {});
        S.screen = S.screen === 'pay' ? 'cart' : 'menu'; render(); break;
      case 'pay':
        if (S.busy || !cartCount()) break;
        S.busy = true; render();
        api('/orders', { method: 'POST', body: { items: cartItems().map(function (i) { return { id: i.id, qty: i.qty }; }) } })
          .then(function (r) { S.payId = r.order.id; return refresh(); })
          .then(function () { S.screen = 'pay'; })
          .catch(function (e) { errToast(e); refresh(); })
          .then(function () { S.busy = false; render(); });
        break;
      case 'paid':
        if (S.busy) break;
        S.busy = true; render();
        api('/orders/' + S.payId + '/pay', { method: 'POST' })
          .then(refresh)
          .catch(function (e) { errToast(e); })
          .then(function () { S.busy = false; render(); });
        break;
      case 'newmenu': S.screen = 'menu'; S.tab = 'menu'; render(); break;
      case 'tab': S.tab = a.getAttribute('data-tab'); S.screen = 'menu'; render(); break;
      case 'logout': api('/logout', { method: 'POST' }).catch(function () {}).then(hardLogout); break;
    }
  });

  setInterval(function () { if (S.user && !S.busy) render(); }, 30000);

  /* ---------- boot ---------- */
  if (CQ.store('cq_cust')) {
    api('/me').then(function (r) { S.user = r.user; return start(); }).catch(function () { hardLogout(); });
  } else {
    render();
  }
})();
