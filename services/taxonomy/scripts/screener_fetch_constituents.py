import os
# screener_constituents.py  —  pip install requests beautifulsoup4 pandas
import re, csv, time, sys, requests
import pandas as pd
from bs4 import BeautifulSoup

BASE = "https://www.screener.in"
LIMIT = 50
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (research script; personfrom pathlib import Path
os.chdir(Path(__file__).resolve().parent.parent / "data")  # all I/O lands in ../data regardless of cwd

al use)"

def log(*a): print(*a, flush=True)

def get(url):
    for attempt in range(1, 5):
        try:
            r = S.get(url, timeout=20)
        except requests.RequestException as e:
            log(f"    ! network error: {e}"); time.sleep(3 * attempt); continue
        if r.status_code in (429, 403, 503):
            log(f"    ! {r.status_code}, sleeping {5*attempt}s"); time.sleep(5 * attempt); continue
        r.raise_for_status()
        if "/login" in r.url:
            log("    ! redirected to login"); return None
        time.sleep(1.0)
        return BeautifulSoup(r.text, "html.parser")
    return None

def parse_page(soup):
    """-> (total_results, [row dicts]) for one listing page."""
    m = re.search(r"([\d,]+)\s+results?\s+found", soup.get_text(" "))
    total = int(m.group(1).replace(",", "")) if m else None
    table = soup.find("table")
    if not table:
        return total, []
    header = [th.get_text(" ", strip=True) for th in table.find_all("th")][:11]
    out = []
    for tr in table.find_all("tr"):
        a = tr.find("a", href=re.compile(r"/company/"))
        if not a:
            continue  # header / repeated-header rows
        path = re.sub(r"^https?://(www\.)?screener\.in", "", a["href"])
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        row = {"symbol": path.split("/")[2], "company": a.get_text(strip=True),
               "company_url": BASE + path}
        for h, c in zip(header[2:], cells[2:]):   # skip S.No. and Company columns
            row[h] = c
        out.append(row)
    return total, out

tax = pd.read_csv("screener_taxonomy.csv")
log(f"loaded {len(tax)} basic industries from screener_taxonomy.csv")

all_rows, problems = [], []
for n, t in enumerate(tax.itertuples(), 1):
    log(f"[{n}/{len(tax)}] {t.sector} > {t.industry_group} > {t.industry} > {t.basic_industry}")
    got, total, page = [], None, 1
    while True:
        soup = get(f"{t.url}?limit={LIMIT}&page={page}")
        if soup is None:
            log("    ! fetch failed, stopping this industry"); break
        total_p, rows = parse_page(soup)
        total = total if total is not None else total_p
        log(f"    page {page}: {len(rows)} rows (total reported: {total})")
        if not rows: break
        got += rows
        if total is not None and len(got) >= total: break
        page += 1
    if total is not None and len(got) != total:
        problems.append((t.basic_industry_code, t.basic_industry, len(got), total))
        log(f"    !! MISMATCH got {len(got)} vs {total}")
    for g in got:
        all_rows.append({"sector_code": t.sector_code, "sector": t.sector,
                         "industry_group_code": t.industry_group_code, "industry_group": t.industry_group,
                         "industry_code": t.industry_code, "industry": t.industry,
                         "basic_industry_code": t.basic_industry_code, "basic_industry": t.basic_industry,
                         **g})
    pd.DataFrame(all_rows).to_csv("screener_constituents.csv", index=False)  # incremental save

log(f"DONE: {len(all_rows)} rows, {len({r['symbol'] for r in all_rows})} unique symbols")
log(f"{len(problems)} industries with count mismatches: {problems[:10]}")
