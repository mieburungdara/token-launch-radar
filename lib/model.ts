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
//   odds      = a logistic fit on log TVL, log age, log chains and the category's own token share, on the
//               snapshot's own records of which protocols carry a token; kept apart from the value so a
//               reader can weigh a certain small protocol against a doubtful large one
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
  /** The odds fit: how many gradient steps it takes and how hard it regularises. */
  odds_steps: number;
  odds_rate: number;
  odds_decay: number;
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
  odds_steps: 600,
  odds_rate: 1.5,
  odds_decay: 0.001,
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
  fitted_offset: number;
  fitted_offset_sample: number;
  fitted_sigma: number | null;
  value_terms: ValueTerm[];
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
  fit: { terms: number; coefficients: number[]; sigma: number; names: string[]; variant: string };
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
  tvl_only: EstimatorScore;
  fitted: EstimatorScore;
  chosen: 'constant' | 'tvl' | 'full';
  /** The multi-term fit's residual spread in log10 dollars, kept as the loose reading of the band. */
  sigma: number;
  /** The middle half of the holdout half's actual-over-predicted ratios: the band the page shows. */
  band_low: number;
  band_high: number;
  odds: OddsScore;
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

/** The terms the size model may read: each enters the line as a number the line is linear in. */
export const SIZE_TERMS = ['log10 TVL', '7-day growth over 100', 'log10 age in days', 'log10 chains'] as const;
export type SizeTerm = 'tvl' | 'growth' | 'age' | 'chains';

/** The variants the holdout judges, one term added each time. */
export const SIZE_VARIANTS: SizeTerm[][] = [
  [],
  ['tvl'],
  ['tvl', 'growth'],
  ['tvl', 'growth', 'age'],
  ['tvl', 'growth', 'age', 'chains'],
];

/** A line of log10(market cap) on the terms a variant takes, with each category's shrunk residual. */
export interface LogFit {
  terms: SizeTerm[];
  /** [intercept, ...one per term]. */
  coefficients: number[];
  sigma: number;
  offsets: Map<string, number>;
  offset_samples: Map<string, number>;
}

const LOG10 = Math.log10;
const UNLISTED_AGE_DAYS = 365;

/** One term's value for one protocol, as the line reads it. */
export function termValue(protocol: SnapshotProtocol, asOf: string, term: SizeTerm, model: ModelConstants): number {
  if (term === 'tvl') return LOG10(Math.max(protocol.tvl_usd, 1));
  if (term === 'growth') {
    const raw = protocol.change_7d;
    if (raw === null) return 0;
    return Math.min(model.growth_cap, Math.max(model.growth_floor, raw)) / 100;
  }
  if (term === 'age') {
    const age = ageDays(asOf, protocol.listed_at);
    return LOG10((age === null ? UNLISTED_AGE_DAYS : age) + 1);
  }
  return LOG10(Math.max(protocol.chains.length, 1));
}

/** The design row of one protocol under a variant. */
function designRow(protocol: SnapshotProtocol, asOf: string, terms: SizeTerm[], model: ModelConstants): number[] {
  const row = [1];
  for (const term of terms) row.push(termValue(protocol, asOf, term, model));
  return row;
}

/** Solve a small square system by Gaussian elimination with partial pivoting, or null when it is singular. */
function solveSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const rows = matrix.map((row, i) => [...row, vector[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(rows[row]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = row;
    if (Math.abs(rows[pivot]![col]!) < 1e-12) return null;
    const swap = rows[col]!;
    rows[col] = rows[pivot]!;
    rows[pivot] = swap;
    for (let row = col + 1; row < n; row++) {
      const factor = rows[row]![col]! / rows[col]![col]!;
      for (let k = col; k <= n; k++) rows[row]![k] = rows[row]![k]! - factor * rows[col]![k]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rows[row]![n]!;
    for (let col = row + 1; col < n; col++) sum -= rows[row]![col]! * out[col]!;
    out[row] = sum / rows[row]![row]!;
  }
  return out;
}

/** Fit the line by least squares, then read each category's residual median into a shrunk offset. */
export function fitLogLog(protocols: SnapshotProtocol[], model: ModelConstants, asOf: string, terms: SizeTerm[]): LogFit {
  const points = protocols.filter(hasTradedMultiple);
  const width = terms.length + 1;
  const fallback: LogFit = { terms, coefficients: new Array<number>(width).fill(0).map((_, i) => (i === 1 ? 1 : 0)), sigma: 0.6, offsets: new Map(), offset_samples: new Map() };
  if (points.length < width + 4) return fallback;
  const normal: number[][] = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  const target = new Array<number>(width).fill(0);
  for (const p of points) {
    const x = designRow(p, asOf, terms, model);
    const y = LOG10(p.mcap_usd!);
    for (let i = 0; i < width; i++) {
      target[i] += x[i]! * y;
      for (let j = 0; j < width; j++) normal[i]![j] += x[i]! * x[j]!;
    }
  }
  const coefficients = solveSystem(normal, target);
  if (coefficients === null) return fallback;
  const byCategory = new Map<string, number[]>();
  const residuals: number[] = [];
  for (const p of points) {
    const x = designRow(p, asOf, terms, model);
    let line = 0;
    for (let i = 0; i < width; i++) line += coefficients[i]! * x[i]!;
    const residual = LOG10(p.mcap_usd!) - line;
    residuals.push(residual);
    const key = p.category ?? 'Uncategorised';
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
  return { terms, coefficients, sigma: 1.4826 * median(absolute), offsets, offset_samples };
}

/** What the line predicts for a protocol, in dollars: the fitted value under the model. */
export function predictFromFit(protocol: SnapshotProtocol, fit: LogFit, asOf: string, model: ModelConstants): number {
  const x = designRow(protocol, asOf, fit.terms, model);
  let line = 0;
  for (let i = 0; i < x.length; i++) line += fit.coefficients[i]! * x[i]!;
  return 10 ** (line + (fit.offsets.get(protocol.category ?? 'Uncategorised') ?? 0));
}

/** One term of one row's line, as the page shows it. */
export interface ValueTerm {
  term: SizeTerm;
  label: string;
  value: number;
  coefficient: number;
  contribution: number;
}

/** An estimator's score over both splits, in both directions. */
export interface VariantScore {
  name: string;
  terms: SizeTerm[];
  holdout_mdape: number;
  fit_mdape: number;
  holdout_size: number;
  within_half: number;
  within_2x: number;
  /** Each split's two held-out errors, in order. */
  per_split: number[];
}

/** How the fitted odds score on the half of the snapshot they were not fitted on. */
export interface OddsScore {
  fit_size: number;
  holdout_size: number;
  base_rate: number;
  accuracy: number;
  fit_accuracy: number;
  brier: number;
}

/** Which half a protocol falls in, under one of two independent splits of the priced set. */
function splitSide(slug: string, split: number): number {
  return fnv1a(split === 0 ? slug : slug + '#split' + split) % 2;
}

/** One protocol's value under the model: the fitted line, its terms, and the band the holdout ratios set. */
export interface Valuation {
  implied: number;
  low: number;
  high: number;
  fitted_offset: number;
  fitted_offset_sample: number;
  fitted_sigma: number | null;
  peerMultiple: number;
  peerLow: number;
  peerHigh: number;
  peerBasis: 'category' | 'shrunk' | 'market';
  peerSample: number;
  peerWeight: number;
  terms: ValueTerm[];
  age: number | null;
}

/** The label one term carries on the page. */
function termLabel(term: SizeTerm): string {
  if (term === 'tvl') return 'TVL';
  if (term === 'growth') return 'seven-day growth, clamped';
  if (term === 'age') return 'age without a token';
  return 'chains it runs on';
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
  const round = (value: number): number => Math.max(1, Math.round(value));
  const base = fit === null ? p.tvl_usd * peer.median : predictFromFit(p, fit, asOf, model);
  const terms: ValueTerm[] = [];
  if (fit !== null) {
    for (let i = 0; i < fit.terms.length; i++) {
      const term = fit.terms[i]!;
      const value = termValue(p, asOf, term, model);
      const coefficient = fit.coefficients[i + 1] ?? 0;
      terms.push({ term, label: termLabel(term), value, coefficient, contribution: coefficient * value });
    }
  }
  const lowRatio = band === null ? null : band.low;
  const highRatio = band === null ? null : band.high;
  const loose = band === null ? (fit === null ? null : 10 ** fit.sigma) : null;
  const lowFactor = lowRatio ?? (loose === null ? null : 1 / loose);
  const highFactor = highRatio ?? loose;
  return {
    implied: round(base),
    low: round(lowFactor === null ? p.tvl_usd * peer.low : base * lowFactor),
    high: round(highFactor === null ? p.tvl_usd * peer.high : base * highFactor),
    fitted_offset: fit === null ? 0 : fit.offsets.get(category) ?? 0,
    fitted_offset_sample: fit === null ? 0 : fit.offset_samples.get(category) ?? 0,
    fitted_sigma: fit === null ? null : fit.sigma,
    peerMultiple: peer.median,
    peerLow: peer.low,
    peerHigh: peer.high,
    peerBasis: basis,
    peerSample: peer.sample,
    peerWeight: match === undefined ? 0 : match.weight,
    terms,
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
  const shares = categoryTokenShare(snapshot);
  const odds = fitOdds(snapshot.protocols.filter((p) => p.tvl_usd > 0), snapshot.as_of, shares, model);
  const scored = [...chosen.values()].map((p) => ({
    p,
    v: valueProtocol(p, snapshot.as_of, peers, model, fit, band),
    odds: predictOdds(p, snapshot.as_of, shares.get(p.category ?? 'Uncategorised') ?? 0, odds),
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
    fitted_offset: s.v.fitted_offset,
    fitted_offset_sample: s.v.fitted_offset_sample,
    fitted_sigma: s.v.fitted_sigma,
    value_terms: s.v.terms,
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
    value_terms: row.value_terms,
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


/** The odds model: a logistic line on four terms, fitted on the snapshot's own token records. */
export interface OddsModel {
  mean: number[];
  sd: number[];
  weights: number[];
  bias: number;
}

/** What the odds model reads. */
export const ODDS_TERMS = ['log10 TVL', 'log10 age in days', 'log10 chains', 'the category token share'] as const;

function oddsVector(protocol: SnapshotProtocol, asOf: string, tokenShare: number): number[] {
  const age = ageDays(asOf, protocol.listed_at);
  return [
    LOG10(Math.max(protocol.tvl_usd, 1)),
    LOG10((age === null ? UNLISTED_AGE_DAYS : age) + 1),
    LOG10(Math.max(protocol.chains.length, 1)),
    Math.min(Math.max(tokenShare, 0), 1),
  ];
}

/** Fit the odds by gradient descent on a standardised design: no randomness, the same line every run. */
export function fitOdds(protocols: SnapshotProtocol[], asOf: string, shares: Map<string, number>, model: ModelConstants): OddsModel {
  const rows = protocols.map((p) => ({
    x: oddsVector(p, asOf, shares.get(p.category ?? 'Uncategorised') ?? 0),
    y: recordsNoToken(p) ? 0 : 1,
  }));
  const width = 4;
  const mean = new Array<number>(width).fill(0);
  const sd = new Array<number>(width).fill(1);
  if (rows.length === 0) return { mean, sd, weights: new Array<number>(width).fill(0), bias: -1 };
  for (let i = 0; i < width; i++) mean[i] = rows.reduce((sum, r) => sum + r.x[i]!, 0) / rows.length;
  for (let i = 0; i < width; i++) {
    const variance = rows.reduce((sum, r) => sum + (r.x[i]! - mean[i]!) ** 2, 0) / rows.length;
    sd[i] = Math.sqrt(variance) > 1e-9 ? Math.sqrt(variance) : 1;
  }
  const weights = new Array<number>(width).fill(0);
  const rate = rows.reduce((sum, r) => sum + r.y, 0) / rows.length;
  let bias = Math.log((rate + 1e-6) / (1 - rate + 1e-6));
  for (let step = 0; step < model.odds_steps; step++) {
    const gradW = new Array<number>(width).fill(0);
    let gradB = 0;
    for (const r of rows) {
      let z = bias;
      for (let i = 0; i < width; i++) z += weights[i]! * ((r.x[i]! - mean[i]!) / sd[i]!);
      const error = 1 / (1 + Math.exp(-z)) - r.y;
      gradB += error;
      for (let i = 0; i < width; i++) gradW[i] += error * ((r.x[i]! - mean[i]!) / sd[i]!);
    }
    bias -= (model.odds_rate * gradB) / rows.length;
    for (let i = 0; i < width; i++) weights[i] = weights[i]! - model.odds_rate * (gradW[i]! / rows.length + model.odds_decay * weights[i]!);
  }
  return { mean, sd, weights, bias };
}

/** The fitted probability that a protocol records a token at all, clamped away from 0 and 1. */
export function predictOdds(protocol: SnapshotProtocol, asOf: string, tokenShare: number, odds: OddsModel): number {
  if (odds === undefined) return 0.5;
  let z = odds.bias;
  const x = oddsVector(protocol, asOf, tokenShare);
  for (let i = 0; i < x.length; i++) z += odds.weights[i]! * ((x[i]! - odds.mean[i]!) / odds.sd[i]!);
  return Math.min(0.98, Math.max(0.01, Math.round((1 / (1 + Math.exp(-z))) * 1000) / 1000));
}

/** Fit the odds on half the snapshot and read their accuracy and Brier score off the other half. */
export function oddsScore(snapshot: Snapshot, model: ModelConstants): OddsScore {
  const shares = categoryTokenShare(snapshot);
  const all = snapshot.protocols.filter((p) => p.tvl_usd > 0);
  const fit = all.filter((p) => fnv1a(p.slug) % 2 === 0);
  const holdout = all.filter((p) => fnv1a(p.slug) % 2 === 1);
  const odds = fitOdds(fit, snapshot.as_of, shares, model);
  const judge = (set: SnapshotProtocol[]): { accuracy: number; brier: number } => {
    if (set.length === 0) return { accuracy: 0, brier: 0 };
    let hits = 0;
    let brier = 0;
    for (const p of set) {
      const predicted = predictOdds(p, snapshot.as_of, shares.get(p.category ?? 'Uncategorised') ?? 0, odds);
      const actual = recordsNoToken(p) ? 0 : 1;
      if ((predicted >= 0.5 ? 1 : 0) === actual) hits++;
      brier += (predicted - actual) ** 2;
    }
    return { accuracy: hits / set.length, brier: brier / set.length };
  };
  const onFit = judge(fit);
  const onHoldout = judge(holdout);
  return {
    fit_size: fit.length,
    holdout_size: holdout.length,
    base_rate: holdout.length === 0 ? 0 : holdout.filter((p) => !recordsNoToken(p)).length / holdout.length,
    accuracy: onHoldout.accuracy,
    fit_accuracy: onFit.accuracy,
    brier: onHoldout.brier,
  };
}

/** What the variants scored, which one the board uses, and the band its holdout ratios set. */
export interface HoldoutReport {
  fit_size: number;
  holdout_size: number;
  variants: VariantScore[];
  chosen: number;
  chosen_terms: SizeTerm[];
  band_low: number;
  band_high: number;
  sigma: number;
  odds: OddsScore;
}

/** Fit each variant on half the priced set and price the other half, twice over, both directions. */
export function holdoutReport(snapshot: Snapshot, model: ModelConstants): HoldoutReport {
  const priced = snapshot.protocols.filter(hasTradedMultiple);
  const errors: number[][] = SIZE_VARIANTS.map(() => []);
  const fitErrors: number[][] = SIZE_VARIANTS.map(() => []);
  const ratios: number[][] = SIZE_VARIANTS.map(() => []);
  const perSplit: number[][][] = SIZE_VARIANTS.map(() => [[], []]);
  const holdoutSize: number[] = SIZE_VARIANTS.map(() => 0);
  for (let split = 0; split < 2; split++) {
    const sideA = priced.filter((p) => splitSide(p.slug, split) === 0);
    const sideB = priced.filter((p) => splitSide(p.slug, split) === 1);
    for (let vi = 0; vi < SIZE_VARIANTS.length; vi++) {
      const terms = SIZE_VARIANTS[vi]!;
      for (const pair of [[sideA, sideB], [sideB, sideA]] as [SnapshotProtocol[], SnapshotProtocol[]][]) {
        const fit = fitLogLog(pair[0], model, snapshot.as_of, terms);
        const heldOut: number[] = [];
        for (const p of pair[1]) {
          const predicted = predictFromFit(p, fit, snapshot.as_of, model);
          const error = Math.abs(predicted - p.mcap_usd!) / p.mcap_usd!;
          errors[vi]!.push(error);
          heldOut.push(error);
          ratios[vi]!.push(p.mcap_usd! / predicted);
        }
        for (const p of pair[0]) {
          const predicted = predictFromFit(p, fit, snapshot.as_of, model);
          fitErrors[vi]!.push(Math.abs(predicted - p.mcap_usd!) / p.mcap_usd!);
        }
        holdoutSize[vi] = holdoutSize[vi]! + pair[1].length;
        perSplit[vi]![split]!.push(median(heldOut.slice().sort((a, b) => a - b)));
      }
    }
  }
  const variants: VariantScore[] = SIZE_VARIANTS.map((terms, vi) => {
    const held = errors[vi]!.slice().sort((a, b) => a - b);
    const fitted = fitErrors[vi]!.slice().sort((a, b) => a - b);
    const flat = (perSplit[vi] ?? []).flat();
    const name = terms.length === 0 ? 'a flat market value' : 'fit on ' + terms.map((t) => SIZE_TERMS[t === 'tvl' ? 0 : t === 'growth' ? 1 : t === 'age' ? 2 : 3]).join(', ').replace(/, ([^,]*)$/, ' and $1');
    return {
      name,
      terms,
      holdout_mdape: flat.length === 0 ? 1 : flat.reduce((s, e) => s + e, 0) / flat.length,
      fit_mdape: median(fitted),
      holdout_size: holdoutSize[vi]!,
      within_half: held.filter((e) => e <= 0.5).length,
      within_2x: held.filter((e) => e <= 1).length,
      per_split: flat,
    };
  });
  // The first variant is the measuring stick: a value with no term at all. It is scored and never chosen,
  // because a radar that ignores a protocol's size is not a radar.
  let chosen = variants.length > 1 ? 1 : 0;
  for (let vi = chosen + 1; vi < variants.length; vi++) if (variants[vi]!.holdout_mdape < variants[chosen]!.holdout_mdape) chosen = vi;
  const chosenTerms = SIZE_VARIANTS[chosen]!;
  const chosenRatios = ratios[chosen]!.slice().sort((a, b) => a - b);
  const whole = fitLogLog(priced, model, snapshot.as_of, chosenTerms);
  return {
    fit_size: Math.floor(priced.length / 2),
    holdout_size: Math.floor(priced.length / 2),
    variants,
    chosen,
    chosen_terms: chosenTerms,
    band_low: percentile(chosenRatios, model.band_low_percentile),
    band_high: percentile(chosenRatios, model.band_high_percentile),
    sigma: whole.sigma,
    odds: oddsScore(snapshot, model),
  };
}
