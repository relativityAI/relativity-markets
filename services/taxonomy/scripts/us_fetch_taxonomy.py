import os
# us_taxonomy.py  —  pip install requests pandas lxml
import re, sys, time, json, requests, pandas as pd
from io import from pathlib import Path
os.chdir(Path(__file__).resolve().parent.parent / "data")  # all I/O lands in ../data regardless of cwd

StringIO

def log(*a): print(*a, flush=True)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
NASDAQ_HDR = {"User-Agent": UA, "Accept": "application/json, text/plain, */*",
              "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
norm = lambda s: re.sub(r"[/\-]", ".", str(s).strip().upper())   # BRK/B, BRK-B -> BRK.B

def get(url, **kw):
    for attempt in range(1, 5):
        log(f"  GET {url[:90]} {kw.get('params','')} (attempt {attempt})")
        try:
            r = requests.get(url, timeout=60, **kw)
        except requests.RequestException as e:
            log(f"    ! {e}"); time.sleep(3 * attempt); continue
        log(f"    -> {r.status_code}, {len(r.content)} bytes")
        if r.status_code in (429, 403, 503):
            log(f"    ! blocked/limited, sleeping {10*attempt}s"); time.sleep(10 * attempt); continue
        r.raise_for_status(); return r
    sys.exit("FATAL: giving up")

# ---- [1] Nasdaq screener: all US-listed stocks with sector + industry ----
log("[1/3] Nasdaq screener")
rows = []
for ex in ("nasdaq", "nyse", "amex"):
    r = get("https://api.nasdaq.com/api/screener/stocks",
            headers=NASDAQ_HDR,
            params={"tableonly": "true", "limit": "25", "offset": "0",
                    "download": "true", "exchange": ex})
    data = (r.json().get("data") or {})
    got = data.get("rows") or (data.get("table") or {}).get("rows") or []
    if not got:
        log("  ! no rows; response keys:", list(r.json().keys()), "| data keys:", list(data.keys()))
    log(f"  {ex}: {len(got)} rows")
    for g in got: g["exchange"] = ex.upper()
    rows += got
    time.sleep(2)

df = pd.DataFrame(rows)
if df.empty: sys.exit("FATAL: Nasdaq returned nothing")
df["symbol"] = df["symbol"].map(norm)
df = df.drop_duplicates("symbol")
df["market_cap"] = pd.to_numeric(df["marketCap"].astype(str).str.replace(",", ""), errors="coerce")
df["sector"] = df["sector"].fillna("").str.strip()
ind = df["industry"].fillna("").str.split(r":\s*", n=1, expand=True)
df["industry_group"] = ind[0].str.strip()
df["sub_industry"] = ind[1].str.strip() if ind.shape[1] > 1 else ""
log(f"  total unique symbols: {len(df)} | with sector: {(df.sector!='').sum()} | with industry: {(df.industry_group!='').sum()}")

# ---- [2] S&P 500 GICS (sector + sub-industry) from Wikipedia ----
log("[2/3] S&P 500 GICS from Wikipedia")
try:
    r = get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", headers={"User-Agent": UA})
    sp = pd.read_html(StringIO(r.text))[0]
    sp["symbol"] = sp["Symbol"].map(norm)
    sp = sp[["symbol", "GICS Sector", "GICS Sub-Industry"]].rename(
        columns={"GICS Sector": "gics_sector", "GICS Sub-Industry": "gics_sub_industry"})
    df = df.merge(sp, on="symbol", how="left")
    log(f"  GICS matched: {df.gics_sector.notna().sum()} of {len(sp)} S&P 500 symbols")
except Exception as e:
    log(f"  ! GICS join skipped: {e}")

# ---- [3] Write outputs ----
log("[3/3] writing files")
cols = ["symbol", "name", "exchange", "country", "market_cap", "ipoyear",
        "sector", "industry", "industry_group", "sub_industry"] + \
       [c for c in ("gics_sector", "gics_sub_industry") if c in df.columns]
df[cols].sort_values(["sector", "industry", "market_cap"], ascending=[True, True, False]) \
        .to_csv("us_stocks_taxonomy.csv", index=False)

tree = {}
for r_ in df.itertuples():
    tree.setdefault(r_.sector or "?", {}).setdefault(r_.industry or "?", []).append(r_.symbol)
json.dump(tree, open("us_taxonomy_tree.json", "w"), indent=1)

log(f"DONE: {len(df)} stocks -> us_stocks_taxonomy.csv, us_taxonomy_tree.json")
log(df.groupby("sector").size().sort_values(ascending=False).to_string())
