# Taxonomy — sectors, industries, constituents

Data + regeneration scripts for the sector/industry trees powering group search,
group pages, and group runs. The API reads the CSVs here in-memory (no DB).

## Files

| File | What |
| --- | --- |
| `data/screener_taxonomy.csv` | India 4-level tree (sector → industry group → industry → basic industry, codes `IN01…`). |
| `data/screener_constituents.csv` | Every NSE stock with its full taxonomy path + Screener fundamentals snapshot. |
| `data/us_stocks_taxonomy.csv` | Raw US scrape (Nasdaq screener + S&P 500 GICS from Wikipedia). Kept for provenance. |
| `data/us_groups.csv` | Cleaned US tree — the file the API reads. Columns: symbol, name, exchange, market_cap, sector, industry_group, sub_industry, taxonomy_source (GICS/NASDAQ/OTHER). |

## Regenerate

```bash
pip install requests beautifulsoup4 pandas lxml

python3 scripts/screener_fetch_taxonomy.py       # India tree (~10 min, rate-limited by Screener.in)
python3 scripts/screener_fetch_constituents.py   # India constituents (~1-2 h, all listing pages)
python3 scripts/us_fetch_taxonomy.py             # US raw scrape (~2 min)
python3 scripts/clean_us_taxonomy.py             # US cleaned tree (seconds)
```

All scripts read/write `data/` regardless of cwd. Scraper scripts retry with
backoff on 429/403/503 — if Screener/Nasdaq block harder, wait and rerun.

A future "refresh the lists" run = rerun these four commands; nothing else changes.
