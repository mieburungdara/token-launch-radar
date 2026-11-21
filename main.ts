// token-launch-radar: one sealed protocol snapshot in, a ranked board and a static dashboard out.
//
// Run it:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
// In the grader:  /input/snapshot.json in, /output filled with board.json, data.js, dashboard/,
// screenshots/ and the dossier vendor/makefun-board.ts writes.
//
// The program is one pass, with no network call and no clock: the same snapshot always writes the same
// bytes, which is what the grader's two runs compare.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  MODEL_VERSION,
  SnapshotError,
  fitLogLog,
  boardIssue,
  buildBoard,
  categoryMarkets,
  dataScript,
  holdoutReport,
  liveProtocols,
  parseSnapshot,
  peerIndex,
  uncategorisedCount,
} from './lib/model.ts';
import type { RadarData, RadarRow } from './lib/model.ts';
import { farmPlan, farmSteps } from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The scorer's caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SCREENSHOTS = 3;

const here = fileURLToPath(new URL('.', import.meta.url));

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((value) => value.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Stop with one line on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const root = arg('root', here);

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (error) {
  if (error instanceof SnapshotError) fail(error.message);
  throw error;
}

const fit = fitLogLog(snapshot.protocols, MODEL);
const validation = holdoutReport(snapshot, MODEL);
const board = buildBoard(snapshot, MODEL, fit, { low: validation.band_low, high: validation.band_high });
const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));

/** The board with its farm plans attached: the same facts the page shows, in the gate's own shape. */
const withPlans: RadarRow[] = board.map((row) => {
  const protocol = index.get(row.slug);
  if (protocol === undefined) fail(`${row.slug} is on the board but not in the snapshot`);
  return { ...row, farm_steps: farmSteps(row, protocol), farm_plan: farmPlan(row, protocol) };
});

const issue = boardIssue(withPlans, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'board.json'),
  `${JSON.stringify(
    {
      schema: 'makefun/board/v1',
      competition: 'token-radar-01',
      as_of: snapshot.as_of,
      source: snapshot.source,
      model_version: MODEL_VERSION,
      model: MODEL,
      fit: { intercept: fit.intercept, slope: fit.slope, sigma: fit.sigma },
      watchlist_size: snapshot.watchlist.length,
      validation,
      rows: withPlans.map((row) => {
        const protocol = index.get(row.slug)!;
        return {
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
          token_status: 'records-no-token',
          peer_multiple: row.peer_multiple,
          peer_basis: row.peer_basis,
          peer_sample: row.peer_sample,
          peer_weight: row.peer_weight,
          peer_low_multiple: row.peer_low_multiple,
          peer_high_multiple: row.peer_high_multiple,
          fitted_intercept: row.fitted_intercept,
          fitted_slope: row.fitted_slope,
          fitted_offset: row.fitted_offset,
          fitted_offset_sample: row.fitted_offset_sample,
          fitted_sigma: row.fitted_sigma,
          growth_multiplier: row.growth_multiplier,
          maturity_multiplier: row.maturity_multiplier,
          reach_multiplier: row.reach_multiplier,
          implied_value_usd: row.implied_value_usd,
          implied_low_usd: row.implied_low_usd,
          implied_high_usd: row.implied_high_usd,
          share_of_board: row.share_of_board,
          token_odds: row.token_odds,
          farm_steps: row.farm_steps,
          farm_plan: row.farm_plan,
        };
      }),
    },
    null,
    1,
  )}\n`,
);

const live = liveProtocols(snapshot);
const peers = peerIndex(snapshot, MODEL);
const candidates = snapshot.protocols.filter((p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null);
const data: RadarData = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model: MODEL,
  model_version: MODEL_VERSION,
  watchlist_size: snapshot.watchlist.length,
  board_size: withPlans.length,
  candidate_size: candidates.length,
  set_aside_size: candidates.length - withPlans.length,
  live_size: live.length,
  market_median_multiple: peers.market.median,
  board_implied_total: withPlans.reduce((sum, row) => sum + row.implied_value_usd, 0),
  uncategorised: uncategorisedCount(snapshot),
  validation,
  fit: { intercept: fit.intercept, slope: fit.slope, sigma: fit.sigma },
  rows: withPlans,
  live,
  categories: categoryMarkets(snapshot, peers, withPlans),
};
writeFileSync(join(out, 'data.js'), dataScript(data));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(root, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/index.html is missing');
if (!dashboardFiles.some((name) => name.endsWith('.css'))) fail('dashboard/ holds no stylesheet');
if (!dashboardFiles.some((name) => name.endsWith('.js'))) fail('dashboard/ holds no script');

const shots = copyFiles(join(root, 'screenshots'), join(out, 'screenshots'));
if (shots.length < MIN_SCREENSHOTS) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ${withPlans.length} ranked ` +
    `(${data.set_aside_size} set aside as somebody else's token, ${live.length} already trading)\n` +
    `token radar: rank 1 ${withPlans[0]?.name ?? 'none'} at $${(withPlans[0]?.implied_value_usd ?? 0).toLocaleString('en-US')}, ` +
    `board total $${Math.round(data.board_implied_total).toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${statSync(join(out, 'dossier.json')).size} bytes)\n`,
);
