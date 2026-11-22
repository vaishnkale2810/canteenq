(function () {
  'use strict';
  var C = (window.CQ = {});

  C.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  C.inr = function (n) { return '₹' + n; };
  C.ago = function (t) {
    var m = Math.floor((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m + ' min ago';
  };
  C.store = function (k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) { /* storage blocked */ }
    return null;
  };

  /* Calls the server. role is 'cust' or 'staff' (picks which saved login to use). */
  C.api = function (role, path, opts) {
    opts = opts || {};
    var tk = C.store('cq_' + role);
    var headers = { 'Content-Type': 'application/json' };
    if (tk) headers.Authorization = 'Bearer ' + tk;
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || 'Request failed');
          err.status = r.status;
          err.fields = data.fields;
          throw err;
        }
        return data;
      });
    });
  };

  C.toast = function (box, title, sub, kind, ms) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind === 'ready' ? 'ready' : 'info');
    el.innerHTML = C.esc(title) + (sub ? '<small>' + C.esc(sub) + '</small>' : '');
    el.addEventListener('click', function () { el.remove(); });
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 5000);
  };

  /* System notification and vibration, only if the person allowed it. */
  C.deviceAlert = function (title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body: body });
    } catch (e) { /* not supported */ }
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
  };
  C.askNotify = function () {
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch (e) { /* ignore */ }
  };
  C.beep = function () {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      C._ac = C._ac || new Ctx();
      var o = C._ac.createOscillator(), g = C._ac.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(C._ac.destination);
      o.start(); o.stop(C._ac.currentTime + 0.25);
    } catch (e) { /* ignore */ }
  };

  C.qr = function (url, upiId) {
    try {
      var q = qrcode(0, 'M');
      q.addData(url);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      return '<p style="color:#111;text-align:center;margin:20px 0">QR could not load.<br>Pay to UPI ID<br><b>' + C.esc(upiId) + '</b></p>';
    }
  };

  /* Live updates. onEvent gets each change; onOpen fires on every (re)connect. */
  C.connect = function (role, onEvent, onOpen) {
    var tk = C.store('cq_' + role);
    if (!tk || !window.EventSource) return null;
    var es = new EventSource('/api/events?token=' + encodeURIComponent(tk));
    es.addEventListener('change', function (e) {
      var d = null;
      try { d = JSON.parse(e.data); } catch (x) { /* ignore */ }
      onEvent(d);
    });
    es.onopen = function () { if (onOpen) onOpen(); };
    return es;
  };

  C.validate = function (role, v) {
    var e = {};
    if ((v.name || '').length < 2) e.name = 'Enter your full name.';
    if (!/^[6-9]\d{9}$/.test(v.mobile || '')) e.mobile = 'Enter a valid 10-digit mobile number.';
    if (role === 'customer' && (v.uid || '').length < 3) e.uid = 'Enter your roll number or employee ID.';
    if (role === 'staff' && !(v.pass || '')) e.pass = 'Enter the counter passcode.';
    return e;
  };

  /* Login form shared by both pages. */
  C.loginForm = function (who, form, err) {
    var isC = who === 'cust';
    form = form || {}; err = err || {};
    var v = function (k) { return C.esc(form[k] || ''); };
    return '<div class="body" style="padding:0">' +
      '<div class="hero"><div class="big">' + (isC ? 'Skip the <em>queue</em>.<br>Eat sooner.' : 'Counter <em>login</em>') + '</div>' +
      '<p>' + (isC ? 'Order from your phone, pay with a QR, get pinged when it is ready.' : 'Accept orders, mark them done, and customers get notified.') + '</p></div>' +
      '<form data-form="' + who + '" style="padding:16px;display:flex;flex-direction:column;gap:14px" novalidate>' +
      (isC ? '<div class="field"><label>I am a</label><div class="seg"><label><input type="radio" name="kind" value="Student"' + (form.kind !== 'Office' ? ' checked' : '') + '><span>Student</span></label><label><input type="radio" name="kind" value="Office"' + (form.kind === 'Office' ? ' checked' : '') + '><span>Office worker</span></label></div></div>' : '') +
      '<div class="field"><label for="f-name">Full name</label><input id="f-name" name="name" autocomplete="name" placeholder="e.g. Aarav Sharma" value="' + v('name') + '"><div class="err">' + C.esc(err.name || '') + '</div></div>' +
      '<div class="field"><label for="f-mob">Mobile number</label><input id="f-mob" name="mobile" inputmode="numeric" maxlength="10" autocomplete="tel" placeholder="10-digit number" value="' + v('mobile') + '"><div class="err">' + C.esc(err.mobile || '') + '</div></div>' +
      (isC ? '<div class="field"><label for="f-uid">Roll no. or employee ID</label><input id="f-uid" name="uid" placeholder="e.g. 22CS104 or EMP-5521" value="' + v('uid') + '"><div class="err">' + C.esc(err.uid || '') + '</div></div>'
           : '<div class="field"><label for="f-pass">Counter passcode</label><input id="f-pass" name="pass" type="password" autocomplete="current-password" placeholder="Ask the canteen owner"><div class="err">' + C.esc(err.pass || '') + '</div></div>') +
      '<button class="btn ' + (isC ? 'lime' : 'pop') + '" type="submit"' + (form.busy ? ' disabled' : '') + '>' + (isC ? 'See the menu' : 'Open the counter') + '</button>' +
      '</form></div>';
  };
  C.formValues = function (f, isCustomer) {
    var v = {
      name: f.elements.name.value.trim(),
      mobile: f.elements.mobile.value.trim(),
    };
    if (isCustomer) {
      v.uid = f.elements.uid.value.trim();
      v.kind = f.querySelector('input[name=kind]:checked').value;
    } else {
      v.pass = f.elements.pass.value;
    }
    return v;
  };
})();
