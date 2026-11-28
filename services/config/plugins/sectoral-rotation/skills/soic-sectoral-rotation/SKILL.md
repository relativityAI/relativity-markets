---
name: soic-sectoral-rotation
description: A market-agnostic framework for understanding why sector rotation happens, spotting where a sector is in its cycle (early, mid, peak, decline), and judging whether a cycle will be long, medium or short. Based on the SOIC "Sectoral Rotation" framework (four cycle drivers - psychology, capital, valuation, earnings - plus a practical toolkit of valuation bands, relative-strength scores, stage analysis on custom sector indices, breadth and results scans). Use this skill whenever the user asks about sector rotation, sector cycles, which sector is leading or lagging, whether a sector or theme is a bubble or at a peak, whether a sector is early in a rotation, how long a sector cycle may last, when to exit a sector, why last cycle's leaders collapsed, capital cycles, IPO waves in a sector, or wants a sector watchlist or rotation report for any equity market (India, US, Europe, Asia, etc.), even if they never say "SOIC" or "sectoral rotation" explicitly.
---

# SOIC Sectoral Rotation

A framework for answering three questions about any sector in any equity market:

1. **Why** does this sector move in cycles? (the four drivers)
2. **Where** is it in the cycle right now? (peak risk vs early strength)
3. **How long** can the cycle plausibly last? (long, medium or short-dated)

It is a diagnostic and research framework, not a trading system. It produces a reasoned view with evidence and exit triggers, never a guarantee.

## Core beliefs (state these when they help the user)

- Bull markets and bear markets both keep coming. Each bull run has a *different set of leaders*.
- Nothing is permanent. Sectors that did badly in the previous run often lead the next one, and last run's leaders often become the laggards (or stagnate for years).
- Cycles rotate. A sector's PE can go from 10 to 100 while another goes from 50 to 15. No sector wins forever or loses forever.
- After every bust, the pattern passes to the sectors that were ignored or held up best. Winners of a boom rarely lead the next one.
- Be humble. Even great businesses suffer long valuation compressions. Rotation is hard to time; it must be tracked continuously.

## Workflow

Follow these steps in order. Scale depth to the question: a quick "is X a bubble?" needs steps 2-4 in brief; a full rotation report needs all of them.

### Step 1: Fix the frame
Establish (ask only if it cannot be inferred):
- **Market and benchmark index** (e.g., the broad index of that country).
- **Sector taxonomy**: use the user's market's official sector/industry indices where they exist; otherwise build **custom sector indices** (an equal-weighted basket of listed constituents; see `references/toolkit.md`).
- **Horizon**: tactical (weeks-months) or strategic (years).
- **Data availability**: Claude often has no live market data. Use web search if available, or ask the user to supply data (index valuations, scan outputs, results tables). Never invent numbers. Label every figure with its source and date.

### Step 2: Read the market-wide temperature
Before judging any sector, check whether the broad market is euphoric or despairing. Use the breadth and parabolic-extension tests in `references/toolkit.md` (section 1) plus narrative checks (is everyone repeating the same "decade/century of X" story?). Euphoria in the broad market raises peak risk for every leading sector.

### Step 3: Diagnose the four drivers for the sector
Cycles come from four drivers that often overlap. Score each with evidence. Details, signals and thresholds are in `references/four-drivers.md`; read it when doing this step.

| Driver | Core question | Peak signature | Trough signature |
|---|---|---|---|
| **Psychology** | Is the crowd euphoric or despairing about this sector? | Cluster of IPOs/QIPs, parabolic price, "can't lose" narrative, priced for perfection | Valuations collapse, nobody talks about it, looks cheap vs own history |
| **Capital cycle** | Is capital flooding in (or fleeing) relative to demand? | High returns on capital in a commoditised industry attract entrants, big capex, new competitors, margins start slipping | Capital exits, supply tightens, returns recover |
| **Valuation** | Is the future already paid for? | Very high multiples; growth *rate of change* decelerating; alternatives emerging | Multiples compressed while earnings grow |
| **Earnings** | Are earnings borrowed from the future? | Industry growing 5-6x GDP; 4-5 years of growth compressed into 12-18 months | Earnings normalised/depressed; pricing power returning |

Two tells that matter most: **IPO/QIP clustering** at multiple-peaks, and the **rate of change of growth slowing** after a long run.

### Step 4: Classify cycle duration
Decide whether the sector's cycle is **long-dated** (roughly 6-15 years), **medium-dated** (roughly 2-4 years) or **short-dated** (roughly 1-2 years, commodity-driven). This sets the holding horizon and the exit expectation. Use `references/cycle-duration.md`. Always check the sector's global history, how deep and long its last bear market was, and whether a structural shift is extending the cycle.

### Step 5: Look for early strength (rotation in progress)
Use the toolkit in `references/toolkit.md`:
1. Index valuation vs long-term average, together with earnings growth
2. Relative-strength (RS) rankings of sectors and industries, and persistence of RS
3. Stage analysis and Dow-theory trend on sector indices (not single stocks)
4. Results-season / fundamentals scan: do the sector's companies' profits and margins move together?
5. Policy and event watch (regulation, subsidies, capex programmes, IPO calendar)

Fundamentals and charts confirm each other: liquidity creates fundamentals, and fundamentals create the charts. Prefer evidence from several tools agreeing.

### Step 6: Deliver a verdict
Combine steps 2-5. Use the output template below. Always include **what would change the view** and explicit **exit / de-risk triggers**. Investing without an exit criterion is the failure mode this framework exists to prevent.

### Step 7: Drill down (only if asked)
Within a leading sector, look for sub-industries or companies that are under-owned but share the tailwind (for example, a fintech or wealth manager inside a leading financials group), where re-rating potential may be larger. Hand off to the user's own stock-selection process (the SOIC approach screens on **T**heme, **G**rowth, **P**romoter/management quality and **V**aluation, TGPV); do not pick stocks from this framework alone.

## Output template

Use this structure for a sector assessment. Keep it tight; use prose where a table adds nothing.

```
## <Sector> - <Market> - <as-of date>
**Verdict:** <Early / Mid / Late / Peak-risk / Declining / Basing> | **Cycle length:** <Long / Medium / Short> | **Confidence:** <Low / Med / High>

### Four-driver scorecard
| Driver | Reading | Evidence (with source/date) |
|---|---|---|
| Psychology | | |
| Capital cycle | | |
| Valuation | | |
| Earnings | | |

### Cycle duration
<why long/medium/short; global precedent; depth of last bear market>

### Rotation signals
<RS rank and persistence; stage and trend of sector index; valuation vs history; results-scan findings; policy/event watch>

### What would change my view
<2-4 specific, observable items>

### Exit / de-risk triggers
<rate-of-change slowdown, margin slippage, new entrants/IPO wave, valuation percentile, stage-4 breakdown, time-frame expiry>

### Caveats
<data gaps, thresholds calibrated to a specific market, not investment advice>
```

For a cross-sector rotation report, first show a one-table ranking of all sectors (RS rank, valuation percentile, stage, verdict), then the detail for the top and bottom few.

## Guardrails

- **Not investment advice.** State once, briefly. Present the framework's reading and the evidence, and let the user decide.
- **Thresholds are heuristics from one market.** The numbers in the references (for example 90-95% of stocks above the 200-day EMA, price 70% above the 150-day EMA, RS score of 75) were observed in Indian markets. Recalibrate to the user's market using its own history, volatility and index construction. Say so.
- **Do not predict timing precisely.** Frame outputs as risk and probability ("peak risk is elevated"), not "it will crash in March".
- **Respect the pattern of slow unwinds.** Valuation-led bubbles usually deflate over years, not days; do not assume an overnight collapse, and do not assume a high-quality business is immune.
- **Do not confuse low PE with safety.** In earnings-led bubbles, a low multiple can sit on top of peak earnings.
- **Case studies are illustrations, not rules.** The India-specific examples live in `references/case-studies-india.md`. Use them to explain a mechanism, never as evidence about the user's market.

## Reference files

- `references/four-drivers.md`: detailed signals, examples and thresholds for the psychology, capital, valuation and earnings drivers. Read in Step 3.
- `references/cycle-duration.md`: long, medium and short-dated cycles, how to classify, and exit-criteria thinking. Read in Step 4.
- `references/toolkit.md`: the practical tools (breadth, parabolic test, valuation bands, RS scores, stage analysis on custom indices, results scans, event watch) with how to generalise each to other markets. Read in Steps 2 and 5.
- `references/case-studies-india.md`: the Indian bull-run history and sector case studies from the source video. Read when the user wants historical illustrations or asks about India specifically.
