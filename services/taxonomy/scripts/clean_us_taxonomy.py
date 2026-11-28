# clean_us_taxonomy.py — tidy the raw Nasdaq scrape into us_groups.csv.
# pip install pandas
# Input:  data/us_stocks_taxonomy.csv (us_fetch_taxonomy.py output)
# Output: data/us_groups.csv — one row per stock with sector/industry_group/
#         sub_industry filled from the best available source, plus
#         taxonomy_source = GICS | NASDAQ | OTHER (how the sector was derived).
#
# Rules:
#   - GICS wins when present (S&P 500 rows): gics_sector -> sector,
#     gics_sub_industry -> sub_industry, industry_group empty.
#   - Else Nasdaq sector + "industry" split ("Group: Sub" -> both halves).
#   - Anything still empty -> "Other" (sector) / "Unclassified" (groups).
#   - Names title-cased consistently, US spread across markets deduped by symbol.
import re, sys
import pandas as pd
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

def tidy(name: str) -> str:
    s = re.sub(r"\s+", " ", str(name or "").strip())
    if not s:
        return ""
    # ALL-CAPS acronyms stay; otherwise normal title case keeps "ETFs" -> "Etfs"? no: keep words <=3 upper intact
    if s.isupper() and len(s) <= 5:
        return s
    return s[0].upper() + s[1:]

df = pd.read_csv(DATA / "us_stocks_taxonomy.csv").drop_duplicates("symbol")

# Start from the Nasdaq split (industry column is "Group: Sub-Industry" or bare).
ind = df["industry"].fillna("").str.split(r":\s*", n=1, expand=True)
sector = df["sector"].fillna("").map(tidy)
group = ind[0].fillna("").map(tidy)
sub = (ind[1] if ind.shape[1] > 1 else pd.Series("", index=df.index)).fillna("").map(tidy)

# GICS overlay where present (S&P 500).
has_gics = df["gics_sector"].notna() & (df["gics_sector"].astype(str).str.strip() != "")
sector = sector.where(~has_gics, df["gics_sector"].map(tidy))
sub = sub.where(~has_gics, df["gics_sub_industry"].fillna("").map(tidy))

source = pd.Series("NASDAQ", index=df.index)
source.loc[has_gics] = "GICS"

# Merge stray near-duplicate sector names (Nasdaq vs GICS spellings) and junk.
SECTOR_ALIAS = {
    "Financials": "Finance", "Materials": "Basic Materials",
    "Information Technology": "Technology", "Communication Services": "Telecommunications",
}
sector = sector.map(lambda s: SECTOR_ALIAS.get(s, s))
sector = sector.where(sector.str.match(r"^[A-Za-z]", na=False), "Other")  # junk like "2025"

# Buckets for the blanks.
no_sector = sector.fillna("") == ""
sector = sector.where(~no_sector, "Other")
source.loc[no_sector] = "OTHER"
group = group.fillna("").where(group.fillna("") != "", "Unclassified")
sub = sub.fillna("").where(sub.fillna("") != "", "Unclassified")

out = pd.DataFrame({
    "symbol": df["symbol"], "name": df["name"], "exchange": df["exchange"],
    "market_cap": df["market_cap"], "sector": sector, "industry_group": group,
    "sub_industry": sub, "taxonomy_source": source,
}).sort_values(["sector", "industry_group", "sub_industry", "market_cap"],
               ascending=[True, True, True, False])

out.to_csv(DATA / "us_groups.csv", index=False)
print(f"{len(out)} stocks -> us_groups.csv")
print(out.groupby("sector").size().sort_values(ascending=False).to_string())
blank = out[(out.sector == "Other") & (out.taxonomy_source != "OTHER")]
print(f"warning: {len(blank)} rows still tagged Other with a source:", blank.symbol.head().tolist())
