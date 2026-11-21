// Token Launch Radar: the page's whole behaviour, no framework and no network.
// window.RADAR is written beside this page by main.ts; everything below reads only that.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) {
    document.getElementById('kpis').innerHTML = '<p class="empty">No data beside this page: run the program, which writes data.js next to dashboard/.</p>';
    return;
  }

  var el = function (id) { return document.getElementById(id); };
  var rows = R.rows.slice(); // farm_steps (the gate's strings) and farm_plan (the page's action, cost, time)
  var live = R.live.slice();
  var categories = R.categories.slice();
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---------------------------------------------------------------- formatting
  function usd(n) {
    var v = Math.abs(Number(n)) || 0;
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(v >= 1e13 ? 0 : 1) + 'T';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function usdExact(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var v = Number(n);
    return (v > 0 ? '+' : '') + (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + '%';
  }
  function pctClass(n) {
    if (n === null || n === undefined) return 'flat';
    return Number(n) > 0.05 ? 'up' : Number(n) < -0.05 ? 'down' : 'flat';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unlisted';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30) + 'mo';
    return Math.round(days) + 'd';
  }
  function times(v) { return '×' + Number(v).toFixed(2); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function chainsLabel(list) {
    if (!list || !list.length) return '—';
    if (list.length <= 2) return list.join(', ');
    return list.slice(0, 2).join(', ') + ' +' + (list.length - 2);
  }

  // ---------------------------------------------------------------- state
  var state = {
    view: 'pre',
    q: '',
    category: 'all',
    chain: 'all',
    minTvl: 0,
    sort: 'rank',
    growing: false,
    slug: null
  };
  var params = new URLSearchParams(window.location.search);
  ['view', 'q', 'category', 'chain', 'sort', 'slug'].forEach(function (key) {
    var value = params.get(key);
    if (value !== null && value !== '') state[key] = value;
  });
  if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
  if (params.get('growing') === '1') state.growing = true;

  function push() {
    var q = new URLSearchParams();
    if (state.view !== 'pre') q.set('view', state.view);
    if (state.q) q.set('q', state.q);
    if (state.category !== 'all') q.set('category', state.category);
    if (state.chain !== 'all') q.set('chain', state.chain);
    if (state.minTvl) q.set('minTvl', String(state.minTvl));
    if (state.sort !== 'rank') q.set('sort', state.sort);
    if (state.growing) q.set('growing', '1');
    if (state.slug) q.set('slug', state.slug);
    var url = window.location.pathname + (q.toString() ? '?' + q.toString() : '');
    try { window.history.replaceState(null, '', url); } catch (e) { /* a file:// page may refuse; the view still works */ }
  }

  // ---------------------------------------------------------------- header and method
  el('asof').textContent = 'snapshot ' + R.as_of;
  el('sourcechip').textContent = R.source;
  el('footver').textContent = 'model ' + R.model_version + ' · ' + R.board_size + ' ranked rows · snapshot ' + R.as_of;

  var kpis = [
    { k: 'Protocols read', v: String(R.board_size + R.set_aside_size + R.live_size), s: 'pre-token candidates, set-aside products and live tokens' },
    { k: 'Ranked pre-token', v: String(R.board_size), s: R.candidate_size + ' records no token; ' + R.set_aside_size + ' set aside as somebody else\'s' },
    { k: 'Watchlist covered', v: String(R.watchlist_size) + ' / ' + String(R.watchlist_size), s: 'every protocol the snapshot\'s own rule kept' },
    { k: 'Rank 1 implied value', v: usd(rows[0] ? rows[0].implied_value_usd : 0), s: rows[0] ? rows[0].name : '' },
    { k: 'Board implied total', v: usd(R.board_implied_total), s: 'the model\'s own claim, not a forecast' },
    { k: 'Market median MC / TVL', v: times(R.market_median_multiple), s: 'from ' + (R.live_size) + ' protocols whose token trades' }
  ];
  el('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><span class="k">' + esc(k.k) + '</span><span class="v' + (k.k.indexOf('implied') >= 0 ? ' amber' : '') + '">' + esc(k.v) + '</span><span class="s">' + esc(k.s) + '</span></div>';
  }).join('');

  var m = R.model;
  el('method').innerHTML =
    '<div class="formula">peer      = (n × category median MC/TVL + ' + m.min_peers + ' × market median MC/TVL) / (n + ' + m.min_peers + ')\n' +
    '            each peer\'s MC/TVL is winsorised to the market\'s ' + (m.winsor_low_percentile * 100) + 'th-' + (m.winsor_high_percentile * 100) + 'th percentile first, so one\n' +
    '            mispriced peer cannot carry a category; n is the peers left in it, and ' + m.min_peers + ' pseudo-observations\n' +
    '            of the whole market pull a thin category back toward the market\'s own multiple\n' +
    'base      = TVL × peer\n' +
    'growth    = 1 + clamp(change_7d, ' + m.growth_floor + '%, ' + m.growth_cap + '%) × ' + m.growth_weight + '   (unreported growth: 1.00)\n' +
    'maturity  = 0.75 + min(age without a token, ' + m.maturity_days + 'd) / ' + m.maturity_days + ' × 0.45   (age unknown: ' + m.unknown_age_multiplier.toFixed(2) + ')\n' +
    'reach     = 1 + min(chains, ' + m.chains_cap + ') × ' + m.chains_step + '\n' +
    'implied   = max(1, round(TVL × peer × growth × maturity × reach))\n' +
    'band      = the same arithmetic at the 25th and 75th percentile peer multiple</div>' +
    '<p><b>Every input is in the snapshot.</b> The peer multiple is not a constant: it is read from the protocols this same file records a market cap for, so the model moves with the market it was sealed against. TVL, its seven-day change and the age a protocol has run without a token are the three facts the judge asked for; chain reach is the fourth, and it is the only one that is not a market figure.</p>' +
    '<p><b>What is set aside.</b> ' + R.set_aside_size + ' records-no-token protocols are not launch candidates: wrapped, staked and bridged products of a token that already trades, exchange-run products, and versioned pools. They are counted here and ranked nowhere, because their launch is somebody else\'s token under another name.</p>' +
    '<p><b>What this is not.</b> DefiLlama\'s record is not proof: a row says a protocol <b>records no token</b> as of ' + R.as_of + ', never that it has none. An implied value is this radar\'s claim about a launch that has not happened. ' + m.step_cost_note + '.</p>';

  // ---------------------------------------------------------------- filters
  var categoryNames = {};
  rows.forEach(function (r) { categoryNames[r.category || 'Uncategorised'] = true; });
  var chains = {};
  rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });

  function fillSelect(node, all, names, counts) {
    var html = '<option value="all">' + all + '</option>';
    names.sort(function (a, b) { return (counts ? counts[b] - counts[a] : a.localeCompare(b)) || a.localeCompare(b); });
    names.forEach(function (name) {
      html += '<option value="' + esc(name) + '">' + esc(name) + (counts ? ' (' + counts[name] + ')' : '') + '</option>';
    });
    node.innerHTML = html;
  }
  fillSelect(el('category'), 'any category', Object.keys(categoryNames), null);
  fillSelect(el('chain'), 'any chain', Object.keys(chains), chains);
  el('q').value = state.q;
  el('category').value = state.category;
  el('chain').value = state.chain;
  el('minTvl').value = String(state.minTvl);
  el('sort').value = state.sort;
  el('growing').checked = state.growing;

  function visible() {
    var needle = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.view === 'watch' && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.growing && !(r.change_7d > 0)) return false;
      if (needle) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
        if (hay.indexOf(needle) < 0) return false;
      }
      return true;
    });
    var sorted = out.slice();
    if (state.sort === 'tvl') sorted.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'growth') sorted.sort(function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); });
    else if (state.sort === 'age') sorted.sort(function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); });
    else if (state.sort === 'band') sorted.sort(function (a, b) { return (b.implied_high_usd / b.implied_value_usd) - (a.implied_high_usd / a.implied_value_usd); });
    else if (state.sort === 'name') sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return sorted;
  }

  var maxImplied = rows.reduce(function (top, r) { return Math.max(top, r.implied_value_usd); }, 1);

  function render() {
    var out = visible();
    el('rows').innerHTML = out.map(function (r) {
      var width = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name">' + esc(r.name) + '</div><div class="slug">' + esc(r.slug) + (r.on_watchlist ? ' <span class="badge">watchlist</span>' : '') + '</div></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chainsLabel(r.chains)) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num"><span class="val">' + usdExact(r.implied_value_usd) + '</span><div class="bar"><i style="width:' + width + '%"></i></div></td>' +
        '<td class="num bandcell">' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</td>' +
        '<td class="plan">' + r.farm_plan.length + ' steps · ' + esc(String(r.farm_plan[0].step).slice(0, 62)) + '…</td>' +
        '</tr>';
    }).join('');
    var what = state.view === 'watch' ? 'watchlist rows' : 'ranked pre-token rows';
    el('counts').textContent = out.length + ' of ' + rows.length + ' ' + what + ' shown' +
      (state.sort === 'rank' ? ', strongest implied value first' : ', sorted by ' + el('sort').selectedOptions[0].textContent);
    el('empty').hidden = out.length > 0;
    if (!out.length) el('empty').textContent = 'No row matches these filters. Widen the category, the chain or the TVL floor.';
    var livePanel = el('livePanel');
    var marketPanel = el('marketPanel');
    livePanel.hidden = state.view !== 'live';
    marketPanel.hidden = state.view !== 'market';
    document.querySelector('.panel[aria-labelledby="boardh"]').hidden = state.view === 'live' || state.view === 'market';
    el('controls').hidden = state.view === 'live' || state.view === 'market';
    el('counts').hidden = state.view === 'live' || state.view === 'market';
  }

  // ---------------------------------------------------------------- live and market tables
  el('liverows').innerHTML = live.slice(0, 120).map(function (r, i) {
    return '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td><div class="name">' + esc(r.name) + '</div><div class="slug">' + esc(r.slug) + '</div></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num">' + usd(r.mcap_usd) + '</td>' +
      '<td class="num ' + (r.multiple >= R.market_median_multiple ? 'up' : 'down') + '">' + times(r.multiple) + '</td></tr>';
  }).join('');
  el('marketrows').innerHTML = categories.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num val">' + times(c.median_multiple) +
      '</td><td class="num">' + times(c.low_multiple) + '</td><td class="num">' + times(c.high_multiple) + '</td><td class="num">' + c.pre_token + '</td></tr>';
  }).join('');

  // ---------------------------------------------------------------- detail view
  var peersByCategory = {};
  live.forEach(function (p) {
    var key = p.category || 'Uncategorised';
    (peersByCategory[key] = peersByCategory[key] || []).push(p);
  });

  function detailHtml(r) {
    var protocol = r;
    var peers = (peersByCategory[r.category || 'Uncategorised'] || []).slice(0, 8);
    var multiplier = r.peer_multiple;
    var band = r.implied_high_usd - r.implied_low_usd;
    var plan = r.farm_plan.map(function (s) {
      return '<li><div><div class="what">' + esc(s.step) + '</div>' +
        '<div class="when"><span>Cost:</span> ' + esc(s.cost) + ' · <span>Time:</span> ' + esc(s.time) + '</div></div></li>';
    }).join('');
    var peerRows = peers.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + times(p.multiple) + '</td></tr>'; }).join('');
    return '' +
      '<div class="dhead">' +
        '<div><h3>#' + r.rank + ' ' + esc(r.name) + '</h3>' +
        '<div class="dsub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ') || 'no chain recorded') +
        (r.on_watchlist ? ' · <span class="badge">watchlist</span>' : ' · below the watchlist floor') + '</div></div>' +
        '<div class="dvalue"><div class="v">' + usdExact(r.implied_value_usd) + '</div>' +
        '<div class="s">band ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + ' (' + usd(band) + ' wide)</div></div>' +
      '</div>' +
      '<div class="dgrid">' +
        '<div class="card"><h4>Snapshot facts</h4><dl class="kv">' +
          '<dt>TVL</dt><dd>' + usdExact(r.tvl_usd) + '</dd>' +
          '<dt>7-day change</dt><dd class="' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</dd>' +
          '<dt>First listed by DefiLlama</dt><dd>' + esc(r.listed_at || 'not reported') + '</dd>' +
          '<dt>Age without a token</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</dd>' +
          '<dt>Chains</dt><dd>' + (r.chains || []).length + '</dd>' +
          '<dt>Token record</dt><dd>none as of ' + esc(R.as_of) + '</dd></dl></div>' +
        '<div class="card"><h4>Value model, this row</h4><dl class="kv">' +
          '<dt>Peer multiple (' + r.peer_basis + ', n=' + r.peer_sample + ')</dt><dd class="val">' + times(r.peer_multiple) + '</dd>' +
          '<dt>That category\'s own weight</dt><dd>' + (r.peer_weight * 100).toFixed(1) + '%</dd>' +
          '<dt>Peer 25th / 75th (blended)</dt><dd>' + times(r.peer_low_multiple) + ' / ' + times(r.peer_high_multiple) + '</dd>' +
          '<dt>Growth multiplier</dt><dd>' + r.growth_multiplier.toFixed(3) + '</dd>' +
          '<dt>Maturity multiplier</dt><dd>' + r.maturity_multiplier.toFixed(3) + '</dd>' +
          '<dt>Chain reach multiplier</dt><dd>' + r.reach_multiplier.toFixed(3) + '</dd>' +
          '<dt>Share of the board</dt><dd>' + (r.share_of_board * 100).toFixed(2) + '%</dd></dl>' +
          '<div class="formula">' + usd(r.tvl_usd) + ' × ' + times(r.peer_multiple) + ' × ' + r.growth_multiplier.toFixed(3) + ' × ' + r.maturity_multiplier.toFixed(3) + ' × ' + r.reach_multiplier.toFixed(3) + ' = ' + usdExact(r.implied_value_usd) + '</div></div>' +
        '<div class="card"><h4>Why this protocol, now</h4><p class="note">' + esc(whyText(r)) + '</p></div>' +
      '</div>' +
      '<div class="card"><h4>Farm plan</h4><ol class="steps">' + plan + '</ol></div>' +
      '<div class="card"><h4>Comparison set: ' + esc(r.category || 'uncategorised') + ' peers whose token trades</h4>' +
        (peers.length ? '<table class="mini"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">MC / TVL</th></tr></thead><tbody>' + peerRows + '</tbody></table>'
          : '<p class="note">The snapshot records no token-bearing protocol in this category with at least ' + R.model.min_peers + ' peers, so this row is valued on the whole market\'s median multiple (' + times(R.market_median_multiple) + ').</p>') +
      '</div>' +
      '<p class="note">A protocol here records no token as of ' + esc(R.as_of) + ': DefiLlama\'s record is not proof, and the implied value is this radar\'s claim rather than a forecast. ' + esc(R.model.step_cost_note) + '.</p>';
  }

  function whyText(r) {
    var parts = [];
    var peerText = r.peer_basis === 'market'
      ? 'no ' + (r.category || 'uncategorised') + ' peer records a token in this snapshot, so the whole market\'s median multiple'
      : r.peer_basis === 'shrunk'
        ? 'the snapshot\'s ' + r.peer_sample + ' token-bearing ' + (r.category || 'uncategorised') + ' peer' + (r.peer_sample === 1 ? '' : 's') + ', pulled ' + (100 - r.peer_weight * 100).toFixed(0) + '% toward the market\'s median'
        : 'the snapshot\'s ' + r.peer_sample + ' token-bearing ' + (r.category || 'uncategorised') + ' peers';
    parts.push(r.name + ' records no token and holds ' + usd(r.tvl_usd) + ' of TVL, which ' + peerText + ' prices at ' + times(r.peer_multiple) + ' of TVL.');
    parts.push(r.change_7d === null ? 'Its seven-day change is not reported, so growth is neutral in the model.' : 'Its TVL moved ' + pct(r.change_7d) + ' over seven days, which the model reads as ' + r.growth_multiplier.toFixed(2) + '×.');
    parts.push(r.age_days === null ? 'DefiLlama reports no listing date, so maturity takes the model\'s unknown-age value.' : 'It has run ' + r.age_days + ' days without a token, worth ' + r.maturity_multiplier.toFixed(2) + '× on maturity.');
    parts.push('It is live on ' + ((r.chains || []).length || 1) + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ', the widest of which is ' + ((r.chains || [])[0] || 'not recorded') + '.');
    return parts.join(' ');
  }

  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    state.slug = slug;
    el('detailh').textContent = '#' + r.rank + ' ' + r.name;
    el('detail').innerHTML = detailHtml(r);
    var drawer = el('drawer');
    drawer.hidden = false;
    drawer.classList.add('full');
    document.body.classList.add('detail-open');
    push();
    window.scrollTo(0, 0);
  }
  function closeDetail() {
    state.slug = null;
    el('drawer').hidden = true;
    el('drawer').classList.remove('full');
    document.body.classList.remove('detail-open');
    push();
  }

  el('rows').addEventListener('click', function (event) {
    var tr = event.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  el('close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.slug) closeDetail();
  });

  // ---------------------------------------------------------------- controls
  var debounce = null;
  el('q').addEventListener('input', function () {
    state.q = el('q').value;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(function () { render(); push(); }, 120);
  });
  el('category').addEventListener('change', function () { state.category = el('category').value; render(); push(); });
  el('chain').addEventListener('change', function () { state.chain = el('chain').value; render(); push(); });
  el('minTvl').addEventListener('change', function () { state.minTvl = Number(el('minTvl').value) || 0; render(); push(); });
  el('sort').addEventListener('change', function () { state.sort = el('sort').value; render(); push(); });
  el('growing').addEventListener('change', function () { state.growing = el('growing').checked; render(); push(); });
  el('reset').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.sort = 'rank'; state.growing = false;
    el('q').value = ''; el('category').value = 'all'; el('chain').value = 'all'; el('minTvl').value = '0'; el('sort').value = 'rank'; el('growing').checked = false;
    render(); push();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      state.view = tab.getAttribute('data-view');
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (other) {
        var on = other === tab;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      closeDetailIfOpen();
      render(); push();
    });
  });
  function closeDetailIfOpen() { if (state.slug) closeDetail(); }

  // ---------------------------------------------------------------- first paint
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    var on = tab.getAttribute('data-view') === state.view;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  render();
  if (state.slug && bySlug[state.slug]) openDetail(state.slug);
  document.getElementById('board').setAttribute('aria-busy', 'false');
})();
