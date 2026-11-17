---
name: nifty-indices-analysis
description: End-of-day read of the Indian index market in the style of tipsheet.markets — Nifty 50 and size leadership (mid/small/micro caps), breadth (52-week highs, share above 200/50-day averages), FII/DII flows, sector leadership quadrants, index valuation percentiles, the 10-month trend rule, and which readings sit outside their usual range. Use whenever the user asks how the broad market is doing, which index or size segment is leading, whether breadth or flows confirm the index, how expensive indices are, or wants a market-wide report instead of a single-stock analysis — even if they never say "indices" or "tipsheet".
citations: inline
tools:
  - yfinance_get_ticker_info
  - yfinance_get_price_history
  - yfinance_search
  - search_news
  - web_search
metadata:
  tags: indices
---

# Nifty Indices Analysis

Market-wide observation in the style of tipsheet.markets (https://tipsheet.markets/):
numbers first, plain words, every figure dated and sourced. The whole market, not one stock.

**Principles:** total return with dividends, always. Note the data date on every reading.
Expensive is not "sell"; unusual is not "bad". Write the rule before reading the data.
Never invent an index level — if the data isn't there, say INSUFFICIENT.

## Process

Run the steps in order. Daily read: Steps 0-6, then 9. Deep dive or a "why" question: all steps.
Every step ends with a call: confirmed / diverging / unclear.

### Step 0. Route and get data

Cover: date, market (India), and what the user wants (daily read, one question, comparison).
- Indian data is end-of-day — say the date the data is "to".
- Index levels come from the tools or the web. Never type a level from memory.

### Step 1. Headline

Cover: Nifty 50 level, 1D, YTD, distance from its 52-week high, and the size curve.
- One sentence: what the index did, where it sits versus its high and versus the year.
- Size leadership on one scale — Nifty 50 vs Midcap 150 vs Smallcap 250 vs Microcap 250,
  over 1M and 1Y. Smallcaps ahead of large caps = risk-on; the reverse = caution.

### Step 2. Breadth

Cover: advancers/decliners, 52-week highs and lows, share above the 200-day average,
share above the 50-day average — of the liquid NSE universe.
- An index rise on narrow breadth is fragile. A flat index with broad strength is accumulation.
- Call: confirming or diverging, with the two numbers behind it.

### Step 3. Flows

Cover: domestic institutions and foreign investors (NSDL) daily net equity buying/selling;
on the latest full day, the split by investor type — mutual funds, individuals, foreigners.
- Foreign selling met by domestic buying = resilient. Both selling = risk-off.
- Give the number in ₹ crore with its date; a partial day is not a full day.

### Step 4. The broad-index table

Cover: for each broad index (Nifty 50, Next 50, 100, 500, Midcap 150, Smallcap 250,
Microcap 250, LargeMidcap 250, MidSmallcap 400) — 1D, 1W, 1M, 3M, YTD, 1Y, 3Y, 5Y,
distance from its high, trend, momentum.
- 3Y and 5Y annualised. Ranks beat absolutes: say "best of the 10" not just the number.
- **Trend rule:** above its 10-month (≈200-day) average = up; below = down. "Up since <month>"
  only when the month is real — read it off the data, don't estimate it.
- **Momentum:** the twelve-month return to a month ago, and its rank among the broad indices.
  A month of return is noise; a rank is information.

### Step 5. Sectors

Cover: sector indices today (how many of 23 rose), the 3-month leaders and laggards,
and the leadership quadrants versus the Nifty 500.

| Quadrant | 6M vs Nifty 500 | 1M |
|---|---|---|
| Leading | ahead | ahead |
| Weakening | ahead | behind |
| Improving | behind | ahead |
| Lagging | behind | behind |

- "1 of 23 up" is a risk-off day — say which segment held up and which fell hardest.
- The quadrants are a picture of the recent past, not a rotation signal. Say so.

### Step 6. Valuation

Cover: Nifty 50 and Nifty 500 P/E, P/B and dividend yield (and CAPE where available),
each against its own history — as a percentile, not a level.
- 20.5x P/E at the 68th percentile = dearer than 68% of weeks since 1999. Always the percentile.
- Valuation says nothing about next month. It frames the starting odds — state it that way.

### Step 7. What's unusual

Cover: readings compared with their usual range — the middle half of their own history.
- Flag the readings outside their band, with the band and the record beside each number.
- Unusual ≠ good or bad. A high P/E and a record SIP inflow are both unusual, for different reasons.
- Skip readings whose history is too short to judge; say which those are.

### Step 8. Coming up

Cover: dated events that move indices — CPI/WPI/IIP prints, RBI MPC, results weeks,
ex-dividends of index heavyweights, index rebalances.
- Confirmed dates only. Mark expected versus announced.

### Step 9. Verdict and report

Cover: one-line market read (risk-on / neutral / risk-off), the two numbers behind it,
what changes my mind, and the data date plus source.
- Format the report exactly per `references/report-structure.md`, and nothing else.
- One short line, once: observations of historical data, not personal advice.

## References (read only when needed)

- `references/report-structure.md`: report format (always, Step 9).
