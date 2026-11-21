// The farm plans: what a reader actually does about one protocol, with what it costs and how long it takes.
//
// A plan is built from the row's own facts (its category, its chains, its size and its age without a token),
// never from a list of protocol names: every category family has its own sequence of moves, and the numbers
// in the cost and time columns follow the chain the reader is told to use. Every plan ends with the same two
// steps, because a launch is an event a farmer waits for and a record is what makes the wait worth anything.

import type { FarmStep, RadarRow, SnapshotProtocol } from './model.ts';

export type { FarmStep };

/** What a chain charges a first-week farmer, in the plan's own words. */
interface ChainCost {
  gas: string;
  bridge: string;
}

const CHAIN_COSTS: Record<string, ChainCost> = {
  Ethereum: { gas: '$8-30 of gas for the whole plan', bridge: '$3-15 to bridge in' },
  Arbitrum: { gas: '$1-4 of gas for the whole plan', bridge: '$1-3 to bridge in' },
  Optimism: { gas: '$1-4 of gas for the whole plan', bridge: '$1-3 to bridge in' },
  Base: { gas: '$0.30-1.50 of gas for the whole plan', bridge: '$0.30-2 from Ethereum or Solana' },
  Polygon: { gas: '$0.05-0.60 of gas for the whole plan', bridge: '$0.50-2 to bridge in' },
  BSC: { gas: '$0.20-1 of gas for the whole plan', bridge: '$0.50-2 to bridge in' },
  Solana: { gas: 'under $0.01 of fees per transaction', bridge: '$0.50-2 from an exchange' },
  Avalanche: { gas: '$0.10-1 of gas for the whole plan', bridge: '$0.50-3 to bridge in' },
  Sui: { gas: 'under $0.05 of fees per transaction', bridge: '$0.50-2 to bridge in' },
  Aptos: { gas: 'under $0.05 of fees per transaction', bridge: '$0.50-2 to bridge in' },
  TON: { gas: 'under $0.10 of fees per transaction', bridge: '$1-3 to bridge in' },
  Sonic: { gas: '$0.05-0.50 of gas for the whole plan', bridge: '$0.50-2 to bridge in' },
  Hyperliquid: { gas: 'under $0.05 of fees per order', bridge: '$1-3 from Arbitrum' },
  Linea: { gas: '$0.30-1.50 of gas for the whole plan', bridge: '$1-3 to bridge in' },
  Scroll: { gas: '$0.30-1.50 of gas for the whole plan', bridge: '$1-3 to bridge in' },
};

const DEFAULT_COST: ChainCost = { gas: '$1-5 of gas for the whole plan', bridge: '$1-4 to bridge in' };

/** The chain a reader is told to use: the first one the protocol lists, or a named fallback. */
export function homeChain(protocol: SnapshotProtocol): string {
  return protocol.chains[0] ?? 'Ethereum';
}

/** Whole dollars as a reader reads them. */
function usd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** A position size the row's own TVL makes defensible: never advice, always a band the reader can drop. */
function suggestedBudget(row: RadarRow): string {
  const tvl = row.tvl_usd;
  if (tvl >= 1e9) return '$500-2,000';
  if (tvl >= 3e8) return '$300-1,000';
  if (tvl >= 5e7) return '$200-500';
  return '$100-300';
}

/** The cost sheet for that chain. */
export function chainCost(chain: string): ChainCost {
  return CHAIN_COSTS[chain] ?? DEFAULT_COST;
}

/** The family a category belongs to, which decides the moves a plan suggests. */
export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp') || c.includes('rwa lending')) return 'credit';
  if (c.includes('dex') || c.includes('amm') || c.includes('order book')) return 'trading';
  if (c.includes('yield') || c.includes('farm') || c.includes('vault')) return 'yield';
  if (c.includes('perp') || c.includes('derivative') || c.includes('options') || c.includes('synthet')) return 'derivatives';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('indexes') || c.includes('index')) return 'index';
  if (c.includes('nft')) return 'nft';
  if (c.includes('staking') && !c.includes('liquid')) return 'staking';
  if (c.includes('launchpad') || c.includes('launch')) return 'launchpad';
  return 'general';
}

/** One protocol's plan: five to eight steps, each with what it costs and how long it takes. */
export function farmPlan(row: RadarRow, protocol: SnapshotProtocol): FarmStep[] {
  const chain = homeChain(protocol);
  const cost = chainCost(chain);
  const name = row.name;
  const family = familyOf(row.category);
  const months = row.age_days === null ? null : Math.round(row.age_days / 30);
  const tenure = months === null ? 'however long it has run' : `${months} months`;

  const spread = (protocol.chains ?? []).filter((c) => c !== chain).slice(0, 2);
  const setup: FarmStep = {
    step: `Open a wallet on ${chain} and keep it for this protocol alone: a fresh address per farm keeps one bad contract away from your main holdings, and ${name} is a ${chain} deployment you should try with a small first deposit${spread.length ? `, then repeat on ${spread.join(' and ')} if the position holds up` : ''}.`,
    cost: cost.bridge,
    time: '10-20 minutes including the on-ramp',
  };

  const fund: FarmStep = {
    step: `Fund it with the assets ${name} actually takes: a stablecoin for the deposit leg and a little of the chain's gas token (${chain}), both bought with a card or withdrawn from an exchange, because the deposit contract will not wait for a bridge.`,
    cost: 'whatever you mean to farm, $200-1,000 is a normal first position',
    time: '15-40 minutes for the exchange withdrawal to settle',
  };

  const moves: Record<string, FarmStep[]> = {
    credit: [
      {
        step: `Supply the stablecoin into ${name}'s pool and leave it in: ${family === 'credit' ? 'the supply side is the part of a lending market a launch usually rewards' : 'deposits are the measurable position'}, and ${name} has run ${tenure} with the pool open.`,
        cost: cost.gas,
        time: '5 minutes, then leave it deposited',
      },
      {
        step: `Borrow against a fraction of it (30-40% is the usual safe band), repay a week later, then repeat once: ${name} scores a borrowing position differently from a supply position, and two clean cycles cover both.`,
        cost: 'interest for the week plus a few dollars of gas, well under $10 on a $500 position',
        time: '10 minutes to borrow, 10 to repay',
      },
    ],
    trading: [
      {
        step: `Add liquidity to the ${name} pool that pairs the chain's gas token with a stablecoin, in the narrowest range you can watch: concentrated liquidity pays a launch score for depth as well as volume.`,
        cost: cost.gas + ' plus impermanent loss if the pair moves',
        time: '10 minutes to set the range',
      },
      {
        step: `Route a week of your own swaps (say $50-200 a week) through ${name} instead of an aggregator, so the volume is yours and not a bot's, and leave the liquidity in place between trades.`,
        cost: 'swap fees, usually 0.05-0.30% a trade, so $1-3 on $500 of volume',
        time: '15 minutes spread over the week',
      },
    ],
    yield: [
      {
        step: `Deposit the stablecoin into ${name}'s vault, read which strategy it runs, and stay in that one vault: tenure in one position is what a retroactive distribution weighs, and hopping vaults resets it.`,
        cost: cost.gas,
        time: '10 minutes, then leave it deposited',
      },
      {
        step: `Check the vault's fee and its current APY once a week, and harvest or compound only when the pending yield is worth more than the gas of the harvest.`,
        cost: 'one harvest is $0.30-8 of gas on this chain',
        time: '5 minutes a week',
      },
    ],
    derivatives: [
      {
        step: `Deposit margin into ${name} and open one small directional position with a stop, then close it the same day: perp venues score volume, open interest and liquidation-free closes, and a small closed trade is all three.`,
        cost: 'trading fees on the notional, about $1-5 on a $500 position, plus gas',
        time: '15 minutes',
      },
      {
        step: `Repeat a small trade weekly rather than one large one, and keep the margin account funded so no position is liquidated while you wait for the launch.`,
        cost: 'weekly fees on a small notional, under $5 a week',
        time: '10 minutes a week',
      },
    ],
    insurance: [
      {
        step: `Buy a small cover policy on ${name} for the protocol you actually hold (not for a protocol you do not), and keep it for a full month: cover premiums are the position an insurance market counts.`,
        cost: 'a premium of roughly 2-5% of the covered amount per month',
        time: '10 minutes to buy, one month held',
      },
    ],
    index: [
      {
        step: `Mint the ${name} index with a small basket and hold it, reading its composition first: an index position counts as holding every protocol in it, so one deposit covers several farms at once.`,
        cost: cost.gas + ' plus the mint fee the index charges',
        time: '10 minutes, then hold',
      },
    ],
    nft: [
      {
        step: `Mint or buy one of ${name}'s cheapest listed items and keep it in the wallet you farm from: NFT markets score holders, minters and traders separately, and one held item covers the first two.`,
        cost: 'the floor price plus gas, and no more than you would spend on one dinner',
        time: '20 minutes including the transaction',
      },
    ],
    staking: [
      {
        step: `Delegate or stake into ${name} and leave the position staked through at least one full epoch: unstaking before an epoch pays nothing and resets the tenure a launch counts.`,
        cost: cost.gas,
        time: '10 minutes, then one epoch staked',
      },
    ],
    launchpad: [
      {
        step: `Take part in one small ${name} sale or commit a small amount to its next pool, and claim the result yourself: a launchpad's own launch follows the wallets that used its sale rails.`,
        cost: 'the smallest commitment the sale allows, plus gas',
        time: '20 minutes around the sale window',
      },
    ],
    general: [
      {
        step: `Use ${name} for its main job with a small position (its record shows ${row.category ?? 'a protocol'} with no token yet), and keep the position open rather than round-tripping it in one block.`,
        cost: cost.gas,
        time: '15 minutes to open, then hold',
      },
      {
        step: `Return once a week to move a small amount or compound what it paid you, and keep the position open for at least a month: repeat use counts where a single deposit does not.`,
        cost: 'a few dollars of gas a month on this chain',
        time: '10 minutes a week',
      },
    ],
  };

  const cadence: FarmStep = {
    step: `Set the cadence before the first deposit: ${name} is worth a position of ${suggestedBudget(row)}${months === null ? '' : `, weighed against the ${tenure} it has already run with no token`} — enough that a distribution notices it, small enough that a total loss costs nothing you need — touched once a week rather than once, because a launch reads engagement over time and not one transaction.`,
    cost: 'one budget line you can hold for six months, not a monthly top-up',
    time: '15 minutes a week on this chain',
  };

  const keep: FarmStep = {
    step: `Write down what you did: the wallet address, the dates, the amounts and the transaction hashes for ${name}. A launch distribution asks for proof of use, and a farm you cannot document is a farm you cannot claim.`,
    cost: 'nothing beyond the notes',
    time: '10 minutes once',
  };

  const watch: FarmStep = {
    step: `Watch for the launch itself: ${name} records no token as of the snapshot date (this radar puts its odds at ${Math.round(row.token_odds * 100)}%), so follow its own documentation and its ${chain} deployments, and set a TVL alert: a fundraise or a step change in TVL usually comes first.`,
    cost: 'nothing',
    time: 'a few minutes a month',
  };

  const risk: FarmStep = {
    step: `Size the position for a farm that pays nothing: ${name} holds ${usd(row.tvl_usd)} of TVL ${row.change_7d === null ? 'with its seven-day change unreported' : `and moved ${row.change_7d > 0 ? '+' : ''}${row.change_7d.toFixed(1)}% in the last seven days`}, so treat every dollar as spent on information, not on a claim.`,
    cost: 'the position itself, and nothing should be money you need back',
    time: 'decide before the first deposit, not after',
  };

  const plan = [setup, fund, ...(moves[family] ?? moves.general!), cadence, keep, watch, risk];
  return plan.slice(0, 8);
}

/** The plan's steps as the board's strings: the action, then the cost and the time it carries. */
export function farmSteps(row: RadarRow, protocol: SnapshotProtocol): string[] {
  return farmPlan(row, protocol).map((entry) => `${entry.step} Cost: ${entry.cost}. Time: ${entry.time}.`);
}
