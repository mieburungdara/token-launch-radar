# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mieburungdara/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mieburungdara/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token launch radar: it reads one sealed DefiLlama protocol snapshot, values every protocol that records no token yet from the snapshot's own figures (its TVL, its seven-day growth, how long it has run without a token, and the market-cap-to-TVL multiples the snapshot's token-bearing peers already trade at), ranks them by implied launch value, and writes a static dashboard that shows the board, a detail view for every protocol and the steps to farm it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

It writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), `out/dashboard/` and `out/screenshots/` (copied from this repository) and `out/dossier.json` (the summary the judge reads, written with `vendor/makefun-board.ts`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=wjaqgteq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
