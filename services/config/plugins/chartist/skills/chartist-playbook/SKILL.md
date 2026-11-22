---
name: chartist-playbook
description: Momentum & technicals playbook for stock-market analysis, distilled from the SOIC podcast "Fundamentals vs Technicals" with Himanshu Sharma (The Chartist). Covers 52-week-high scanning, relative strength vs RSI, Weinstein stage analysis (1-4), base breakouts (long/short/IPO), breakout & follow-through rules, 30/40-week EMA trend rules, trailing stops & drawdown math, fundamental-catalyst taxonomies, and investor-bias guardrails. Use whenever the user asks to analyze a stock setup or chart ("should I buy this?", "is it too late, it already ran 40%?", "where should my stoploss be?"), to build a momentum watchlist or screener, to time entry or exit, to explain relative strength / stage analysis / base breakouts, or asks anything about SOIC or Chartist-style positional investing — even casually or without naming the concepts. Complements fundamental-analysis skills (like stock-analysis); this skill owns the technical/timing side.
citations: inline
metadata:
  title: Chartist Playbook
  category: market
  tags: technical, momentum
---

# Chartist Playbook

A working playbook distilled from the 2-hour SOIC podcast with **Himanshu Sharma (The Chartist)** on combining fundamentals and technicals. The podcast's own framing, which this skill preserves:

- **Fundamentals tell you WHAT to buy** (quality, catalysts, valuation). **Technicals tell you WHEN to buy and WHEN to exit.** Neither is a rival to the other; they are probability layers. Every extra dimension you stack (chart + theme + catalyst + valuation) pushes the odds in your favor.
- **A good business and a good stock are two different things.** You make money at *what price and valuation you enter* and how long you let the trade breathe. Fundamentals protect you from junk and frauds; technicals protect your capital and your time.
- **Simplify.** The traders who compound (Darvas, O'Neil, Minervini, Livermore) use almost no indicators: price, volume, one moving average, and ruthless risk management. The enemy is not complexity — it's emotion and interference.

## Master workflow

Run analysis through this loop. Each stage has a home in a reference file — go deeper only as needed.

### 1. Frame the question
Everything starts by separating the user's real question:
- "Which stocks should I look at?" → Discovery (§2)
- "Is this stock in a buyable phase?" → Stage & base analysis
- "When should I enter?" → Breakout conditions + entry checklist
- "When do I get out / manage it?" → Exit & risk rules
- "Why do I keep doing X wrong?" → Bias guardrails

### 2. Discovery: scan first, themes second
Beginners hunt for a hot sector first and arrive late. The podcast inverts it: **scan for strong stocks, and the strong themes reveal themselves** (top-10 goal scorers from one club = that club is strong). The core scan: stocks **within 20% of their 52-week high** with liquidity floors. Strong businesses are found near highs, never near lows — a 5x stock cannot be hiding at a 52-week low. See `references/scanning.md` for exact filters, industry grouping, result-season scans, announcement scans, and the daily routine.

### 3. Validate: research protocol + catalysts
For each shortlisted name, follow the fast protocol — website → brief financials → latest PPT → con-call — then ask **what is the catalyst?** ("How does management grow this business?"). The catalyst taxonomy (volume growth, operating leverage, de-leveraging, order-book wins, regulatory approvals, demergers, new norms, demand-supply imbalances…) lives in `references/catalysts.md`, along with the negative triggers that should disqualify a name (inflated PAT with negative cash flow, promised-everything order books, pumped valuations).

### 4. Classify: stage & base
Place the stock on the stage map (1–4) and identify its base type (long base, short base in stage 2, IPO base, late-stage base). This determines whether the setup is early, buyable, late, or dead. See `references/stage-analysis.md`.

### 5. Entry checklist
A breakout is real only with **(a) a strong close through the level** and **(b) follow-through** — a crack in the glass wall is not a broken wall. Add: rising 30/40-week EMA, volume confirmation (institutional entry shows up as volume spikes), relative strength, and a fundamental catalyst you can name in one sentence. If the user missed a long-base breakout, the **first short-base breakout after it** is the standard re-entry point.

### 6. Manage & exit
Investors work on **weekly charts** with a **30–40 week EMA**; daily/15-minute charts exist to shake people out. Exit is decided *before* entry (thesis broken or technical stop hit), then the system is not interfered with. Trailing stops answer the unanswerable question "how much higher can it go?" — nobody sells the exact top, and giving back part of the peak move is part of the system, not a failure. See `references/exits-and-risk.md` for the loss-recovery math, distribution types, and the rule against selling entire positions just because a new trend starts after a long correction.

### 7. Behavior guardrails
Most damage in markets comes from the investor's own emotions, not the analysis. Check the user's plan against the bias list (confirmation, endowment, loss aversion, averaging-down, anchoring, recency, FOMO) and recommend journaling. See `references/exits-and-risk.md`.

## Core decision rules (inline — use constantly)

**Stage map (Weinstein):**
| Stage | Business state | Chart signature | Who should act |
|---|---|---|---|
| 1 Bottoming | Contrarian territory; timing unknown | Long sideways base, low volume | Contrarian buyers accept the wait |
| 2 Uptrend | Positive surprise → estimate revisions → EPS momentum | Higher highs/higher lows above rising 30-40wk EMA, boxes piling up (Darvas) | The buy zone; 1.5–2 yr bull legs typical |
| 3 Topping | First slow-growth quarter, high base effect | Flat, fails to make new highs | Time to trail stops tightly |
| 4 Downtrend | De-growth visible in numbers | Lower highs / lower lows below falling MA | Exit; new entries are traps |

**Breakout conditions (mandatory):** strong close through the level + follow-through bars after it. Without follow-through, no breakout — wait or exit what you bought early (as in the failed breakdown case: the stock went down, came back; exiting on the first crack was premature).

**Relative strength vs RSI (the #1 confusion):**
- **RS** compares a stock to a benchmark (Nifty) over 1–3 months — the sweet spot per published momentum research (shorter = news noise, longer = you miss the move). You can read it with the naked eye by overlaying/competing returns; an indicator is optional, not required.
- **RSI** compares a stock to *its own* recent 14-period self. "Overbought" means strong recent momentum — which is exactly what you *want* in an investment candidate. RSI overbought does not mean sell; leaders stay overbought while running 400–500% on weekly charts, and RSI noise there is worthless for this style.

**Math of losses (quote when the user is holding drawdowns):**
| Drawdown | Gain needed to get back |
|---|---|
| −20% | +25% |
| −50% | +100% |
| −90% | +900% |
Losses work geometrically against you (Minervini's p.47 warning); a "5x" stock is a 400% gain, not 500% — so a 50% correction does not leave 350%, it leaves ~150%. Recovery is not symmetric; compound math, not feelings, decides.

**Chart timeframe rules:**
- Investor / positional: weekly chart, 30–40 week EMA. Being shaken out of a multi-bagger by a daily-chart pullback is self-inflicted (Apar Industries never broke its 40-week MA during a 3-week shakeout, then went from ~1,400 to ~10,000).
- Full-time day trading is not required and usually harmful for this style; screen-watching produces 20 buy/sell decisions a day.

## What to output (templates)

**A. Stock setup review** — when given a stock name (+ any data the user pastes: chart description, price levels, results):
1. *Stage read* — which stage the described price action suggests; what evidence would confirm it.
2. *Base read* — base type (long / short / IPO / late-stage), length, what overhead supply looks like.
3. *RS read* — how to compare vs Nifty over 1–3 months; what strong RS would look like.
4. *Catalyst check* — which podcast catalyst(s) would explain institutional buying; what to verify in the PPT/con-call.
5. *Entry plan* — the specific technical trigger (level + strong close + follow-through + volume), and whether waiting for the level or using a missed-breakout re-entry rule fits better.
6. *Exit plan* — stop placement logic (weekly structure / 30-40wk EMA), trailing-stop rule, thesis-invalidations.
7. *What I'd need to verify* — a short data checklist (never invent numbers).
8. One-line framing: framework-based analysis, not personalized investment advice.

**B. Watchlist / screener build** — deliver the scan spec with exact filters (see `references/scanning.md`), the grouping step, and the daily/weekly habit around it.

**C. Concept explainer** — teach with the podcast's analogies (marks-vs-topper for RS; punching a glass wall for breakouts; "how much do you love me?" has no quantifiable answer for upside; staircase up / elevator down for corrections vs frauds), state when the concept *fails* or is misused, and give one case study.

## Guardrails

- **Never fabricate live prices, quotes, or financials.** If the user supplies data, analyze it. If not, teach the framework and list exactly what data to pull (and where: Chartink/StockScan/Screener/TradingView for scans, Google Finance for RS comparison).
- **The case studies are from a recorded podcast** with dates attached. Treat them as teaching material with known outcomes, never as current calls on those stocks.
- **Stay in the framework.** If asked "will X go up?", answer by re-framing into stage/base/catalyst/R:R terms and what data would settle it. Personalized buy/sell instructions are out of scope — say so once, briefly, and deliver the framework analysis anyway.
- India-market defaults (Nifty benchmark, ₹-based liquidity floors) are the podcast's context; state when a rule is market-agnostic vs India-specific.

## References

Read on demand — don't load all of them for simple questions:

- `references/scanning.md` — the daily scan system: near-high scan spec with filters, industry grouping, new-entrant tracking, result-season scan, announcement scans (PPTs, con-calls, buybacks, M&A, warrants, business updates), RS windows & naked-eye method, RSI vs RS, the daily research routine, AI-as-simplifier, tools.
- `references/stage-analysis.md` — Weinstein stages in depth, Dow theory & Darvas boxes, base types (long/short/IPO/late-stage), overhead supply, climactic tops vs slow distribution, high-base effect in order-book businesses, theme reshuffling after external shocks, leaders keep leading.
- `references/catalysts.md` — the full fundamental-catalyst taxonomy with podcast examples, the P&L first-principles walkthrough, negative triggers and trap patterns.
- `references/exits-and-risk.md` — trailing-stop philosophy, distribution exit mechanics, loss-recovery math, position management rules (partial vs full exits, shakeouts), and the investor-bias taxonomy with case studies.
- `references/case-studies.md` — every podcast case study indexed by name → setup → lesson (BSE, Lumax, Ashok Leyland, Apar, Tata Elxsi, IRCTC/DMart/IEX, Tejas, shrimp cycle, gold-loan NBFCs, HBL, RVNL/Mazagon, Mahindra, Edelweiss/Nuvama, Jaiswal Neco, Windlas, and more) + the reading list and free resources.
