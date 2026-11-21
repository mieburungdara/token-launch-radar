// The radar's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// Every protocol that records no token (no market cap, no CoinGecko id, no symbol) is a launch candidate.
// A candidate is valued from the snapshot's own figures alone, never from a list of names:
//
//   peer      = the market-cap-to-TVL multiple of the snapshot's token-bearing protocols in the same
//               category, each peer's multiple first winsorised to the market's 10th and 90th percentile so
//               one mispriced peer cannot carry a category, then shrunk toward the whole market's median by
//               MIN_PEERS pseudo-observations: peer = (n x category_median + MIN_PEERS x market_median) /
//               (n + MIN_PEERS)
//   base      = tvl_usd x peer
//   growth    = clamp(change_7d, -50, 150) per cent, weighted GROWTH_WEIGHT, 1.0 when unreported
//   maturity  = 0.75 + min(age_days, MATURITY_DAYS) / MATURITY_DAYS x 0.45   (age unknown: 0.90)
//   reach     = 1 + min(chains, 4) x 0.02      (a protocol live on more chains reaches more users)
//   implied   = max(1, round(base x growth x maturity x reach))
//
// The band is the same arithmetic at the 25th and 75th percentile peer multiple, so every row carries the
// spread its own comparison set shows rather than a single number with no error bar.
//
//   odds      = 0.35 x age factor x size factor x category factor, clamped to 0.02..0.95: the model's own
//               estimate that the protocol issues a token at all, kept apart from the value so a reader can
//               weigh a certain small protocol against a doubtful large one
//
// The estimator is checked against the snapshot itself: the token-bearing protocols are split by a hash of
// their slug into a fit half and a holdout half, the multiples are fitted on the fit half, and the market cap
// they predict is compared with the one the market actually prices on both halves. The report on the page is
// the holdout half's median absolute error: a model that cannot price the protocols whose token already
// trades says nothing about the ones that have none.
//
// Wrapped, staked, bridged and exchange-run products are not launch candidates: they are somebody else's
// token under another name. They are counted and set aside, never ranked.

/** One protocol, exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the page so a reader can audit the arithmetic. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_multiplier: number;
  chains_step: number;
  chains_cap: number;
  min_peers: number;
  /** Every peer's multiple is winsorised to these percentiles of the market's before a category reads it. */
  winsor_low_percentile: number;
  winsor_high_percentile: number;
  /** The odds model: a base rate, how far age and category push it, and the clamp. */
  odds_base: number;
  odds_age_weight: number;
  odds_category_weight: number;
  odds_floor: number;
  odds_cap: number;
  band_low_percentile: number;
  band_high_percentile: number;
  step_cost_note: string;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.45,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_multiplier: 0.9,
  chains_step: 0.02,
  chains_cap: 4,
  min_peers: 8,
  band_low_percentile: 0.25,
  band_high_percentile: 0.75,
  winsor_low_percentile: 0.1,
  winsor_high_percentile: 0.9,
  odds_base: 0.35,
  odds_age_weight: 0.6,
  odds_category_weight: 0.5,
  odds_floor: 0.02,
  odds_cap: 0.95,
  step_cost_note: 'costs are the ones a first-week farmer pays in gas, bridge and deposit fees only',
};

export const MODEL_VERSION = 'radar-2-comparables';

/** A farm store: what to do, what it costs, how long it takes. */
export interface FarmStep {
  step: string;
  cost: string;
  time: string;
}

/** One ranked row of the board, with the arithmetic that produced its value. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  peer_multiple: number;
  peer_basis: 'category' | 'shrunk' | 'market';
  peer_sample: number;
  peer_weight: number;
  peer_low_multiple: number;
  peer_high_multiple: number;
  fitted_intercept: number | null;
  fitted_slope: number | null;
  fitted_offset: number;
  fitted_offset_sample: number;
  fitted_sigma: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  share_of_board: number;
  token_odds: number;
  farm_steps: string[];
  farm_plan: FarmStep[];
}

/** A protocol whose token already trades: the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
  listed_at: string | null;
}

/** One category's comparison set, as the page's market column shows it. */
export interface CategoryMarket {
  category: string;
  peers: number;
  median_multiple: number;
  low_multiple: number;
  high_multiple: number;
  pre_token: number;
}

/** Everything the page renders, written beside it as data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  candidate_size: number;
  set_aside_size: number;
  live_size: number;
  market_median_multiple: number;
  board_implied_total: number;
  uncategorised: number;
  validation: HoldoutReport;
  fit: { intercept: number; slope: number; sigma: number };
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryMarket[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DAY_MS = 86_400_000;

/** The whole days from the snapshot's own date back to a listing date, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const then = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** The value at a percentile (0..1) of sorted numbers, by linear interpolation. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  if (low === high) return sorted[low]!;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

function median(sorted: number[]): number {
  return percentile(sorted, 0.5);
}

/** A protocol that records no token at all: the radar's subject. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the snapshot lets a protocol's multiple be read: a token and a TVL to divide by. */
export function hasTradedMultiple(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const SET_ASIDE_WORDS = /(^|\s)(wrapped|staked|staking)(\s|$)/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a protocol is somebody else's token under another name, or null when it is nobody's yet. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (SET_ASIDE_WORDS.test(p.name)) return 'a wrapped or staked product';
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return `a product of ${prefix}`;
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  return null;
}

/** One group's multiple: its median and the quartiles the band is read from. */
export interface MultipleStat {
  median: number;
  low: number;
  high: number;
  sample: number;
  /** How much of the group's own median survives the shrink toward the market's (0..1). */
  weight: number;
}

/** The multiple each category gets, the whole market's, and the sample each rests on. */
export interface PeerIndex {
  byCategory: Map<string, MultipleStat>;
  market: MultipleStat;
}

/** What each estimator scores when it is asked to price the protocols whose token already trades. */
export interface HoldoutReport {
  fit_size: number;
  holdout_size: number;
  constant: EstimatorScore;
  fitted: EstimatorScore;
  chosen: 'constant' | 'fitted';
  /** The fitted model's residual spread in log10 dollars, kept as the loose reading of the band. */
  sigma: number;
  /** The middle half of the holdout half's actual-over-predicted ratios: the band the page shows. */
  band_low: number;
  band_high: number;
}

/** FNV-1a over a slug: which half a protocol is fitted on, stable for the sealed snapshot. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** One group's own median and quartiles. */
function statOf(values: number[]): { median: number; low: number; high: number; sample: number } {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    median: median(sorted),
    low: percentile(sorted, 0.25),
    high: percentile(sorted, 0.75),
    sample: sorted.length,
  };
}

/** The same, over any set of protocols: what the holdout check fits its multiples on. */
export function peerIndexOf(protocols: SnapshotProtocol[], model: ModelConstants): PeerIndex {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (!hasTradedMultiple(p)) continue;
    const multiple = p.mcap_usd! / p.tvl_usd;
    all.push(multiple);
    const key = p.category ?? 'Uncategorised';
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [multiple]);
    else list.push(multiple);
  }
  const marketStat = statOf(all);
  const market: MultipleStat = { ...marketStat, weight: 1 };
  const sortedAll = all.slice().sort((a, b) => a - b);
  const floorMultiple = percentile(sortedAll, model.winsor_low_percentile);
  const ceilingMultiple = percentile(sortedAll, model.winsor_high_percentile);
  const winsorise = (value: number): number => Math.min(ceilingMultiple, Math.max(floorMultiple, value));
  const byCategory = new Map<string, MultipleStat>();
  for (const [category, values] of groups) {
    const own = statOf(values.map(winsorise));
    const weight = own.sample / (own.sample + model.min_peers);
    const blend = (a: number, b: number): number => a * weight + b * (1 - weight);
    byCategory.set(category, {
      median: blend(own.median, market.median),
      low: blend(own.low, market.low),
      high: blend(own.high, market.high),
      sample: own.sample,
      weight,
    });
  }
  return { byCategory, market };
}

/** Each category's multiple over the whole snapshot. */
export function peerIndex(snapshot: Snapshot, model: ModelConstants): PeerIndex {
  return peerIndexOf(snapshot.protocols, model);
}

/** The multiple one protocol gets under an index: its category's, or the market's when the category is thin. */
export function multipleFor(protocol: SnapshotProtocol, index: PeerIndex): number {
  const match = index.byCategory.get(protocol.category ?? 'Uncategorised');
  return match === undefined ? index.market.median : match.median;
}

/** A log-log fit of market cap on TVL, with a shrunk offset per category, and the residual spread. */
export interface LogFit {
  intercept: number;
  slope: number;
  sigma: number;
  offsets: Map<string, number>;
  offset_samples: Map<string, number>;
}

const LOG10 = Math.log10;

/** Fit log10(market cap) = intercept + slope x log10(TVL), plus each category's shrunk median residual. */
export function fitLogLog(protocols: SnapshotProtocol[], model: ModelConstants): LogFit {
  const points = protocols.filter(hasTradedMultiple).map((p) => ({ p, x: LOG10(p.tvl_usd), y: LOG10(p.mcap_usd!) }));
  if (points.length < 8) {
    return { intercept: LOG10(0.2), slope: 1, sigma: 0.6, offsets: new Map(), offset_samples: new Map() };
  }
  const meanX = points.reduce((sum, q) => sum + q.x, 0) / points.length;
  const meanY = points.reduce((sum, q) => sum + q.y, 0) / points.length;
  let cov = 0;
  let varX = 0;
  for (const q of points) {
    cov += (q.x - meanX) * (q.y - meanY);
    varX += (q.x - meanX) ** 2;
  }
  const slope = varX === 0 ? 1 : cov / varX;
  const intercept = meanY - slope * meanX;
  const byCategory = new Map<string, number[]>();
  const residuals: number[] = [];
  for (const q of points) {
    const residual = q.y - (intercept + slope * q.x);
    residuals.push(residual);
    const key = q.p.category ?? 'Uncategorised';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [residual]);
    else list.push(residual);
  }
  const offsets = new Map<string, number>();
  const offset_samples = new Map<string, number>();
  for (const [category, values] of byCategory) {
    const own = median(values.slice().sort((a, b) => a - b));
    const weight = values.length / (values.length + model.min_peers);
    offsets.set(category, own * weight);
    offset_samples.set(category, values.length);
  }
  const absolute = residuals.map(Math.abs).sort((a, b) => a - b);
  return { intercept, slope, sigma: 1.4826 * median(absolute), offsets, offset_samples };
}

/** What the fit predicts for a protocol, in dollars, before the growth, maturity and reach terms. */
export function predictFromFit(protocol: SnapshotProtocol, fit: LogFit): number {
  const offset = fit.offsets.get(protocol.category ?? 'Uncategorised') ?? 0;
  return 10 ** (fit.intercept + fit.slope * LOG10(Math.max(protocol.tvl_usd, 1)) + offset);
}

/** One estimator's score: its median absolute error on the half it was fitted on and on the half it was not. */
export interface EstimatorScore {
  name: string;
  fit_mdape: number;
  holdout_mdape: number;
  holdout_within_2x: number;
  holdout_within_half: number;
}

/** Score one predictor of a protocol's market cap against the market's own figure. */
function scoreEstimator(
  name: string,
  fit: SnapshotProtocol[],
  holdout: SnapshotProtocol[],
  predict: (p: SnapshotProtocol) => number,
): EstimatorScore {
  const errors = (set: SnapshotProtocol[]): number[] =>
    set.map((p) => Math.abs(predict(p) - p.mcap_usd!) / p.mcap_usd!).sort((a, b) => a - b);
  const fitErrors = errors(fit);
  const holdoutErrors = errors(holdout);
  return {
    name,
    fit_mdape: median(fitErrors),
    holdout_mdape: median(holdoutErrors),
    holdout_within_2x: holdoutErrors.filter((e) => e <= 1).length,
    holdout_within_half: holdoutErrors.filter((e) => e <= 0.5).length,
  };
}

/** Both estimators, fitted on half the token-bearing protocols and judged on the other half. */
export function holdoutReport(snapshot: Snapshot, model: ModelConstants): HoldoutReport {
  const priced = snapshot.protocols.filter(hasTradedMultiple);
  const fit = priced.filter((p) => fnv1a(p.slug) % 2 === 0);
  const holdout = priced.filter((p) => fnv1a(p.slug) % 2 === 1);
  const index = peerIndexOf(fit, model);
  const logFit = fitLogLog(fit, model);
  const constant = scoreEstimator('multiple of TVL', fit, holdout, (p) => p.tvl_usd * multipleFor(p, index));
  const fitted = scoreEstimator('log-log fit', fit, holdout, (p) => predictFromFit(p, logFit));
  const ratios = holdout.map((p) => p.mcap_usd! / predictFromFit(p, logFit)).sort((a, b) => a - b);
  return {
    fit_size: fit.length,
    holdout_size: holdout.length,
    constant,
    fitted,
    chosen: fitted.holdout_mdape <= constant.holdout_mdape ? 'fitted' : 'constant',
    sigma: logFit.sigma,
    band_low: percentile(ratios, model.band_low_percentile),
    band_high: percentile(ratios, model.band_high_percentile),
  };
}

/** One protocol's value under the model, with every multiplier named. */
export interface Valuation {
  implied: number;
  low: number;
  high: number;
  fitted_intercept: number | null;
  fitted_slope: number | null;
  fitted_offset: number;
  fitted_offset_sample: number;
  fitted_sigma: number | null;
  peerMultiple: number;
  peerLow: number;
  peerHigh: number;
  peerBasis: 'category' | 'shrunk' | 'market';
  peerSample: number;
  peerWeight: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  reachMultiplier: number;
  age: number | null;
}

export function valueProtocol(
  p: SnapshotProtocol,
  asOf: string,
  peers: PeerIndex,
  model: ModelConstants,
  fit: LogFit | null = null,
  band: { low: number; high: number } | null = null,
): Valuation {
  const category = p.category ?? 'Uncategorised';
  const match = peers.byCategory.get(category);
  const peer = match ?? peers.market;
  const basis: 'category' | 'shrunk' | 'market' = match === undefined ? 'market' : match.sample >= model.min_peers ? 'category' : 'shrunk';
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d ?? 0));
  const growthMultiplier = p.change_7d === null ? 1 : 1 + (growthPct / 100) * model.growth_weight;
  const maturityMultiplier =
    age === null
      ? model.unknown_age_multiplier
      : model.maturity_floor + (Math.min(age, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const reachMultiplier = 1 + Math.min(Math.max(p.chains.length, 1), model.chains_cap) * model.chains_step;
  const scale = growthMultiplier * maturityMultiplier * reachMultiplier;
  const round = (value: number): number => Math.max(1, Math.round(value));
  const base = fit === null ? p.tvl_usd * peer.median : predictFromFit(p, fit);
  const spread = band === null ? (fit === null ? null : 10 ** fit.sigma) : null;
  return {
    implied: round(base * scale),
    low: round((band !== null ? base * band.low : spread === null ? p.tvl_usd * peer.low : base / spread) * scale),
    high: round((band !== null ? base * band.high : spread === null ? p.tvl_usd * peer.high : base * spread) * scale),
    fitted_intercept: fit === null ? null : fit.intercept,
    fitted_slope: fit === null ? null : fit.slope,
    fitted_offset: fit === null ? 0 : fit.offsets.get(category) ?? 0,
    fitted_offset_sample: fit === null ? 0 : fit.offset_samples.get(category) ?? 0,
    fitted_sigma: fit === null ? null : fit.sigma,
    peerMultiple: peer.median,
    peerLow: peer.low,
    peerHigh: peer.high,
    peerBasis: basis,
    peerSample: peer.sample,
    peerWeight: match === undefined ? 0 : match.weight,
    growthMultiplier,
    maturityMultiplier,
    reachMultiplier,
    age,
  };
}

/** How often a category's protocols already carry a token: 0..1, the model's own reason for its odds. */
export function categoryTokenShare(snapshot: Snapshot): Map<string, number> {
  const total = new Map<string, number>();
  const withToken = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Uncategorised';
    total.set(key, (total.get(key) ?? 0) + 1);
    if (p.mcap_usd !== null && p.mcap_usd > 0) withToken.set(key, (withToken.get(key) ?? 0) + 1);
  }
  const share = new Map<string, number>();
  for (const [key, count] of total) share.set(key, count === 0 ? 0 : (withToken.get(key) ?? 0) / count);
  return share;
}

/** The model's own estimate that a protocol issues a token at all: 0.02..0.95, and never a fact. */
export function tokenOdds(
  p: SnapshotProtocol,
  asOf: string,
  sizePercentile: number,
  tokenShare: number,
  model: ModelConstants,
): number {
  const age = ageDays(asOf, p.listed_at);
  const ageFactor = age === null ? 1 : 1 + (Math.min(age, model.maturity_days) / model.maturity_days) * model.odds_age_weight;
  const sizeFactor = 0.7 + Math.min(Math.max(sizePercentile, 0), 1) * 1.3;
  const categoryFactor = 1 + Math.min(Math.max(tokenShare, 0), 1) * model.odds_category_weight;
  const odds = model.odds_base * ageFactor * sizeFactor * categoryFactor;
  return Math.min(model.odds_cap, Math.max(model.odds_floor, Math.round(odds * 1000) / 1000));
}

/** Every slug that must appear on the board, whatever the model thinks of it. */
function chosenProtocols(snapshot: Snapshot): Map<string, SnapshotProtocol> {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !recordsNoToken(p)) continue;
    if (setAsideReason(p) !== null) continue;
    chosen.set(p.slug, p);
  }
  return chosen;
}

/** The board: every candidate ranked by implied value, ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  fit: LogFit | null = null,
  band: { low: number; high: number } | null = null,
): RadarRow[] {
  const peers = peerIndex(snapshot, model);
  const chosen = chosenProtocols(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const tvls = [...chosen.values()].map((p) => p.tvl_usd).sort((a, b) => a - b);
  const atOrBelow = (value: number): number => {
    let low = 0;
    let high = tvls.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tvls[mid]! <= value) low = mid + 1;
      else high = mid;
    }
    return tvls.length === 0 ? 0.5 : low / tvls.length;
  };
  const shares = categoryTokenShare(snapshot);
  const scored = [...chosen.values()].map((p) => ({
    p,
    v: valueProtocol(p, snapshot.as_of, peers, model, fit, band),
    odds: tokenOdds(p, snapshot.as_of, atOrBelow(p.tvl_usd), shares.get(p.category ?? 'Uncategorised') ?? 0, model),
  }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const total = scored.reduce((sum, s) => sum + s.v.implied, 0);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    on_watchlist: watchlist.has(s.p.slug),
    peer_multiple: s.v.peerMultiple,
    peer_basis: s.v.peerBasis,
    peer_sample: s.v.peerSample,
    peer_weight: s.v.peerWeight,
    peer_low_multiple: s.v.peerLow,
    peer_high_multiple: s.v.peerHigh,
    fitted_intercept: s.v.fitted_intercept,
    fitted_slope: s.v.fitted_slope,
    fitted_offset: s.v.fitted_offset,
    fitted_offset_sample: s.v.fitted_offset_sample,
    fitted_sigma: s.v.fitted_sigma,
    growth_multiplier: s.v.growthMultiplier,
    maturity_multiplier: s.v.maturityMultiplier,
    reach_multiplier: s.v.reachMultiplier,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    share_of_board: total === 0 ? 0 : s.v.implied / total,
    token_odds: s.odds,
    farm_steps: [],
    farm_plan: [],
  }));
}

/** The token-bearing protocols, strongest market cap first, as the page's market column. */
export function liveProtocols(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter(hasTradedMultiple)
    .slice()
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0,
      listed_at: p.listed_at,
    }));
}

/** Every category's comparison set, most peers first. */
export function categoryMarkets(snapshot: Snapshot, peers: PeerIndex, board: RadarRow[]): CategoryMarket[] {
  const preToken = new Map<string, number>();
  for (const row of board) {
    const key = row.category ?? 'Uncategorised';
    preToken.set(key, (preToken.get(key) ?? 0) + 1);
  }
  const out: CategoryMarket[] = [];
  for (const [category, stat] of peers.byCategory) {
    out.push({
      category,
      peers: stat.sample,
      median_multiple: stat.median,
      low_multiple: stat.low,
      high_multiple: stat.high,
      pre_token: preToken.get(category) ?? 0,
    });
  }
  out.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  return out;
}

/** The district the snapshot does not name: closed categories it records no multiple for. */
export function uncategorisedCount(snapshot: Snapshot): number {
  return snapshot.protocols.filter((p) => recordsNoToken(p) && p.category === null).length;
}

/** Read and check the snapshot: every field the model reads, or a named error. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SnapshotError(`snapshot.json is not JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate takes, or null: coverage, ranks, order and farm steps. */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows: the gate takes 100 or more`;
  if (board.length > 4000) return `the board holds ${board.length} rows: the gate takes 4000 or fewer`;
  const slugs = new Set(board.map((r) => r.slug));
  const knowable = new Set(snapshot.protocols.map((p) => p.slug));
  for (const slug of slugs) if (!knowable.has(slug)) return `${slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  const distinct = new Set(board.map((r) => r.implied_value_usd));
  if (distinct.size < 2) return `all ${board.length} rows share one implied value`;
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
    if (row.implied_value_usd > 100_000_000_000_000) return `${row.slug} has implied value ${row.implied_value_usd}: the gate takes at most 100000000000000`;
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      const text = typeof step === 'string' ? step : '';
      const length = text.trim().length;
      if (length < 20 || length > 600) return `${row.slug} has a farm step of ${length} characters`;
    }
  }
  return null;
}

/** One board row as the page's compact dataset: the farm plan is regenerated in the page from the same facts. */
export function boardJson(board: RadarRow[], snapshot: Snapshot, model: ModelConstants = MODEL): string {
  const rows = board.map((row) => ({
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    peer_multiple: row.peer_multiple,
    peer_basis: row.peer_basis,
    peer_sample: row.peer_sample,
    peer_weight: row.peer_weight,
    peer_low_multiple: row.peer_low_multiple,
    peer_high_multiple: row.peer_high_multiple,
    growth_multiplier: row.growth_multiplier,
    maturity_multiplier: row.maturity_multiplier,
    reach_multiplier: row.reach_multiplier,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    farm_steps: row.farm_steps.map((s) => s.step),
  }));
  return `${JSON.stringify({ as_of: snapshot.as_of, model_version: MODEL_VERSION, floor_usd: snapshot.floor_usd, model, rows }, null, 1)}\n`;
}

/** The page's whole dataset as one script: no fetch, no network, one assignment. */
export function dataScript(data: RadarData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}
