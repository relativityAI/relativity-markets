# The Sector Rotation Toolkit

Practical tools to (a) read the market's temperature, (b) judge whether a sector is stretched, and (c) catch rotation early. Each tool lists how to generalise it to any market.

Contents: 1 Market temperature | 2 Valuation bands + earnings | 3 Relative-strength scores | 4 Stage analysis and Dow theory on custom sector indices | 5 Results-season / fundamentals scan | 6 Event and policy watch | 7 Putting the tools together | 8 Generalising to other markets

**Data note:** use web search or user-provided data. If the data is unavailable, say which tool you could not run and give a qualitative answer instead. Never fabricate values.

---

## 1. Market temperature (is the whole market euphoric?)

### 1a. Breadth: share of the universe above its 200-day EMA
- Compute (or ask the user to supply from a screener) the **percentage of listed stocks trading above their 200-day exponential moving average**.
- Source-video observation: in early 2024, roughly **90-95%** of the Indian listed universe was above the 200-day EMA, which marked a euphoric phase. Treat such extreme readings as a sign of broad euphoria.
- **Generalise:** use a high percentile of the market's own history for this indicator rather than the exact number. Breadth readings differ across markets and index definitions.
- Also check the mirror image: very low breadth (few stocks above the 200-day) points toward despair.

### 1b. Parabolic extension test (any asset class)
- Measure the distance between **price and its 150-day EMA**. If price is **more than ~70% above** the 150-day EMA, the asset is in a euphoric/parabolic stage.
- Works for single stocks, themes, commodities (a metal that rises nonstop for months), sector indices and broad indices.
- Examples from the video: a precious metal's run to a parabolic extension in winter 2025-26, and several Indian stocks and themes in 2021 that were parabolic together. When many stocks or themes are parabolic at once, call it out.
- **Generalise:** for high-volatility assets (small caps, crypto, junior miners), widen the threshold or use a percentile of the asset's own history; for low-volatility indices, 70% is exceptionally rare, so a smaller threshold may suffice.

### 1c. Narrative check
- Is a single story being repeated everywhere (about the country, a theme or a commodity)? Is it in election campaigns or mainstream headlines?
- Has the narrative started to be questioned (policy, trade, valuations)? That usually means euphoria has already faded.

---

## 2. Long-term valuation bands + earnings growth

### Method
1. For the **index or sector index**, chart the PE ratio (or alternative multiple) over a long window (10+ years where possible) with the **long-term average and bands** (e.g., below average / average / above average / expensive / very expensive).
2. Compute **3-year and 5-year median** multiples as additional anchors.
3. Overlay the **earnings growth cycle**: recent quarterly profit growth vs historical.
4. Interpret:
   - **Multiple at the high end of the band** → bubble risk, especially if growth is decelerating.
   - **Multiple at or below the long-term average while earnings growth is well above normal** → **re-rating** potential (money flows in, multiple mean-reverts upward).
   - **Multiple at the high end while earnings growth is merely normal** → fragile.

### Source-video illustrations
- A broad index's PE spent 2018-20 below average, 2020-22 above average, 2022-24 slightly to clearly expensive, and 2024-26 very expensive; later it fell back to a below-average multiple (about 19x versus a long-term average of about 20-22x). With the fastest profit growth in six quarters (about 21%) arriving at below-average valuations, the video argued a further 10-15% move was quite possible as the multiple re-rated and money returned. Present as one reading, not a forecast.
- An IT sector index: 3-year median about 27x, 5-year median about 26x, then about 18x at the time of the video; pre-COVID range about 15-20x; peaks near 40x (2021) and 35x (2024). Zones of extreme overheating against long-term PEs are a simple signal that a bubble can form.

### Best suited to
Established sectors with large-caps listed, where big money can flow in. For small or newly listed sectors (few constituents), use constituent multiples and capital-cycle evidence instead.

---

## 3. Relative-strength (RS) scores

### Method
- Use a screener that ranks every **sector index and industry group** by a **relative-strength score or percentile versus the whole market** (in the source video, a score on a 1-99 scale).
- **RS ≥ ~75** = the group is outperforming at least ~75% of the market (top quartile). Treat any sector index that moves above 75 **after a long time below** as one to study. Higher still (e.g., RS 90+) = extreme leadership (for example, a banking subgroup in the top 6% of the market).
- Track: the **zone** (outperforming / accumulating / consolidating, or the equivalent in the user's tool), the **change over the last month**, and the **change over the last year**.
- **Persistence matters.** A sector that keeps re-entering the outperforming zone (for example, an industry that has been near the top for two to three years) is worth deeper study, because persistent RS usually reflects a durable change (policy, structure).
- **Go below the sector**: inspect industries inside the sector; then constituents that are outperforming.

### Interpretation tips
- Use RS as a **tactical sector-allocation** tool.
- Inside a leading group, look for **less crowded sub-segments** (for example, a fintech or wealth manager inside a leading financials group; a streaming or licensing business inside media) where re-rating potential may be larger.
- RS in sectors with policy tailwinds (e.g., ports, shipping, dredging in the source) can persist for years; investigate **what changed** rather than just buying strength.
- Ask whether the sector is in a **long-dated** cycle (RS may keep recurring) or short-dated.
- A sector near the top of RS **and** extreme on breadth/parabolic/IPO signals = peak risk, not a green light.

### Generalise
Any tool or script that ranks sector/industry returns versus the benchmark works: relative-return percentile, RS line slope against the benchmark, or relative rotation graphs. Use the same logic (top-quartile, persistent, rising).

---

## 4. Stage analysis and Dow theory on custom sector indices

### Why custom indices
Official sector indices may not exist for narrow industries (cables, paints, solar, transformers, diagnostics, coworking). **Build your own**: an equal-weighted (or cap-weighted) basket of the sector's listed constituents, and chart it. Many screening platforms let you do this directly.

### Stage analysis (Weinstein-style)
- **Stage 1** = basing (after a decline, price flat, volume dry).
- **Stage 2** = advancing (uptrend; higher highs and higher lows; trades above rising long-term average).
- **Stage 3** = topping (stalls, wide swings).
- **Stage 4** = declining (lower highs and lower lows; below falling long-term average).
- Apply to the **sector index**, not a single security.

### Dow theory on the sector index
- An index making **higher highs and higher lows** is in an uptrend; **lower highs and lower lows** is a downtrend.
- Example: a paint-sector index with a series of lower highs since its peak, only recently showing signs of stabilisation, indicates a long digestion. A cable-sector index prepared to enter stage 4 after an extended run flags competition and margin risk.
- **Time frame matters:** use **weekly and monthly** charts for strategic views; daily only for tactical timing. A stage-4 breakdown on a short time frame in a long-dated sector can be noise; on weekly/monthly it is more serious.

### Early-rotation use
- Look for sector indices **just entering Stage 2** (breaking out of a Stage 1 base) and the **weekly/monthly gainers list** across your custom indices.
- Example from the video: a contract-manufacturing index up 50-60% in six months (with constituent stocks doing even better), and a hospital index making a comeback after a regulatory scare, with Q2 profit growth confirming.

---

## 5. Results-season / fundamentals scan

Sectors' profits **move together**. At each results season:
1. Aggregate sector-level **revenue growth, operating profit growth and margin** across the sector's companies (screener, result-analysis tool or the user's data).
2. **Margin compression together** across several companies (e.g., margins in a transformer or smart-meter business falling from the high teens to the mid-teens over two to three quarters) is a capital-cycle phase-3 flag.
3. **Margins and growth expanding together** in early quarters (profitability exploding across the group) is an early-rotation flag: study that sector.
4. Check **order-book intake** and profitability growth together for order-driven businesses.
5. Cross-check with RS and stage: fundamentals and charts should agree. "Liquidity creates the fundamental, and the fundamental creates the chart."

---

## 6. Event and policy watch

- **IPO and QIP calendar** by sector (clusters = euphoria; first wave of small-cap IPOs in a hot sector = capital flooding in).
- **Capex announcements** and capacity additions (see `four-drivers.md`).
- **Policy changes**: subsidies, tariffs, regulation, procurement programmes. Policy-led RS can persist for years (for example, port and marine services in the source).
- **New entrants**: conglomerates, public-sector firms, PE-backed startups.
- **Global sector history**: check how the same sector's cycle played out abroad.

---

## 7. Putting the tools together

| Question | Tools to combine |
|---|---|
| Is the market euphoric? | Breadth (1a), parabolic test (1b), narrative (1c), valuation band (2) |
| Is *this sector* near a peak? | IPO/QIP clustering (6), capex/new entrants (4 drivers), valuation percentile (2), stage/Dow (4), margin trend (5) |
| Is *this sector* starting a new run? | RS rank and persistence (3), stage-2 entry (4), results scan (5), valuation + earnings (2), policy (6) |
| How long might it last? | `cycle-duration.md` + global history |

Require **two or more independent signals** before stating a strong verdict. State when the signals disagree.

---

## 8. Generalising to other markets

| Source-video tool | Generic equivalent |
|---|---|
| A country's headline index and sector indices | The relevant benchmark and the market's official sector/industry indices (or custom baskets) |
| A "market dashboard" showing % above 200-day EMA | Any breadth indicator from a screener, or compute it from constituent data |
| An "RS scorer" / market scan | Any relative-strength ranking: relative return percentile, RS line vs benchmark, RRG |
| Stage analysis / "custom indices" on a screening platform | Custom equal-weight baskets in any charting platform |
| Results-analysis scans | Quarterly/semi-annual earnings aggregations by industry (e.g., from financial data providers) |
| Local policy items (e.g., ports, defence, public-sector capex) | The user's market's own policy catalysts |

Calibrate thresholds (90-95% breadth, 70% above the 150-day EMA, RS 75, 5-6x GDP) to the market, its volatility and its history.
