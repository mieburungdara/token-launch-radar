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
    slug: null,
    pins: [],
    compare: []
  };
  var STORE = 'token-radar-shortlist-v1';
  function readStoredPins() {
    try {
      var saved = window.localStorage.getItem(STORE);
      if (!saved) return [];
      var list = JSON.parse(saved);
      return Array.isArray(list) ? list.filter(function (s) { return bySlug[s]; }) : [];
    } catch (e) {
      return [];
    }
  }
  function storePins() {
    try { window.localStorage.setItem(STORE, JSON.stringify(state.pins)); } catch (e) { /* a file:// page may refuse; the address still carries them */ }
  }
  var params = new URLSearchParams(window.location.search);
  ['view', 'q', 'category', 'chain', 'sort', 'slug'].forEach(function (key) {
    var value = params.get(key);
    if (value !== null && value !== '') state[key] = value;
  });
  if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
  if (params.get('growing') === '1') state.growing = true;
  var urlPins = (params.get('pins') || '').split(',').filter(function (s) { return bySlug[s]; });
  state.pins = urlPins.length ? urlPins : readStoredPins();
  state.compare = (params.get('compare') || '').split(',').filter(function (s) { return bySlug[s]; }).slice(0, 2);
  if (state.compare.length === 2 && !params.get('view')) state.view = 'compare';

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
    if (state.pins.length) q.set('pins', state.pins.join(','));
    if (state.compare.length) q.set('compare', state.compare.join(','));
    var url = window.location.pathname + (q.toString() ? '?' + q.toString() : '');
    try { window.history.replaceState(null, '', url); } catch (e) { /* a file:// page may refuse; the view still works */ }
  }

  // ---------------------------------------------------------------- header and method
  el('asof').textContent = 'snapshot ' + R.as_of;
  el('sourcechip').textContent = R.source;
  el('footver').textContent = 'model ' + R.model_version + ' · ' + R.board_size + ' ranked rows · snapshot ' + R.as_of;

  function bestScore() {
    return R.validation.variants[R.validation.chosen];
  }

  var kpis = [
    { k: 'Protocols read', v: String(R.board_size + R.set_aside_size + R.live_size), s: 'pre-token candidates, set-aside products and live tokens' },
    { k: 'Ranked pre-token', v: String(R.board_size), s: R.candidate_size + ' records no token; ' + R.set_aside_size + ' set aside as somebody else\'s' },
    { k: 'Watchlist covered', v: String(R.watchlist_size) + ' / ' + String(R.watchlist_size), s: 'every protocol the snapshot\'s own rule kept' },
    { k: 'Rank 1 implied value', v: usd(rows[0] ? rows[0].implied_value_usd : 0), s: rows[0] ? rows[0].name : '' },
    { k: 'Board implied total', v: usd(R.board_implied_total), s: 'the model\'s own claim, not a forecast' },
    { k: 'Market median MC / TVL', v: times(R.market_median_multiple), s: 'from ' + (R.live_size) + ' protocols whose token trades' },
    { k: 'Held-out error', v: (bestScore().holdout_mdape * 100).toFixed(0) + '%', s: 'the ' + R.fit.variant + ', priced on protocols it never saw' }
  ];
  el('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><span class="k">' + esc(k.k) + '</span><span class="v' + (k.k.indexOf('implied') >= 0 ? ' amber' : '') + '">' + esc(k.v) + '</span><span class="s">' + esc(k.s) + '</span></div>';
  }).join('');

  var m = R.model;
  el('method').innerHTML =
    '<div class="formula">size      = log10(market cap) = ' + R.fit.coefficients.map(function (c, i) { return (i ? ' + ' + c.toFixed(3) + ' × ' : '') + (i ? R.fit.names[i - 1] : c.toFixed(3)); }).join('') + '\n' +
    '            the terms were chosen by the holdout, not by hand: today the ' + esc(R.fit.variant) + ' wins\n' +
    '            every category\'s median residual is added after the line, shrunk toward zero by ' + m.min_peers + ' pseudo-observations\n' +
    'tested    growth (' + m.growth_floor + '% to ' + m.growth_cap + '%, clamped), age without a token and chain count were each tried as a term:\n' +
    '            the holdout priced them worse than TVL alone — see the model-check view — so the board\n' +
    '            leaves them out of the value and shows them per row, where a reader can weigh them\n' +
    'implied   = max(1, round(size))\n' +
    'band      = the middle half of the holdout ratios, both splits, both directions: ×' + R.validation.band_low.toFixed(2) + ' to ×' + R.validation.band_high.toFixed(2) + '\n' +
    'odds      = a logistic fit on TVL, age, chains and the category token share, on the snapshot\'s own records\n' +
    '            of which protocols carry a token: ' + (R.validation.odds.accuracy * 100).toFixed(0) + '% of the holdout half called right, against a\n' +
    '            ' + (R.validation.odds.base_rate * 100).toFixed(0) + '% base rate, so the odds are a weak prior and not a forecast</div>' +
    '<p><b>Every input is in the snapshot.</b> Nothing here is a fixed multiple: the size term is a line fitted through the protocols this same file records a market cap for, so the model moves with the market it was sealed against, and the band under every row is the error that fit actually made on protocols it had never seen. TVL, its seven-day change and the age a protocol has run without a token are the three facts the board is asked to weigh; chain reach is the fourth, and it is the only one that is not a market figure.</p>' +
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
    else if (state.sort === 'category') sorted.sort(function (a, b) { return (a.category || '~').localeCompare(b.category || '~') || a.rank - b.rank; });
    else if (state.sort === 'odds') sorted.sort(function (a, b) { return b.token_odds - a.token_odds; });
    return sorted;
  }

  var maxImplied = rows.reduce(function (top, r) { return Math.max(top, r.implied_value_usd); }, 1);

  // The head of the radar as a bar chart: the twelve rows the board puts first.
  function drawChart() {
    var head = rows.slice(0, 12);
    var top = head.length ? head[0].implied_value_usd : 1;
    el('validationchip').textContent = 'holdout median error ' + (bestScore().holdout_mdape * 100).toFixed(0) + '% over ' + R.validation.holdout_size + ' priced protocols (' + R.validation.fit_size + ' fitted)';
    el('topchart').innerHTML = head.map(function (r) {
      var width = Math.max(2, Math.round((r.implied_value_usd / top) * 100));
      return '<button type="button" class="barrow" data-slug="' + esc(r.slug) + '">' +
        '<span class="barlabel">' + esc(r.name) + '<span class="slug"> · ' + esc(r.category || '—') + '</span></span>' +
        '<span class="bartrack"><i style="width:' + width + '%"></i></span>' +
        '<span class="barvalue">' + usd(r.implied_value_usd) + '</span></button>';
    }).join('');
  }

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
        '<td class="num">' + Math.round(r.token_odds * 100) + '%</td>' +
        '<td class="plan">' + r.farm_plan.length + ' steps · ' + esc(String(r.farm_plan[0].step).slice(0, 62)) + '…</td>' +
        '<td><button type="button" class="pin' + (state.pins.indexOf(r.slug) >= 0 ? ' is-on' : '') + '" data-pin="' + esc(r.slug) + '" title="' + (state.pins.indexOf(r.slug) >= 0 ? 'Unpin' : 'Pin to the shortlist') + '">' + (state.pins.indexOf(r.slug) >= 0 ? '★' : '＋') + '</button></td>' +
        '</tr>';
    }).join('');
    var what = state.view === 'watch' ? 'watchlist rows' : 'ranked pre-token rows';
    el('counts').textContent = out.length + ' of ' + rows.length + ' ' + what + ' shown' +
      (state.sort === 'rank' ? ', strongest implied value first' : ', sorted by ' + (SORT_LABEL[state.sort] || state.sort)) +
      ' — click any numbered column heading to sort by it';
    el('empty').hidden = out.length > 0;
    if (!out.length) el('empty').textContent = 'No row matches these filters. Widen the category, the chain or the TVL floor.';
    var livePanel = el('livePanel');
    var marketPanel = el('marketPanel');
    var validationPanel = el('validationPanel');
    livePanel.hidden = state.view !== 'live';
    marketPanel.hidden = state.view !== 'market';
    validationPanel.hidden = state.view !== 'validation';
    var boardHidden = state.view === 'live' || state.view === 'market' || state.view === 'validation' || state.view === 'compare';
    document.querySelector('.panel[aria-labelledby="boardh"]').hidden = boardHidden;
    el('kpis').hidden = state.view === 'validation';
    el('chartPanel').hidden = boardHidden;
    el('methodPanel').hidden = state.view === 'validation' ? false : boardHidden;
    el('controls').hidden = boardHidden;
    el('counts').hidden = boardHidden;
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
  var v = R.validation;
  var chosenScore = bestScore();
  // Every variant, the two splits and both directions, in one table.
  var variantRows = v.variants.map(function (score, i) {
    return '<tr><td>' + (i === v.chosen ? '<b>' + esc(score.name) + '</b>' : esc(score.name)) + (i === v.chosen ? ' <span class="badge">board uses this</span>' : '') + '</td>' +
      '<td class="num">' + score.terms.length + '</td>' +
      '<td class="num val">' + (score.holdout_mdape * 100).toFixed(1) + '%</td>' +
      '<td class="num">' + (score.fit_mdape * 100).toFixed(1) + '%</td>' +
      '<td class="num">' + score.within_half + '</td>' +
      '<td class="num">' + score.within_2x + '</td>' +
      '<td class="num">' + score.per_split.map(function (e) { return (e * 100).toFixed(0) + '%'; }).join(' / ') + '</td></tr>';
  }).join('');
  el('validation').innerHTML =
    '<div class="card" style="grid-column:1/-1"><h4>The variants, scored twice over</h4>' +
      '<table class="mini"><thead><tr><th>Variant</th><th class="num">Terms</th><th class="num">Held-out error</th><th class="num">Fit-half error</th><th class="num">Within half</th><th class="num">Within 2x</th><th class="num">Per split, both directions</th></tr></thead><tbody>' + variantRows + '</tbody></table>' +
      '<p class="note">Each variant is fitted on one half of the ' + (v.fit_size + v.holdout_size) + ' token-bearing protocols and priced on the other, then the halves swap, under two independent splits: four held-out measurements a variant, all in the table. The board uses the one with the lowest mean held-out error — today the ' + esc(R.fit.variant) + ' — so the arithmetic that ranks the board is the one the snapshot itself says prices its own tokens closest, and every term a rival model adds (growth, age, chains) is shown here with what it bought.</p></div>' +
    '<div class="card"><h4>The odds, fitted the same way</h4><dl class="kv">' +
      '<dt>Protocols fitted on</dt><dd>' + v.odds.fit_size + '</dd>' +
      '<dt>Called right, holdout half</dt><dd class="val">' + (v.odds.accuracy * 100).toFixed(1) + '%</dd>' +
      '<dt>Base rate to beat</dt><dd>' + (v.odds.base_rate * 100).toFixed(1) + '%</dd>' +
      '<dt>Brier score</dt><dd>' + v.odds.brier.toFixed(3) + '</dd></dl>' +
      '<p class="note">The odds are a logistic fit on the same snapshot, not a guess: TVL, age, chain count and the category token share, judged on the half it was not fitted on. ' + (v.odds.accuracy > v.odds.base_rate ? 'It beats the base rate, and not by much.' : 'It does not beat the base rate.') + '</p></div>' +
    '<div class="card"><h4>The split</h4><dl class="kv">' +
      '<dt>Token-bearing protocols</dt><dd>' + (v.fit_size + v.holdout_size) + '</dd>' +
      '<dt>Split by</dt><dd>two hashes of the slug</dd>' +
      '<dt>Band in force</dt><dd>×' + v.band_low.toFixed(2) + ' – ×' + v.band_high.toFixed(2) + '</dd>' +
      '<dt>Residual spread</dt><dd>' + v.sigma.toFixed(2) + ' log10</dd></dl>' +
    '<div class="card"><h4>What this does not mean</h4><p class="note">A pre-token protocol has no market cap to be wrong about, so the only checkable part of this radar is how it prices the protocols whose token already trades. A held-out error of ' + (bestScore().holdout_mdape * 100).toFixed(0) + '% is the size of the claim under every row, and the band on each row is that error made honest rather than a forecast.</p></div>';

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
        (r.on_watchlist ? ' · <span class="badge">watchlist</span>' : ' · off the watchlist, ranked by the model all the same') + '</div></div>' +
        '<div class="dvalue"><button type="button" class="reset" data-pin="' + esc(r.slug) + '">' + (state.pins.indexOf(r.slug) >= 0 ? '★ Pinned' : '＋ Pin to the shortlist') + '</button>' +
        '<div class="v">' + usdExact(r.implied_value_usd) + '</div>' +
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
           r.value_terms.map(function (t) { return '<dt>' + esc(t.label) + '</dt><dd>' + (t.contribution >= 0 ? '+' : '') + t.contribution.toFixed(3) + ' log10</dd>'; }).join('') +
           '<dt>Category offset (' + r.peer_basis + ', n=' + r.fitted_offset_sample + ')</dt><dd class="val">' + (r.fitted_offset >= 0 ? '+' : '') + r.fitted_offset.toFixed(3) + ' log10</dd>' +
           '<dt>Residual spread</dt><dd>±' + (r.fitted_sigma === null ? '-' : r.fitted_sigma.toFixed(2)) + ' log10</dd>' +
           '<dt>Comparison: multiple of TVL</dt><dd>' + times(r.peer_multiple) + '</dd>' +
          '<dt>Share of the board</dt><dd>' + (r.share_of_board * 100).toFixed(2) + '%</dd>' +
          '<dt>Token odds (the model\'s claim)</dt><dd>' + Math.round(r.token_odds * 100) + '%</dd></dl>' +
          '<div class="formula">' + r.value_terms.map(function (t) { return (t.contribution >= 0 ? '+' : '') + t.contribution.toFixed(3) + ' log10 from ' + t.label + ' (' + t.value.toFixed(3) + ' × ' + t.coefficient.toFixed(3) + ')'; }).join('\n') + '\n' +
          (r.fitted_offset >= 0 ? '+' : '') + r.fitted_offset.toFixed(3) + ' log10 from the category offset\n' +
          '= ' + usdExact(r.implied_value_usd) + '  (band ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + ')</div></div>' +
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
    parts.push(r.change_7d === null ? 'Its seven-day change is not reported: the holdout tested growth as a term in the line and priced it no better than leaving it out.' : 'Its TVL moved ' + pct(r.change_7d) + ' over seven days, a fact the page shows beside the value and the odds rather than folding into it.');
    parts.push(r.age_days === null ? 'DefiLlama reports no listing date, so its age without a token is unknown.' : 'It has run ' + r.age_days + ' days without a token, which the odds model uses and the value line does not.');
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
    var pin = event.target.closest('[data-pin]');
    if (pin) {
      event.stopPropagation();
      togglePin(pin.getAttribute('data-pin'));
      return;
    }
    var tr = event.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  el('topchart').addEventListener('click', function (event) {
    var bar = event.target.closest('[data-slug]');
    if (bar) openDetail(bar.getAttribute('data-slug'));
  });
  el('export').addEventListener('click', function () {
    var out = visible();
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'implied_low_usd', 'implied_high_usd', 'peer_multiple', 'peer_basis', 'peer_sample', 'token_odds'];
    var cell = function (value) {
      var text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    var lines = [head.join(',')];
    out.forEach(function (r) {
      lines.push([r.rank, r.slug, r.name, r.category || '', (r.chains || []).join(' '), r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, r.peer_multiple, r.peer_basis, r.peer_sample, r.token_odds].map(cell).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'token-radar-' + R.as_of + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
  el('close').addEventListener('click', closeDetail);
  el('detail').addEventListener('click', function (event) {
    var pin = event.target.closest('[data-pin]');
    if (pin) togglePin(pin.getAttribute('data-pin'));
  });
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
  var SORT_LABEL = { rank: 'implied value', tvl: 'TVL', growth: '7-day growth', age: 'age without a token', band: 'band width', name: 'name', category: 'category', odds: 'token odds' };
  Array.prototype.forEach.call(document.querySelectorAll('#headrow th.sortable'), function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      state.sort = key;
      if (el('sort').querySelector('option[value="' + key + '"]')) el('sort').value = key;
      Array.prototype.forEach.call(document.querySelectorAll('#headrow th'), function (other) { other.classList.remove('is-sorted'); });
      th.classList.add('is-sorted');
      render();
      push();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () { setView(tab.getAttribute('data-view')); });
  });
  function closeDetailIfOpen() { if (state.slug) closeDetail(); }

  // ---------------------------------------------------------------- shortlist and side by side
  function togglePin(slug) {
    var at = state.pins.indexOf(slug);
    if (at >= 0) state.pins.splice(at, 1);
    else state.pins.push(slug);
    storePins();
    renderPins();
    render();
    push();
  }

  function renderPins() {
    var pinned = state.pins.map(function (slug) { return bySlug[slug]; }).filter(Boolean);
    el('pinnedPanel').hidden = pinned.length === 0;
    el('pinnedList').innerHTML = pinned.map(function (r) {
      return '<div class="pinrow">' +
        '<span class="rank">#' + r.rank + '</span>' +
        '<span>' + esc(r.name) + ' <span class="slug">' + esc(r.category || '—') + '</span></span>' +
        '<span class="val">' + usd(r.implied_value_usd) + '</span>' +
        '<span class="meta">odds ' + Math.round(r.token_odds * 100) + '%</span>' +
        '<span class="meta">' + (r.on_watchlist ? 'watchlist' : 'off the watchlist') + '</span>' +
        '<span><button type="button" class="pin is-on" data-unpin="' + esc(r.slug) + '" title="Unpin">×</button>' +
        ' <button type="button" class="reset" data-solo="' + esc(r.slug) + '">Open</button></span>' +
      '</div>';
    }).join('');
    el('compare').hidden = pinned.length < 2;
    el('clearPins').hidden = pinned.length === 0;
  }

  el('pinnedList').addEventListener('click', function (event) {
    var unpin = event.target.closest('[data-unpin]');
    if (unpin) { togglePin(unpin.getAttribute('data-unpin')); return; }
    var solo = event.target.closest('[data-solo]');
    if (solo) { state.compare = []; openDetail(solo.getAttribute('data-solo')); }
  });
  el('clearPins').addEventListener('click', function () {
    state.pins = [];
    state.compare = [];
    storePins();
    setView(state.view === 'compare' ? 'pre' : state.view);
  });
  el('compare').addEventListener('click', function () {
    state.compare = state.pins.slice(0, 2);
    setView('compare');
  });
  function setView(view) {
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var on = tab.getAttribute('data-view') === view;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    closeDetailIfOpen();
    render();
    push();
  }

  function compareSide(r) {
    var peers = (peersByCategory[r.category || 'Uncategorised'] || []).slice(0, 5);
    var steps = r.farm_plan.slice(0, 4).map(function (s) {
      return '<li><div><div class="what">' + esc(s.step) + '</div><div class="when"><span>Cost:</span> ' + esc(s.cost) + ' · <span>Time:</span> ' + esc(s.time) + '</div></div></li>';
    }).join('');
    return '<div class="side">' +
      '<h3>#' + r.rank + ' ' + esc(r.name) + (r.on_watchlist ? '<span class="badge">watchlist</span>' : '') + '</h3>' +
      '<div class="dsub">' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ') || 'no chain recorded') + '</div>' +
      '<div class="card"><h4>Value</h4><dl class="kv">' +
        '<dt>Implied value</dt><dd class="val">' + usdExact(r.implied_value_usd) + '</dd>' +
        '<dt>Band</dt><dd>' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</dd>' +
        '<dt>TVL</dt><dd>' + usdExact(r.tvl_usd) + '</dd>' +
        '<dt>7-day change</dt><dd class="' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</dd>' +
        '<dt>Age without a token</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</dd>' +
        '<dt>Token odds</dt><dd>' + Math.round(r.token_odds * 100) + '%</dd>' +
        r.value_terms.map(function (t) { return '<dt>' + esc(t.label) + '</dt><dd>' + (t.contribution >= 0 ? '+' : '') + t.contribution.toFixed(3) + ' log10</dd>'; }).join('') +
        '<dt>Category offset</dt><dd>' + (r.fitted_offset >= 0 ? '+' : '') + r.fitted_offset.toFixed(3) + ' log10 (n=' + r.fitted_offset_sample + ')</dd>' +
      '<div class="card"><h4>First steps</h4><ol class="steps">' + steps + '</ol></div>' +
      '<div class="card"><h4>Comparison set</h4>' + (peers.length ? '<table class="mini"><tbody>' + peers.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + times(p.multiple) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="note">No token-bearing peer in this category.</p>') + '</div>' +
      '<button type="button" class="reset" data-solo="' + esc(r.slug) + '">Open the full detail view</button>' +
    '</div>';
  }

  function renderCompare() {
    var sides = state.compare.map(function (slug) { return bySlug[slug]; }).filter(Boolean);
    var ok = sides.length === 2;
    el('comparePanel').hidden = state.view !== 'compare';
    if (!ok) {
      el('compareGrid').innerHTML = '<p class="empty">Pin two protocols and press Compare, or open this view with ?compare=&lt;slug&gt;,&lt;slug&gt;. ' + state.pins.length + ' pinned so far.</p>';
      el('compareNote').textContent = '';
      return;
    }
    el('compareNote').textContent = 'The same arithmetic, side by side: what each protocol is worth under the fitted model, what it would take to farm, and which peers its multiple comes from.';
    el('compareGrid').innerHTML = compareSide(sides[0]) + compareSide(sides[1]);
  }
  el('compareGrid').addEventListener('click', function (event) {
    var solo = event.target.closest('[data-solo]');
    if (solo) openDetail(solo.getAttribute('data-solo'));
  });

  // ---------------------------------------------------------------- first paint
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    var on = tab.getAttribute('data-view') === state.view;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  drawChart();
  renderPins();
  render();
  renderCompare();
  if (state.slug && bySlug[state.slug]) openDetail(state.slug);
  document.getElementById('board').setAttribute('aria-busy', 'false');
})();
