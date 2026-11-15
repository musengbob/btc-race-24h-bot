# btc-race-24h-bot

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/musengbob/btc-race-24h-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/musengbob/btc-race-24h-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A long-only CBBTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It reads one JSON line per minute (1-minute bars of cbBTC priced in USDC) and answers with buy and sell orders, starting from $1,000 of paper money. It stays in cash most of the time and only buys on two high-conviction setups — a momentum-confirmed 60-bar breakout, or a deep dip (250 bps under the 120-bar high) bouncing back over its 8-bar EMA — then exits fast on a take-profit, a channel break, or a 0.5% trailing stop. Fully deterministic: no clock, no randomness, no network.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout: the harness sends `hello`, one `batch` per minute bar, then `done`, and the bot answers every batch with exactly one reply echoing its seq. `vendor/makefun-bars.ts` is the kit's protocol shim, copied byte for byte.

## Strategy

- **Breakout entry:** close above the highest close of the prior 60 bars, with the 30-bar return above +50 bps.
- **Dip entry:** close at least 250 bps under the highest close of the last 120 bars, crossing back above its 8-bar EMA with the 10-bar return above +20 bps.
- **Exits:** take-profit at +300 bps over the entry close, close under the 40-bar low, or a trailing stop 50 bps under the peak close since entry.
- **Sizing:** a buy spends all cash; a sell empties the position. No new entries in the last 30 bars of the window.
- **Local dev grade:** net PnL +$31.04 on the frozen 24h dev window (8 trades, max drawdown 1.25%), deterministic across two runs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=t2hmjdyt&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
