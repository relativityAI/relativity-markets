import os
# screener_taxonomy.py  —  pip install requests beautifulsoup4
import re, csv, sys, time, requests
from bs4 import BeautifulSoup

BASE = "https://www.screener.in"
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (research script; personfrom pathlib import Path
os.chdir(Path(__file__).resolve().parent.parent / "data")  # all I/O lands in ../data regardless of cwd

al use)"

def log(*a):
    print(*a, flush=True)

def get(path):
    url = BASE + path
    for attempt in range(1, 5):
        log(f"  GET {url} (attempt {attempt})")
        try:
            r = S.get(url, timeout=20)
        except requests.RequestException as e:
            log(f"    ! network error: {e}")
            time.sleep(3 * attempt); continue
        log(f"    -> {r.status_code}, {len(r.text)} bytes")
        if r.status_code in (429, 403, 503):
            log(f"    ! blocked/rate-limited, sleeping {5*attempt}s")
            time.sleep(5 * attempt); continue
        r.raise_for_status()
        time.sleep(1.0)
        return BeautifulSoup(r.text, "html.parser")
    log(f"FATAL: could not fetch {url}"); sys.exit(1)

def links(soup, pattern):
    """{code: name} for anchors whose normalized href matches pattern."""
    out = {}
    for a in soup.find_all("a", href=True):
        href = re.sub(r"^https?://(www\.)?screener\.in", "", a["href"])
        if re.search(pattern, href):
            code = href.rstrip("/").split("/")[-1]
            name = re.sub(r"\s*-\s*\d+\s*$", "", a.get_text(" ", strip=True))
            if name:
                out.setdefault(code, name)
    return out

log("[1/4] fetching /market/ (all basic industries)")
home = get("/market/")
leaf = links(home, r"^/market/IN\d{2}/IN\d{4}/IN\d{6}/IN\d{9}/?$")
log(f"  found {len(leaf)} basic industries")
if not leaf:
    log("FATAL: 0 basic industries parsed. Page HTML differs from expected "
        "(or you got a block page). First 500 chars of page text:")
    log(home.get_text(' ', strip=True)[:500]); sys.exit(1)

sectors = sorted({c[:4] for c in leaf})
groups  = sorted({c[:6] for c in leaf})
log(f"  derived {len(sectors)} sectors, {len(groups)} industry groups")

log(f"[2/4] fetching {len(sectors)} sector pages")
sector_name, group_name = {}, {}
for n, s in enumerate(sectors, 1):
    log(f" sector {n}/{len(sectors)}: {s}")
    p = get(f"/market/{s}/")
    h1 = p.find("h1")
    sector_name[s] = re.sub(r"\s+Companies\s*$", "", h1.get_text(strip=True)) if h1 else ""
    found = links(p, rf"^/market/{s}/IN\d{{4}}/?$")
    group_name.update(found)
    log(f"    '{sector_name[s]}' -> {len(found)} groups")

log(f"[3/4] fetching {len(groups)} industry-group pages")
industry_name = {}
for n, g in enumerate(groups, 1):
    log(f" group {n}/{len(groups)}: {g}")
    p = get(f"/market/{g[:4]}/{g}/")
    found = links(p, rf"^/market/{g[:4]}/{g}/IN\d{{6}}/?$")
    industry_name.update(found)
    log(f"    '{group_name.get(g,'?')}' -> {len(found)} industries")

log("[4/4] writing CSV")
rows = []
for code, name in sorted(leaf.items()):
    s, g, i = code[:4], code[:6], code[:8]
    rows.append({
        "sector_code": s, "sector": sector_name.get(s, ""),
        "industry_group_code": g, "industry_group": group_name.get(g, ""),
        "industry_code": i, "industry": industry_name.get(i, ""),
        "basic_industry_code": code, "basic_industry": name,
        "url": f"{BASE}/market/{s}/{g}/{i}/{code}/",
    })
with open("screener_taxonomy.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys())
    w.writeheader(); w.writerows(rows)

missing = [r["basic_industry_code"] for r in rows
           if not (r["sector"] and r["industry_group"] and r["industry"])]
log(f"DONE: {len(rows)} rows -> screener_taxonomy.csv; {len(missing)} with missing parent names: {missing[:10]}")
