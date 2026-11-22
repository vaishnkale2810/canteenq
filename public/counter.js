(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = CQ.esc, inr = CQ.inr, ago = CQ.ago;
  var api = function (p, o) { return CQ.api('staff', p, o); };

  var S = {
    user: null, tab: 'orders', err: {}, form: {}, es: null,
    data: { menu: [], orders: [], load: { level: 'Quiet', lvl: 1, waitMin: 3, n: 0 }, config: {} },
  };

  function linesOf(o) {
    return '<ul class="lines">' + o.items.map(function (i) { return '<li>' + i.qty + '× ' + esc(i.name) + '</li>'; }).join('') + '</ul>';
  }
  function orderCard(o, btn) {
    return '<div class="card"><div class="row"><h3>' + esc(o.token) + '</h3><span class="muted">' + ago(o.paidAt || o.createdAt) + '</span></div>' +
      '<div>' + esc(o.name) + ' · <span class="muted">xxxxxx' + esc(o.mobileTail) + '</span></div>' + linesOf(o) +
      '<div class="row" style="margin-top:12px"><b class="price">' + inr(o.total) + ' paid</b>' + btn + '</div></div>';
  }
  function screen() {
    var l = S.data.load;
    var list = function (st) { return S.data.orders.filter(function (o) { return o.status === st; }); };
    var nw = list('new'), pr = list('preparing'), rd = list('ready');
    var h = '<div class="appbar"><h1>Counter · ' + esc(S.user.name) + '<br><small>' + esc(l.level) + ' · ~' + l.waitMin + ' min wait</small></h1><button class="ghost" data-act="logout">Log out</button></div><div class="body">';
    if (S.tab === 'orders') {
      h += '<div class="stats"><div class="stat s1"><b>' + nw.length + '</b>New</div><div class="stat s2"><b>' + pr.length + '</b>Preparing</div><div class="stat s3"><b>' + rd.length + '</b>Ready</div></div>';
      h += '<div class="sec"><h3>New orders</h3></div>' + (nw.length ? nw.map(function (o) { return orderCard(o, '<button class="btn pop sm" data-act="status" data-id="' + o.id + '" data-to="preparing">Accept</button>'); }).join('') : '<div class="empty">No new orders. New paid orders appear here.</div>');
      h += '<div class="sec"><h3>Preparing</h3></div>' + (pr.length ? pr.map(function (o) { return orderCard(o, '<button class="btn lime sm" data-act="status" data-id="' + o.id + '" data-to="ready">Done</button>'); }).join('') : '<div class="empty">Accepted orders you are cooking show here.</div>');
      h += '<div class="sec"><h3>Ready for pickup</h3></div>' + (rd.length ? rd.map(function (o) { return orderCard(o, '<button class="btn line sm" data-act="status" data-id="' + o.id + '" data-to="collected">Handed over</button>'); }).join('') : '<div class="empty">Nothing waiting at the counter.</div>');
    } else {
      h += '<h2>Today’s menu</h2><p class="muted" style="margin:0">Switch an item off when it runs out. Customers only see items that are on.</p>' +
        S.data.menu.map(function (m) {
          return '<div class="item ' + (m.on ? '' : 'off') + '"><div class="info"><div class="nm"><span class="vd ' + (m.veg ? '' : 'nv') + '"></span>' + esc(m.name) + '</div><div class="muted">' + m.cat + ' · ' + inr(m.price) + '</div></div><label class="sw"><input type="checkbox" data-act="stock" data-id="' + m.id + '" ' + (m.on ? 'checked' : '') + ' aria-label="' + esc(m.name) + ' available"><span></span></label></div>';
        }).join('');
    }
    h += '</div><nav class="nav"><button data-act="tab" data-tab="orders" ' + (S.tab === 'orders' ? 'aria-current="page"' : '') + '>Orders' + (nw.length ? ' <span class="badge">' + nw.length + '</span>' : '') + '</button><button data-act="tab" data-tab="menu" ' + (S.tab === 'menu' ? 'aria-current="page"' : '') + '>Menu stock</button></nav>';
    return h;
  }
  function render() {
    var el = $('#app'), b = el.querySelector('.body'), st = b ? b.scrollTop : 0;
    el.innerHTML = S.user ? screen() : CQ.loginForm('staff', S.form, S.err);
    var nb = el.querySelector('.body'); if (nb) nb.scrollTop = st;
  }

  function refresh() {
    return api('/state').then(function (d) { S.data = d; render(); }).catch(function (e) {
      if (e.status === 401) hardLogout();
    });
  }
  function onEvent(ev) {
    refresh().then(function () {
      var n = ev && ev.notify;
      if (!n) return;
      CQ.toast($('#toasts'), n.title, n.sub, 'info', 6000);
      if (n.kind === 'new') { CQ.beep(); CQ.deviceAlert(n.title, n.sub); }
    });
  }
  function start() {
    return refresh().then(function () {
      if (S.es) S.es.close();
      S.es = CQ.connect('staff', onEvent, refresh);
    });
  }
  function hardLogout() {
    CQ.store('cq_staff', null);
    if (S.es) { S.es.close(); S.es = null; }
    S.user = null; S.tab = 'orders'; S.err = {};
    render();
  }

  document.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    var v = CQ.formValues(f, false);
    S.form = { name: v.name, mobile: v.mobile };
    var e = CQ.validate('staff', v);
    if (Object.keys(e).length) { S.err = e; render(); var first = $('.err:not(:empty)'); if (first && first.previousElementSibling) first.previousElementSibling.focus(); return; }
    S.err = {};
    CQ.askNotify();
    api('/login', { method: 'POST', body: { role: 'staff', name: v.name, mobile: v.mobile, pass: v.pass } })
      .then(function (r) { CQ.store('cq_staff', r.token); S.user = r.user; S.form = {}; CQ.beep(); return start(); })
      .catch(function (x) { S.err = x.fields || { pass: x.message }; render(); });
  });

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-act]');
    if (!a) return;
    var act = a.getAttribute('data-act');
    if (act === 'stock') return;
    if (act === 'tab') { S.tab = a.getAttribute('data-tab'); render(); }
    else if (act === 'logout') api('/logout', { method: 'POST' }).catch(function () {}).then(hardLogout);
    else if (act === 'status') {
      a.disabled = true;
      api('/orders/' + a.getAttribute('data-id') + '/status', { method: 'PATCH', body: { status: a.getAttribute('data-to') } })
        .then(refresh)
        .catch(function (e) { CQ.toast($('#toasts'), e.message, '', 'info', 5000); refresh(); });
    }
  });
  document.addEventListener('change', function (ev) {
    var a = ev.target.closest('[data-act=stock]');
    if (!a) return;
    api('/menu/' + a.getAttribute('data-id'), { method: 'PATCH', body: { on: a.checked } })
      .then(refresh)
      .catch(function (e) { CQ.toast($('#toasts'), e.message, '', 'info', 5000); refresh(); });
  });

  setInterval(function () { if (S.user) refresh(); }, 30000);

  if (CQ.store('cq_staff')) {
    api('/me').then(function (r) { S.user = r.user; return start(); }).catch(function () { hardLogout(); });
  } else {
    render();
  }
})();
