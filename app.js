/* Desk app — Plan B (read-only). Polls d/{DATA_PATH}/state.json, chart.json, activity.json, coin/{mint}.json.
   DATA_PATH comes from the #d= fragment once, then localStorage. No APP_TOKEN. Settings/pause go via Telegram. */
(function () {
  'use strict';
  var POLL_MS = 15000, STALE_S = 900, REF = 'r=savipww';
  var AGENTS = [
    { id: 'scanner', name: 'Scanner', n: 1, hb: ['scanner', 'scanner_ws'] },
    { id: 'auditor', name: 'Auditor', n: 2, hb: ['auditor'] },
    { id: 'analyst', name: 'Analyst', n: 3, hb: ['analyst'] },
    { id: 'executor', name: 'Executor', n: 4, hb: ['executor'] },
    { id: 'risk', name: 'Risk', n: 5, hb: ['risk'] }
  ];
  var LAYERS = [
    ['L1_mint_authority', 'Mint authority revoked'], ['L2_freeze_authority', 'Freeze authority revoked'],
    ['L3_dev_wallet', 'Dev wallet < 5% · never sold'], ['L4_top10', 'Top 10 holders < 25%'],
    ['L5_lp_locked', 'LP burned/locked ≥ 99%'], ['L6_pool_age', 'Pool age ≥ 10 min'],
    ['L7_bundles', 'Bundled wallets < 5'], ['L8_delegations', 'No delegate over 10 accounts']
  ];
  var RANGES = [['1H', 3600], ['1D', 86400], ['1W', 604800], ['1M', 2592000], ['ALL', 0]];

  // ---------- data path ----------
  function readPath() {
    var h = location.hash.replace(/^#/, ''), m = {};
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) m[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (m.d && /^[A-Za-z0-9_-]{16,}$/.test(m.d)) localStorage.setItem('desk.data_path', m.d);
    if (h) history.replaceState(null, '', location.pathname + location.search);   // keep path out of the URL bar
    localStorage.removeItem('APP_TOKEN');   // Plan B never needs it
    var legacy = localStorage.getItem('DATA_PATH');
    if (legacy && !localStorage.getItem('desk.data_path')) localStorage.setItem('desk.data_path', legacy);
    localStorage.removeItem('DATA_PATH');
    return localStorage.getItem('desk.data_path');
  }
  var DP = readPath();
  var base = function () { return 'd/' + DP + '/'; };

  // ---------- state ----------
  var S = { state: null, chart: null, activity: null, coins: {}, err: null, lastOk: 0, loading: true,
            tab: 'home', stack: [], range: '1D', actFilter: 'all', scrub: null };
  var chart = null, timer = null;

  // ---------- helpers ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(v, d) { if (v == null || !isFinite(v)) return '–'; var a = Math.abs(v); d = d == null ? 2 : d;
    return (v < 0 ? '-' : '') + '$' + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sUsd(v) { return (v > 0 ? '+' : v < 0 ? '-' : '') + usd(Math.abs(v || 0)); }
  function pct(v, d) { if (v == null || !isFinite(v)) return '–'; return (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%'; }
  function price(v) { if (v == null || !isFinite(v)) return '–'; if (v >= 1) return '$' + v.toFixed(4);
    var s = v.toPrecision(4); return '$' + (s.indexOf('e') > -1 ? Number(s).toFixed(10).replace(/0+$/, '') : s); }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'muted'; }
  function ago(ts) { if (!ts) return '–'; var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return Math.round(s) + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; }
  function hhmm(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function short(m) { return m ? m.slice(0, 4) + '…' + m.slice(-4) : ''; }
  function sym(x) { return x && (x.symbol || x.coin && x.coin.symbol) || short(x && x.mint); }
  function initials(s) { return esc((s || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'); }
  function fomoOk(u) { return typeof u === 'string' && /^https:\/\//.test(u) && u.indexOf(REF) > -1 && u.indexOf('fomo.family') > -1; }
  var CHEV = '<svg class="chev" width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  // ---------- fetch ----------
  function get(name) {
    return fetch(base() + name + '?_=' + Date.now(), { cache: 'no-store', credentials: 'omit' }).then(function (r) {
      if (!r.ok) { var e = new Error(r.status === 404 ? 'not found' : 'HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function poll() {
    if (!DP) return render();
    var jobs = [get('state.json'), get('chart.json'), get('activity.json')];
    var cur = top();
    if (cur && cur.view === 'coin') jobs.push(get('coin/' + encodeURIComponent(cur.mint) + '.json').catch(function (e) { return { _err: e.message }; }));
    Promise.all(jobs).then(function (r) {
      S.state = r[0]; S.chart = r[1]; S.activity = r[2];
      if (r[3]) S.coins[cur.mint] = r[3];
      S.err = null; S.lastOk = Date.now(); S.loading = false;
      try { localStorage.setItem('desk.cache', JSON.stringify({ state: r[0], chart: r[1], activity: r[2], at: Date.now() })); } catch (e) {}
      render();
    }).catch(function (e) { S.err = e; S.loading = false; render(); });
  }
  function schedule() { clearInterval(timer); timer = setInterval(function () { if (!document.hidden) poll(); }, POLL_MS); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  (function warm() { try { var c = JSON.parse(localStorage.getItem('desk.cache') || 'null');
    if (c && DP) { S.state = c.state; S.chart = c.chart; S.activity = c.activity; S.lastOk = c.at; } } catch (e) {} })();

  // ---------- navigation ----------
  function top() { return S.stack[S.stack.length - 1]; }
  function go(v) { S.stack.push(v); history.pushState({ d: S.stack.length }, ''); render(true); if (v.view === 'coin') poll(); }
  function back() { if (S.stack.length) history.back(); }
  window.addEventListener('popstate', function () { if (S.stack.length) { S.stack.pop(); render(true); } });
  function setTab(t) { S.tab = t; while (S.stack.length) { S.stack.pop(); } render(true); }
  document.querySelectorAll('#tabbar button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  $('#back').onclick = back;
  window.addEventListener('scroll', function () { $('#topbar').classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-go]'); if (!a) return;
    var g = a.dataset.go;
    if (g === 'tab') return setTab(a.dataset.tab);
    if (g === 'coin') return go({ view: 'coin', mint: a.dataset.mint });
    if (g === 'auditor') return go({ view: 'auditor' });
    if (g === 'range') { S.range = a.dataset.r; return render(); }
    if (g === 'filter') { S.actFilter = a.dataset.f; return render(); }
    if (g === 'retry') { S.loading = true; render(); return poll(); }
    if (g === 'forget') { if (confirm('Forget this desk on this device?')) { localStorage.removeItem('desk.data_path'); localStorage.removeItem('desk.cache'); DP = null; S.state = null; render(); } }
  });

  // ---------- chrome ----------
  function chrome(title) {
    var st = S.state, cur = top();
    $('#title').textContent = title;
    $('#back').classList.toggle('hidden', !cur);
    var b = '';
    if (st) {
      b += st.mode === 'LIVE' ? '<span class="badge live">LIVE</span>' : '<span class="badge paper">PAPER</span>';
      if (st.paused) b += '<span class="badge paused">PAUSED</span>';
    }
    $('#badges').innerHTML = b;
    document.querySelectorAll('#tabbar button').forEach(function (x) { x.classList.toggle('active', x.dataset.tab === S.tab); });
    var ban = $('#banner'), msg = '', err = false;
    if (S.err && S.state) { msg = 'Can’t reach desk data (' + esc(S.err.message) + ') · showing ' + ago(S.lastOk / 1000); err = true; }
    else if (st && Date.now() / 1000 - st.updated_at > STALE_S) msg = 'Desk data is ' + ago(st.updated_at).replace(' ago', '') + ' old — the desk may be offline';
    ban.innerHTML = msg; ban.className = msg ? (err ? 'err' : '') : 'hidden';
    document.body.classList.toggle('has-banner', !!msg);
  }

  function stateBox(kind, h, p, btn) {
    return '<div class="state-box">' + (kind === 'loading' ? '<div class="spinner"></div>' : '') +
      (h ? '<h2>' + h + '</h2>' : '') + (p ? '<p>' + p + '</p>' : '') + (btn || '') + '</div>';
  }

  // ---------- render ----------
  function render(scrollTop) {
    var v = $('#view'), cur = top();
    if (!DP) { chrome('Desk'); v.innerHTML = stateBox('empty', 'Connect your desk',
      'Open the private desk link from Telegram once (it ends in <span class="mono">#d=…</span>). It stays saved on this device.'); return; }
    if (!S.state) {
      chrome('Desk');
      if (S.err) v.innerHTML = stateBox('error', 'Can’t load desk', esc(S.err.status === 404 ? 'No data at this link yet. If the desk just started, it publishes every ~6 min.' : S.err.message),
        '<button class="btn ghost" style="flex:0 0 auto;padding:0 28px" data-go="retry">Try again</button>');
      else v.innerHTML = stateBox('loading', '', 'Loading desk…');
      return;
    }
    var html, title;
    if (cur && cur.view === 'coin') { title = sym(S.coins[cur.mint] || findCoin(cur.mint)) || 'Coin'; html = coinView(cur.mint); }
    else if (cur && cur.view === 'auditor') { title = 'Auditor'; html = auditorView(); }
    else { title = { home: 'Desk', agents: 'Agents', activity: 'Activity', account: 'Account' }[S.tab]; html = ({ home: homeView, agents: agentsView, activity: activityView, account: accountView })[S.tab](); }
    chrome(title);
    var keepScroll = window.scrollY;
    v.innerHTML = html;
    if (scrollTop) window.scrollTo(0, 0); else window.scrollTo(0, keepScroll);
    mountChart(cur);
  }

  function findCoin(m) { var st = S.state || {}; var all = [].concat(st.open_positions || [], st.recent_closed || [], st.waiting_room || [], st.recent_audits || []);
    for (var i = 0; i < all.length; i++) if (all[i].mint === m) return all[i]; return { mint: m }; }

  // ---------- odometer ----------
  function odometer(text) {      // digits start where they were last shown, then roll to the new value
    var from = lastOdo && lastOdo.length === text.length ? lastOdo : text;
    return '<div class="odo num" id="odo" aria-label="' + esc(text) + '">' + text.split('').map(function (ch, i) {
      if (!/[0-9]/.test(ch)) return '<span class="ch">' + esc(ch) + '</span>';
      var s = ''; for (var k = 0; k < 10; k++) s += '<span>' + k + '</span>';
      var f = /[0-9]/.test(from[i]) ? Number(from[i]) : Number(ch);
      return '<span class="col"><span class="strip" data-d="' + ch + '" style="transform:translateY(' + (-1.1 * f) + 'em)">' + s + '</span></span>';
    }).join('') + '</div>';
  }
  var lastOdo = null;
  function rollOdo(text) {
    var el = $('#odo'); if (!el) return;
    if (text !== el.getAttribute('aria-label')) { el.outerHTML = odometer(text); el = $('#odo'); }
    var strips = el.querySelectorAll('.strip');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      strips.forEach(function (s) { s.style.transform = 'translateY(' + (-1.1 * Number(s.dataset.d)) + 'em)'; });
    }); });
    lastOdo = text;
  }

  // ---------- home ----------
  function rangePoints() {
    var pts = (S.chart && S.chart.points) || [], r = RANGES.filter(function (x) { return x[0] === S.range; })[0];
    if (!r || !r[1]) return pts;
    var since = Date.now() / 1000 - r[1];
    var f = pts.filter(function (p) { return p[0] >= since; });
    var prev = pts.filter(function (p) { return p[0] < since; }).pop();
    return prev ? [[since, prev[1]]].concat(f) : f;
  }
  function homeView() {
    var st = S.state, pts = rangePoints();
    var startV = pts.length ? pts[0][1] : st.start_stack, d = st.equity - startV, dp = startV ? 100 * d / startV : 0;
    var rlabel = { '1H': 'Past hour', '1D': 'Today', '1W': 'Past week', '1M': 'Past month', 'ALL': 'All time' }[S.range];
    if (S.range === 'ALL') { d = st.pnl_total; dp = 100 * d / st.start_stack; }
    var h = '<section class="hero"><div class="label">' + (st.mode === 'LIVE' ? 'Tracked stack' : 'Paper stack') + '</div>' +
      odometer(usd(st.equity)) +
      '<div class="delta num ' + cls(d) + '" id="delta">' + sUsd(d) + ' (' + pct(dp) + ') <span class="rng">' + rlabel + '</span></div></section>' +
      '<div class="chart-wrap"><canvas id="eqchart" aria-label="Equity chart"></canvas></div>' +
      '<div class="ranges ' + (d >= 0 ? 'up' : 'down') + '">' + RANGES.map(function (r) {
        return '<button data-go="range" data-r="' + r[0] + '" class="' + (S.range === r[0] ? 'on' : '') + '">' + r[0] + '</button>'; }).join('') + '</div>' +
      '<div class="stats">' +
        stat('Cash', usd(st.balance)) + stat('Today', '<span class="' + cls(st.pnl_today) + '">' + sUsd(st.pnl_today) + '</span>') +
        stat('Trades', st.trades_today) + stat('Win rate', st.win_rate == null ? '–' : st.win_rate.toFixed(0) + '%') + '</div>';
    var op = st.open_positions || [];
    h += '<div class="section"><div class="section-h"><h3>Positions</h3></div>' +
      (op.length ? '<div class="list">' + op.map(posRow).join('') + '</div>' : '<div class="list"><div class="empty">No open positions. The desk buys only when all 8 audit layers are green and the analyst score passes.</div></div>') + '</div>';
    h += '<div class="section"><div class="section-h"><h3>Agents</h3><button data-go="tab" data-tab="agents">See all</button></div><div class="carousel">' +
      AGENTS.map(agentCard).join('') + '</div></div>';
    var items = ((S.activity && S.activity.items) || []).slice(0, 6);
    h += '<div class="section"><div class="section-h"><h3>Activity</h3><button data-go="tab" data-tab="activity">See all</button></div>' +
      (items.length ? '<div class="list">' + items.map(actRow).join('') + '</div>' : '<div class="list"><div class="empty">No activity yet.</div></div>') + '</div>';
    return h;
  }
  function stat(k, v) { return '<div class="stat"><div class="k">' + k + '</div><div class="v num">' + v + '</div></div>'; }
  function posRow(p) {
    var open = p.status === 'open', pl = open ? p.upnl_usd : p.pnl_usd, pp = open ? p.upnl_pct : p.pnl_pct;
    return '<button class="row tap" data-go="coin" data-mint="' + esc(p.mint) + '"><div class="avatar">' + initials(p.symbol) + '</div>' +
      '<div class="grow"><div class="t1">' + esc(p.symbol || short(p.mint)) + '</div><div class="t2">' + usd(p.size_usd) + ' · ' +
      (open ? 'stop ' + price(p.stop_price) : esc(p.exit_reason || 'closed') + ' · ' + ago(p.closed_at)) + '</div></div>' +
      '<div class="right num"><div class="t1 ' + cls(pl) + '">' + sUsd(pl) + '</div><div class="t2 ' + cls(pp) + '">' + pct(pp, 1) + '</div></div></button>';
  }
  function agentHb(a) {
    var hb = (S.state && S.state.heartbeats) || {};
    var list = a.hb.map(function (k) { return hb[k]; }).filter(Boolean);
    var best = list.filter(function (x) { return x.status !== 'ok'; })[0] || list.sort(function (x, y) { return y.ts - x.ts; })[0] || null;
    var lvl = !best ? 'idle' : best.status !== 'ok' ? 'err' : (Date.now() / 1000 - best.ts > 300 ? 'stale' : 'ok');
    return { hb: best, lvl: lvl };
  }
  function agentLine(a) {
    var st = S.state, c = st.coins || {}, last = ((S.activity && S.activity.items) || []).filter(function (x) { return x.agent === a.id; })[0];
    var s = { scanner: (st.waiting_room || []).length + ' in waiting room', auditor: (st.recent_audits || []).length + ' recent audits',
      analyst: st.analyst_mode === 'jev' ? 'Jev (jev-latest)' : 'Rules mode', executor: (st.trades_today || 0) + ' entries today',
      risk: (st.open_positions || []).length + ' open · stop ' + (st.settings && st.settings['risk.stop_pct']) + '%' }[a.id];
    return { summary: s, last: last };
  }
  function agentCard(a) {
    var h = agentHb(a), l = agentLine(a);
    var target = a.id === 'auditor' ? 'data-go="auditor"' : 'data-go="tab" data-tab="agents"';
    return '<button class="agent-card" ' + target + '><div class="top"><span class="dot ' + h.lvl + '"></span>' + a.name +
      '<span class="n">AGENT ' + a.n + '</span></div><div class="d">' + esc(l.last ? l.last.text : l.summary) + '</div>' +
      '<div class="a">' + esc(l.summary) + ' · ' + (h.hb ? ago(h.hb.ts) : 'idle') + '</div></button>';
  }
  function actRow(x) {
    var tap = x.mint ? ' tap" data-go="coin" data-mint="' + esc(x.mint) : '';
    return '<button class="row' + tap + '"><div class="grow"><div class="t2">' + esc(x.agent) + ' · ' + hhmm(x.ts) + '</div>' +
      '<div style="font-size:14px;white-space:normal">' + esc(x.text) + '</div></div>' + (x.mint ? CHEV : '') + '</button>';
  }

  function mountChart(cur) {
    var cv = $('#eqchart'), coin = $('#coinchart');
    if (cv) {
      chart = new LineChart(cv, { onScrub: function (p) {
        var st = S.state; if (!st) return;
        var pts = rangePoints(), s0 = pts.length ? pts[0][1] : st.start_stack, val = p ? p[1] : st.equity, d = val - s0;
        rollOdo(usd(val));
        var el = $('#delta'); if (el) { el.className = 'delta num ' + cls(d); el.innerHTML = sUsd(d) + ' (' + pct(s0 ? 100 * d / s0 : 0) + ') <span class="rng">' + (p ? hhmm(p[0]) : '') + '</span>'; }
      } });
      var pts = rangePoints(); if (pts.length && S.state) pts = pts.concat([[Date.now() / 1000, S.state.equity]]);
      chart.set(pts); rollOdo(usd(S.state.equity));
    }
    if (coin && cur) {
      var c = S.coins[cur.mint];
      var cc = new LineChart(coin, { onScrub: function (p) { var el = $('#coinprice'); if (el && c) el.textContent = price(p ? p[1] : lastPrice(c)); } });
      cc.set(((c && c.prices) || []).map(function (p) { return [p[0], p[1]]; }));
    }
  }

  // ---------- agents ----------
  function agentsView() {
    var st = S.state, s = st.settings || {};
    var info = {
      scanner: [['Source', 'PumpPortal migrations'], ['Min liquidity', usd(s['scanner.min_liq_usd'], 0)], ['Max top 10', s['scanner.max_top10_pct'] + '%'],
        ['Max 1h change', s['scanner.max_h1_change_pct'] + '%'], ['Copycat runners', '≥ ' + s['scanner.copycat_h24_pct'] + '% 24h'],
        ['Pool age', '≥ ' + s['scanner.min_pool_age_min'] + ' min'], ['Drop after', s['scanner.drop_after_min'] + ' min']],
      auditor: [['Layers', '8 · stop at first red'], ['Dev wallet', '< ' + s['auditor.max_dev_pct'] + '%'], ['LP locked', '≥ ' + s['auditor.min_lp_locked_pct'] + '%'],
        ['Bundle group', '< ' + s['auditor.max_bundle_group']], ['Delegate accounts', '≤ ' + s['auditor.max_delegate_accounts']]],
      analyst: [['Mode', st.analyst_mode === 'jev' ? 'Jev · ' + esc(s['analyst.model']) : 'Rules'], ['Questions', 'alive_6h · organic · flush · chase'], ['Pass score', '≥ ' + s['analyst.min_score']]],
      executor: [['Size', s['executor.stack_pct'] + '% of stack · ≤ ' + s['executor.max_liq_pct'] + '% of liq'], ['Min ticket', usd(s['executor.min_ticket_usd']) + ' (' + esc(s['executor.below_min']) + ')'],
        ['Recheck', 'liq −' + s['executor.max_liq_drop_pct'] + '% · price +' + s['executor.max_price_up_pct'] + '%'], ['Orders', st.mode === 'PAPER' ? 'Paper fills' : 'You tap Buy on FOMO']],
      risk: [['Stop', '−' + s['risk.stop_pct'] + '%'], ['Trail', s['risk.trail_pct'] + '% from +' + s['risk.trail_start_pct'] + '%'],
        ['Timeout', s['risk.timeout_h'] + 'h if < +' + s['risk.timeout_min_gain_pct'] + '%'], ['Poll', s['risk.poll_s'] + 's']]
    };
    var h = '';
    AGENTS.forEach(function (a) {
      var hb = agentHb(a), l = agentLine(a);
      h += '<div class="section" style="margin-top:' + (a.n === 1 ? 8 : 20) + 'px"><div class="card">' +
        '<div class="section-h" style="margin:0"><h3 style="font-size:17px;display:flex;align-items:center;gap:8px"><span class="dot ' + hb.lvl + '"></span>' + a.name + '</h3>' +
        (a.id === 'auditor' ? '<button data-go="auditor">Audits</button>' : '<span class="dim" style="font-size:12px">AGENT ' + a.n + '</span>') + '</div>' +
        '<div class="muted" style="font-size:13px;margin:4px 0 12px">' + (hb.hb ? (hb.lvl === 'err' ? '<span class="down">error</span> · ' : '') + esc(hb.hb.detail || 'ok') + ' · ' + ago(hb.hb.ts) : 'No heartbeat yet') + '</div>' +
        '<div class="kv">' + info[a.id].map(function (r) { return '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>'; }).join('') + '</div>' +
        (l.last ? '<div class="note" style="margin-top:12px">' + esc(l.last.text) + '<div class="dim" style="margin-top:4px">' + ago(l.last.ts) + '</div></div>' : '') +
        '</div></div>';
      if (a.id === 'scanner') {
        var w = st.waiting_room || [];
        h += '<div class="section" style="margin-top:12px"><div class="section-h"><h3 style="font-size:15px" class="muted">Waiting room</h3></div>' +
          (w.length ? '<div class="list">' + w.slice(0, 15).map(function (c) {
            return '<button class="row tap" data-go="coin" data-mint="' + esc(c.mint) + '"><div class="avatar">' + initials(c.symbol) + '</div><div class="grow"><div class="t1">' +
              esc(c.symbol || short(c.mint)) + '</div><div class="t2">' + esc(c.reason || 'waiting') + '</div></div><div class="right t2">' + ago(c.migrated_at) + '</div>' + CHEV + '</button>'; }).join('') + '</div>'
            : '<div class="list"><div class="empty">No coins waiting.</div></div>') + '</div>';
      }
    });
    var sk = (st.skips || []).slice(0, 15);
    h += '<div class="section"><div class="section-h"><h3>Skips</h3></div>' + (sk.length ? '<div class="list">' + sk.map(function (x) {
      return '<button class="row' + (x.mint ? ' tap" data-go="coin" data-mint="' + esc(x.mint) : '') + '"><div class="grow"><div class="t2">' + esc(x.stage) + ' · ' + hhmm(x.ts) + '</div><div style="font-size:14px">' + esc(x.reason) + '</div></div></button>'; }).join('') + '</div>'
      : '<div class="list"><div class="empty">No skips yet.</div></div>') + '</div>';
    return h;
  }

  // ---------- activity ----------
  function activityView() {
    var items = (S.activity && S.activity.items) || [], f = S.actFilter;
    var opts = [['all', 'All']].concat(AGENTS.map(function (a) { return [a.id, a.name]; }));
    var list = items.filter(function (x) { return f === 'all' || x.agent === f; });
    var h = '<div class="pills">' + opts.map(function (o) { return '<button class="pill ' + (f === o[0] ? 'on' : '') + '" data-go="filter" data-f="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
    if (!list.length) return h + '<div class="list"><div class="empty">Nothing here yet.</div></div>';
    var day = null, buf = [];
    list.forEach(function (x) {
      var d = new Date(x.ts * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      if (d !== day) { if (buf.length) h += '<div class="list">' + buf.join('') + '</div>'; buf = []; h += '<div class="day-h">' + esc(d) + '</div>'; day = d; }
      buf.push(actRow(x));
    });
    return h + '<div class="list">' + buf.join('') + '</div>';
  }

  // ---------- account ----------
  function accountView() {
    var st = S.state, s = st.settings || {};
    var groups = {}; Object.keys(s).forEach(function (k) { var g = k.indexOf('.') > 0 ? k.split('.')[0] : 'desk'; (groups[g] = groups[g] || []).push(k); });
    var h = '<div class="card" style="margin-top:8px"><div class="muted" style="font-size:13px;font-weight:600;margin-bottom:8px">Mode</div>' +
      '<div class="seg" aria-disabled="true"><span class="' + (st.mode === 'PAPER' ? 'on' : '') + '">PAPER</span><span class="' + (st.mode === 'LIVE' ? 'on' : '') + '">LIVE</span></div>' +
      '<div class="note">This app is read-only (Plan B). Change mode, pause/resume and settings in Telegram: <span class="mono">/mode PAPER|LIVE</span>, <span class="mono">/pause</span>, <span class="mono">/resume</span>, <span class="mono">/set key value</span>. The desk can’t pause while a position is open. The desk never places orders.</div></div>';
    h += '<div class="section"><div class="list">' +
      kvRow('Start stack', usd(st.start_stack)) + kvRow('Equity', usd(st.equity)) + kvRow('Cash', usd(st.balance)) +
      kvRow('Total P&L', '<span class="' + cls(st.pnl_total) + '">' + sUsd(st.pnl_total) + '</span>') + kvRow('Closed trades', st.closed_trades) +
      kvRow('Status', st.paused ? '<span class="down">Paused</span>' : 'Running') + '</div></div>';
    h += '<div class="section"><div class="list">' +
      (fomoOk(st.profile_url) ? '<a class="row tap" href="' + esc(st.profile_url) + '" target="_blank" rel="noopener"><div class="grow link-row">FOMO profile · @' + esc(s.fomo_handle) + '</div>' + CHEV + '</a>' : '') +
      (st.signup_url && st.signup_url.indexOf('savipww') > -1 ? '<a class="row tap" href="' + esc(st.signup_url) + '" target="_blank" rel="noopener"><div class="grow link-row">Join FOMO</div>' + CHEV + '</a>' : '') + '</div></div>';
    Object.keys(groups).forEach(function (g) {
      h += '<div class="section"><div class="section-h"><h3 style="font-size:15px" class="muted">' + esc(g) + '</h3></div><div class="list">' +
        groups[g].map(function (k) { return kvRow('<span class="mono">' + esc(k) + '</span>', esc(String(s[k]))); }).join('') + '</div></div>';
    });
    h += '<div class="section"><div class="list">' + kvRow('Data updated', ago(st.updated_at)) + kvRow('Refresh', 'every 15s · desk publishes ~6 min') +
      kvRow('Desk version', esc(st.version)) + '<button class="row tap" data-go="forget"><div class="grow down" style="font-weight:600">Forget desk on this device</div></button></div></div>';
    return h;
  }
  function kvRow(k, v) { return '<div class="row"><div class="grow muted">' + k + '</div><div class="right num" style="font-weight:600">' + v + '</div></div>'; }

  // ---------- auditor ----------
  function auditorView() {
    var a = (S.state.recent_audits) || null;
    var h = '<div class="note" style="margin-top:8px">8 layers, checked in order. The first red stops the audit; later layers show as not checked. Missing data counts as red.</div>' +
      '<div class="section" style="margin-top:16px"><div class="list">' + LAYERS.map(function (l, i) {
        return '<div class="layer"><div class="ic nc">' + (i + 1) + '</div><div class="grow">' + esc(l[1]) + '</div></div>'; }).join('') + '</div></div>';
    if (!a) a = ((S.activity && S.activity.items) || []).filter(function (x) { return x.agent === 'auditor'; })
      .map(function (x) { return { ts: x.ts, mint: x.mint, text: x.text }; });
    h += '<div class="section"><div class="section-h"><h3>Recent audits</h3></div>';
    if (!a.length) return h + '<div class="list"><div class="empty">No audits yet. Coins reach the Auditor after passing the Scanner (≥ 10 min pool age, no kills).</div></div></div>';
    return h + '<div class="list">' + a.map(function (x) {
      var pass = x.verdict === 'pass', label = x.text ? esc(x.text) : (pass ? '8/8 · all green' : (x.passed + '/8 · red ' + esc((x.first_red || '').replace(/^L\d_/, '').replace(/_/g, ' '))));
      return '<button class="row tap" data-go="coin" data-mint="' + esc(x.mint) + '"><div class="avatar">' + initials(x.symbol) + '</div><div class="grow"><div class="t1">' +
        esc(x.symbol || short(x.mint)) + '</div><div class="t2">' + label + '</div></div><div class="right">' +
        (x.verdict ? '<span class="tag ' + (pass ? 'green' : 'red') + '">' + (pass ? 'pass' : 'fail') + '</span>' : '') + '<div class="t2" style="margin-top:4px">' + ago(x.ts) + '</div></div></button>'; }).join('') + '</div></div>';
  }

  // ---------- coin ----------
  function lastPrice(c) { var p = c.prices || []; if (p.length) return p[p.length - 1][1]; return c.dex && Number(c.dex.priceUsd); }
  function coinView(mint) {
    var c = S.coins[mint];
    if (!c) return stateBox('loading', '', 'Loading coin…');
    if (c._err) return stateBox('error', 'No coin data', 'The desk hasn’t published data for ' + esc(short(mint)) + (c._err === 'not found' ? ' yet.' : ' (' + esc(c._err) + ').'), '<button class="btn ghost" style="flex:0 0 auto;padding:0 28px" data-go="retry">Try again</button>');
    var co = c.coin || {}, d = c.dex || {}, pos = (c.positions || []), open = pos.filter(function (p) { return p.status === 'open'; })[0];
    var px = lastPrice(c), ch = d.priceChange_h1;
    var url = fomoOk(c.fomo_url) ? c.fomo_url : null;
    var h = '<div class="coin-h" style="margin-top:8px"><div class="avatar">' + initials(co.symbol) + '</div><div class="grow"><div style="font-weight:700;font-size:17px">' +
      esc(co.symbol || short(mint)) + '</div><div class="muted" style="font-size:13px">' + esc(co.name || '') + ' · <span class="mono">' + esc(short(mint)) + '</span></div></div>' +
      '<span class="tag ' + ({ passed: 'green', audited: 'green', signaled: 'green', rejected: 'red', dropped: 'red', waiting: 'amber' }[co.status] || '') + '">' + esc(co.status || '') + '</span></div>' +
      '<div class="coin-price num" id="coinprice">' + price(px) + '</div>' +
      '<div class="delta num ' + cls(ch) + '">' + (ch == null ? '' : pct(ch) + ' <span class="rng">1h</span>') + '</div>' +
      '<div class="chart-wrap" style="height:180px"><canvas id="coinchart"></canvas></div>';
    h += '<div class="btns">' + (url ? '<a class="btn buy" href="' + esc(url) + '" target="_blank" rel="noopener">Buy on FOMO</a>' +
      (open ? '<a class="btn sell" href="' + esc(url) + '" target="_blank" rel="noopener">Sell on FOMO</a>' : '')
      : '<span class="btn ghost" aria-disabled="true">FOMO link unavailable</span>') + '</div>';
    if (co.reason) h += '<div class="note">' + esc(co.reason) + '</div>';
    if (open || pos.length) h += '<div class="section"><div class="section-h"><h3>Position</h3></div><div class="list">' + pos.map(function (p) {
      return '<div class="row" style="display:block"><div class="kv">' +
        kv('Status', esc(p.status) + ' · ' + esc(p.mode)) + kv('Size', usd(p.size_usd)) + kv('Entry', price(p.entry_price)) +
        (p.status === 'open' ? kv('Stop', price(p.stop_price)) + kv('Peak', price(p.peak_price)) + kv('Unrealized', '<span class="' + cls(p.upnl_usd) + '">' + sUsd(p.upnl_usd) + ' (' + pct(p.upnl_pct, 1) + ')</span>')
          : kv('Exit', price(p.exit_price) + ' · ' + esc(p.exit_reason)) + kv('P&L', '<span class="' + cls(p.pnl_usd) + '">' + sUsd(p.pnl_usd) + ' (' + pct(p.pnl_pct, 1) + ')</span>')) +
        kv('Fees', usd((p.fee_in || 0) + (p.fee_out || 0))) + '</div></div>'; }).join('') + '</div></div>';
    // auditor
    var au = c.audit;
    h += '<div class="section"><div class="section-h"><h3>Auditor</h3>' + (au ? '<span class="tag ' + (au.verdict === 'pass' ? 'green' : 'red') + '">' + au.passed + '/8</span>' : '') + '</div><div class="list">' +
      (au ? LAYERS.map(function (l, i) {
        var r = (au.layers || {})[l[0]] || { status: 'not checked' }, k = r.status === 'green' ? 'green' : r.status === 'red' ? 'red' : 'nc';
        return '<div class="layer"><div class="ic ' + k + '">' + (k === 'green' ? '✓' : k === 'red' ? '✕' : (i + 1)) + '</div><div class="grow"><div style="font-weight:600;font-size:14px">' + esc(l[1]) +
          '</div><div class="muted" style="font-size:13px">' + esc(k === 'nc' ? 'not checked' : r.detail) + '</div></div></div>'; }).join('')
        : '<div class="empty">Not audited yet' + (co.status === 'waiting' ? ' — still in the Scanner waiting room.' : '.') + '</div>') + '</div></div>';
    // analyst
    var v = c.verdict;
    if (v) {
      var s = S.state.settings || {}, th = { alive_6h: ['≥', s['analyst.min_alive_6h']], organic: ['≥', s['analyst.min_organic']], flush: null, chase: ['≤', s['analyst.max_chase']] };
      h += '<div class="section"><div class="section-h"><h3>Analyst</h3><span class="tag ' + (v.verdict === 'pass' ? 'green' : 'red') + '">' + esc(v.verdict) + '</span></div><div class="card">' +
        '<div style="display:flex;align-items:baseline;gap:8px"><div class="score num">' + (v.score == null ? '–' : v.score) + '</div><div class="muted">score · ' + esc(v.model) + '</div></div>' +
        (v.reason ? '<div class="muted" style="font-size:13px;margin:4px 0 8px">' + esc(v.reason) + '</div>' : '<div style="height:8px"></div>') +
        ['alive_6h', 'organic', 'flush', 'chase'].map(function (q) {
          var val = v[q]; if (val == null) return '';
          var t = th[q], ok = !t ? null : (t[0] === '≥' ? val >= t[1] : val <= t[1]);
          return '<div class="q"><div class="qh"><span>' + q + '</span><span class="num">' + val.toFixed(2) + (t ? ' <span class="dim">' + t[0] + ' ' + t[1] + '</span>' : '') + '</span></div>' +
            '<div class="bar"><i class="' + (ok === null ? '' : ok ? 'ok' : 'bad') + '" style="width:' + Math.round(100 * Math.max(0, Math.min(1, val))) + '%"></i></div></div>'; }).join('') + '</div></div>';
    }
    // market
    h += '<div class="section"><div class="section-h"><h3>Market</h3></div><div class="card"><div class="kv">' +
      kv('Liquidity', usd(d.liquidity_usd, 0)) + kv('Market cap', usd(d.marketCap, 0)) + kv('Volume 1h', usd(d.volume_h1, 0)) +
      kv('Buys / sells 1h', (d.txns_h1_buys == null ? '–' : d.txns_h1_buys + ' / ' + d.txns_h1_sells)) + kv('5m', pct(d.priceChange_m5, 1)) +
      kv('24h', pct(d.priceChange_h24, 1)) + kv('Liq at scan', usd(co.scan_liq, 0)) + kv('Migrated', ago(co.migrated_at)) + '</div></div></div>';
    var sc = (c.scans || []).slice(-8).reverse();
    if (sc.length) h += '<div class="section"><div class="section-h"><h3>Scanner</h3></div><div class="list">' + sc.map(function (x) {
      return '<div class="row"><div class="grow"><div class="t2">' + hhmm(x.ts) + ' · age ' + (x.age_min == null ? '–' : x.age_min.toFixed(0) + 'm') + '</div><div style="font-size:14px">' + esc(x.reason || x.result) + '</div></div>' +
        '<span class="tag ' + ({ pass: 'green', kill: 'red', drop: 'red', wait: 'amber' }[x.result] || '') + '">' + esc(x.result) + '</span></div>'; }).join('') + '</div></div>';
    return h;
  }
  function kv(k, v) { return '<div class="k">' + k + '</div><div class="v num">' + v + '</div>'; }

  // ---------- boot ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  render(); poll(); schedule();
})();
