// CBBTC dip-and-breakout bot for agent-fun/bars-replay/v1.
//
// Long only, one position at a time, full size on every entry. It stays in
// cash most of the time and only buys on two high-conviction setups, each
// confirmed by momentum, then exits fast on a trailing stop, a channel break
// or a take-profit. Every decision uses closes alone, in float64, so two runs
// on the same bars give the same orders.
//
// Entry 1 — breakout: the close beats the highest close of the 60 bars
//   before it, and the 30-bar return is above +50 bps (the move is real, not
//   noise poking above the channel).
// Entry 2 — dip bounce: the close is at least 250 bps under the highest
//   close of the last 120 bars, and it crosses back above its 8-bar EMA while
//   the 10-bar return is above +20 bps (a capitulation dip turning up).
// Exit — the whole position, on whichever comes first:
//   take-profit at +300 bps over the entry close, the close under the lowest
//   close of the 40 bars before it, or a trailing stop 50 bps under the
//   highest close since entry. No new entries in the last 30 bars: a position
//   opened there has no time to earn its round-trip cost back.
// Sizing: a buy spends all cash (fee included in the notional); a sell empties
// the position. max_slippage_bps 200 bounds a fill 2% from the latest close.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** The window is 1,440 one-minute bars (RULES.txt); entries stop 30 bars before it ends. */
const TOTAL_BARS = 1440;
const NO_ENTRY_LAST_BARS = 30;
/** Breakout: close above this many prior closes, with momentum behind it. */
const BREAKOUT_BARS = 60;
const MOMENTUM_BARS = 30;
const MOMENTUM_BPS = 50;
/** Dip: this far under this many bars' high, then a bounce. */
const DIP_BARS = 120;
const DIP_BPS = 250;
const BOUNCE_EMA_SPAN = 8;
const BOUNCE_BARS = 10;
const BOUNCE_BPS = 20;
/** Exits. */
const EXIT_BARS = 40;
const TAKE_PROFIT_BPS = 300;
const TRAIL_BPS = 50;
/** A fill more than this past the latest close is refused, not chased. */
const MAX_SLIPPAGE_BPS = 200;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
  prev: number | null;
}

function emaPush(e: Ema, close: number): void {
  e.prev = e.value;
  if (e.value === null) {
    e.warm.push(close);
    if (e.warm.length === e.span) {
      let sum = 0;
      for (const c of e.warm) sum += c;
      e.value = sum / e.span;
    }
    return;
  }
  const k = 2 / (e.span + 1);
  e.value = close * k + e.value * (1 - k);
}

/** Max of the last `n` closes before the current one (history holds the current close too). */
function maxBefore(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  let m = -Infinity;
  for (let i = closes.length - 1 - n; i < closes.length - 1; i++) {
    if (closes[i]! > m) m = closes[i]!;
  }
  return m;
}

/** Min of the last `n` closes before the current one. */
function minBefore(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null;
  let m = Infinity;
  for (let i = closes.length - 1 - n; i < closes.length - 1; i++) {
    if (closes[i]! < m) m = closes[i]!;
  }
  return m;
}

/** Max of the last `n` closes including the current one. */
function maxIncluding(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  let m = -Infinity;
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i]! > m) m = closes[i]!;
  }
  return m;
}

const closes: number[] = [];
const bounceEma: Ema = { span: BOUNCE_EMA_SPAN, warm: [], value: null, prev: null };
/** The position this bot opened: its entry close and its peak close since. */
let entryClose: number | null = null;
let peakClose = 0;

function holding(state: BarsState): boolean {
  const p = state.positions.get(SYMBOL);
  return p !== undefined && p.qty > 0n;
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined) return [];
  const close = Number(bar.c);
  closes.push(close);
  emaPush(bounceEma, close);

  if (holding(state)) {
    if (entryClose === null) {
      // Holding without an entry record (should not happen): anchor at this close.
      entryClose = close;
      peakClose = close;
    }
    if (close > peakClose) peakClose = close;
    const takeProfit = close >= entryClose * (1 + TAKE_PROFIT_BPS / 10000);
    const exitLow = minBefore(closes, EXIT_BARS);
    const channelBreak = exitLow !== null && close < exitLow;
    const trailingStop = close < peakClose * (1 - TRAIL_BPS / 10000);
    if (takeProfit || channelBreak || trailingStop) {
      const qty = state.positions.get(SYMBOL)!.qty;
      // Do not clear entryClose here: if this sell is rejected the position
      // stays open and the entry record must survive for the next bar. It is
      // cleared below, once the position is actually gone.
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Flat: clear any stale entry record, then look for a setup.
  entryClose = null;
  // No new entries in the last bars, and none on the final batch (rejected anyway).
  if (state.seq >= TOTAL_BARS - NO_ENTRY_LAST_BARS) return [];
  // Both setups need a full 120-bar history before they may fire.
  if (closes.length < DIP_BARS) return [];

  const breakoutHigh = maxBefore(closes, BREAKOUT_BARS);
  const momentumBase = closes.length > MOMENTUM_BARS ? closes[closes.length - 1 - MOMENTUM_BARS]! : null;
  const breakout =
    breakoutHigh !== null &&
    momentumBase !== null &&
    close > breakoutHigh &&
    (close / momentumBase - 1) * 10000 > MOMENTUM_BPS;

  const dipHigh = maxIncluding(closes, DIP_BARS);
  const bounceBase = closes.length > BOUNCE_BARS ? closes[closes.length - 1 - BOUNCE_BARS]! : null;
  const prevClose = closes.length > 1 ? closes[closes.length - 2]! : null;
  const dipped = dipHigh !== null && close < dipHigh * (1 - DIP_BPS / 10000);
  const bounced =
    bounceEma.value !== null &&
    bounceEma.prev !== null &&
    prevClose !== null &&
    bounceBase !== null &&
    close > bounceEma.value &&
    prevClose <= bounceEma.prev &&
    close > bounceBase * (1 + BOUNCE_BPS / 10000);
  const dipBounce = dipped && bounced;

  if (breakout || dipBounce) {
    if (state.cash <= 0n) return [];
    entryClose = close;
    peakClose = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
