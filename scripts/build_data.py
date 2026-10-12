#!/usr/bin/env python3
"""
Build the aggregated, PII-free data file used by the DePaul Prep college map.

Input : data/raw/<file>.xlsx or .csv   (an export of the matriculation report;
                                         NEVER committed, see .gitignore)
Output: web/data/matriculation.json     (per-school counts only, no names/IDs)
        web/logos/<school-id>.png       (school logos, fetched once and cached)
        data/geocode-cache.json         (lat/lon + website per school, committed)
        dist/dcp-college-map.bundle.js  (single-file build for uploading to the CMS)
        dist/dcp-college-map.html       (same, as a standalone page for iframes)

Usage:
    python3 scripts/build_data.py [path/to/export.xlsx] [--no-network] [--refetch-logos]

The input must have these columns (header names are matched case-insensitively):
    College, Class Of, City, State, Country
Any other columns (Student ID, Name, Nick Name, College Type, ...) are read only
to be discarded.  Student names and IDs never leave this script.
"""

import csv
import difflib
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
IPEDS_CSV = ROOT / "data" / "ipeds-institutions.csv"
OVERRIDES = ROOT / "data" / "overrides.json"
CACHE = ROOT / "data" / "geocode-cache.json"
OUT_JSON = ROOT / "web" / "data" / "matriculation.json"
LOGO_DIR = ROOT / "web" / "logos"

USER_AGENT = "dcp-college-map-build/1.0 (https://github.com/justro/dcp-college-map)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
LOGO_SERVICE = "https://www.google.com/s2/favicons?domain={domain}&sz=128"
LOGO_SERVICE_2 = "https://icons.duckduckgo.com/ip3/{domain}.ico"

# Country codes/names as they appear in the export -> ISO-3166 alpha-2 + region
COUNTRY_ALIASES = {
    "us": "US", "usa": "US", "united states": "US", "united states of america": "US",
    "ca": "CA", "canada": "CA",
    "gb": "GB", "uk": "GB", "united kingdom": "GB", "england": "GB", "scotland": "GB",
    "ie": "IE", "ireland": "IE",
    "it": "IT", "italy": "IT",
    "es": "ES", "spain": "ES",
    "fr": "FR", "france": "FR",
    "ch": "CH", "switzerland": "CH",
    "nl": "NL", "netherlands": "NL", "the netherlands": "NL",
    "hr": "HR", "croatia": "HR",
    "de": "DE", "germany": "DE",
    "au": "AU", "australia": "AU",
    "jp": "JP", "japan": "JP",
    "kr": "KR", "south korea": "KR",
    "mx": "MX", "mexico": "MX",
    "pt": "PT", "portugal": "PT",
    "be": "BE", "belgium": "BE",
    "at": "AT", "austria": "AT",
    "se": "SE", "sweden": "SE",
    "dk": "DK", "denmark": "DK",
    "no": "NO", "norway": "NO",
    "cz": "CZ", "czech republic": "CZ", "czechia": "CZ",
    "pl": "PL", "poland": "PL",
    "gr": "GR", "greece": "GR",
    "il": "IL", "israel": "IL",
    "nz": "NZ", "new zealand": "NZ",
    "cn": "CN", "china": "CN",
    "hk": "HK", "hong kong": "HK",
    "sg": "SG", "singapore": "SG",
    "in": "IN", "india": "IN",
}
COUNTRY_NAMES = {
    "US": "United States", "CA": "Canada", "GB": "United Kingdom", "IE": "Ireland",
    "IT": "Italy", "ES": "Spain", "FR": "France", "CH": "Switzerland",
    "NL": "Netherlands", "HR": "Croatia", "DE": "Germany", "AU": "Australia",
    "JP": "Japan", "KR": "South Korea", "MX": "Mexico", "PT": "Portugal",
    "BE": "Belgium", "AT": "Austria", "SE": "Sweden", "DK": "Denmark", "NO": "Norway",
    "CZ": "Czechia", "PL": "Poland", "GR": "Greece", "IL": "Israel",
    "NZ": "New Zealand", "CN": "China", "HK": "Hong Kong", "SG": "Singapore", "IN": "India",
}
# Which inset ("cutout") a non-US country is drawn in.
REGIONS = {
    "CA": "Canada", "MX": "Mexico & Caribbean",
    "GB": "Europe", "IE": "Europe", "IT": "Europe", "ES": "Europe", "FR": "Europe",
    "CH": "Europe", "NL": "Europe", "HR": "Europe", "DE": "Europe", "PT": "Europe",
    "BE": "Europe", "AT": "Europe", "SE": "Europe", "DK": "Europe", "NO": "Europe",
    "CZ": "Europe", "PL": "Europe", "GR": "Europe",
    "AU": "Asia & Pacific", "NZ": "Asia & Pacific", "JP": "Asia & Pacific",
    "KR": "Asia & Pacific", "CN": "Asia & Pacific", "HK": "Asia & Pacific",
    "SG": "Asia & Pacific", "IN": "Asia & Pacific", "IL": "Middle East & Africa",
}

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
}
US_STATE_BY_NAME = {v.lower(): k for k, v in US_STATES.items()}

# Columns that may appear in the export and MUST NOT appear in the output.
FORBIDDEN_OUTPUT_KEYS = {"student id", "studentid", "name", "nick name", "nickname", "student"}
ALLOWED_SCHOOL_KEYS = {
    "id", "name", "city", "state", "stateName", "country", "countryName", "region",
    "type", "lat", "lon", "logo", "website", "total", "byYear",
}


# ----------------------------------------------------------------------------- helpers
def log(msg):
    print(msg, file=sys.stderr)


def norm(s):
    """Normalize a school name for matching: ascii, lowercase, alnum only."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"\b(the|of|at|and|&|-|main campus|campus)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]


def http_get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def domain_of(url):
    if not url:
        return ""
    u = url.strip()
    if "://" not in u:
        u = "http://" + u
    host = urllib.parse.urlparse(u).netloc.lower()
    host = host.split("@")[-1].split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host


# ----------------------------------------------------------------------------- input
def find_input(arg):
    if arg:
        p = Path(arg)
        if not p.exists():
            sys.exit(f"Input file not found: {p}")
        return p
    cands = sorted(
        [p for p in RAW_DIR.glob("*") if p.suffix.lower() in (".xlsx", ".csv")],
        key=lambda p: p.stat().st_mtime,
    )
    if not cands:
        sys.exit(f"No .xlsx or .csv export found in {RAW_DIR}. "
                 "Export the Numbers file as CSV or Excel and drop it there.")
    return cands[-1]


def read_rows(path):
    """Return a list of dicts with lower-cased header keys."""
    if path.suffix.lower() == ".csv":
        text = path.read_bytes()
        if text.startswith(b"\xef\xbb\xbf"):
            text = text[3:]
        rdr = csv.DictReader(io.StringIO(text.decode("utf-8")))
        return [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in rdr]
    try:
        import openpyxl  # noqa
    except ImportError:
        sys.exit("openpyxl is required for .xlsx input: pip install -r scripts/requirements.txt "
                 "(or export the sheet as CSV instead).")
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [str(h or "").strip().lower() for h in next(it)]
    rows = []
    for r in it:
        if not any(v not in (None, "") for v in r):
            continue
        rows.append({header[i]: ("" if v is None else str(v).strip()) for i, v in enumerate(r) if i < len(header)})
    return rows


def pick(row, *names):
    for n in names:
        if n in row and row[n] != "":
            return row[n]
    return ""


def parse_country(raw):
    r = (raw or "").strip().lower()
    if not r:
        return "US"
    return COUNTRY_ALIASES.get(r, r.upper()[:2])


def parse_state(raw, country):
    r = (raw or "").strip()
    if country != "US":
        return r  # keep province / region text as-is
    if r.upper() in US_STATES:
        return r.upper()
    return US_STATE_BY_NAME.get(r.lower(), r.upper())


# ----------------------------------------------------------------------------- aggregate
def aggregate(rows, aliases):
    schools = {}
    years = set()
    for r in rows:
        college = pick(r, "college", "school", "institution").strip()
        if not college:
            continue
        college = aliases.get(college, college)
        year = pick(r, "class of", "class year", "year", "grad year")
        year = re.sub(r"\D", "", str(year))[:4] or "unknown"
        years.add(year)
        country = parse_country(pick(r, "country"))
        state = parse_state(pick(r, "state", "state/province", "province"), country)
        city = pick(r, "city")
        ctype = pick(r, "college type", "type")
        key = college.strip()
        s = schools.setdefault(key, {
            "id": slugify(key),
            "name": key,
            "city": city,
            "state": state,
            "country": country,
            "type": ctype,
            "total": 0,
            "byYear": defaultdict(int),
        })
        if not s["city"] and city:
            s["city"] = city
        if not s["type"] and ctype:
            s["type"] = ctype
        s["total"] += 1
        s["byYear"][year] += 1
    for s in schools.values():
        s["byYear"] = dict(sorted(s["byYear"].items()))
        s["stateName"] = US_STATES.get(s["state"], s["state"]) if s["country"] == "US" else s["state"]
        s["countryName"] = COUNTRY_NAMES.get(s["country"], s["country"])
        s["region"] = "United States" if s["country"] == "US" else REGIONS.get(s["country"], "Other International")
    return list(schools.values()), sorted(years)


# ----------------------------------------------------------------------------- geocoding
def load_ipeds():
    by_state = defaultdict(list)
    with open(IPEDS_CSV, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            r["_n"] = norm(r["name"])
            r["_aliases"] = [norm(a) for a in re.split(r"[|;,]", r["alias"]) if a.strip()]
            by_state[r["state"]].append(r)
    return by_state


def match_ipeds(school, ipeds):
    cands = ipeds.get(school["state"], [])
    if not cands:
        return None, None
    # Exports often disambiguate with a suffix, e.g. "American University - District of Columbia"
    bare = re.sub(r"\s+[-\u2013(]\s*[^-\u2013()]+\)?\s*$", "", school["name"]).strip()
    targets = [norm(school["name"])] + ([norm(bare)] if bare != school["name"] else [])
    for target in targets:
        for c in cands:  # exact normalized match on name or alias
            if c["_n"] == target or target in c["_aliases"]:
                return c, "ipeds-exact"
    same_city = [c for c in cands if norm(c["city"]) == norm(school["city"])] if school["city"] else []
    for target in targets:
        # Same city and one name is a prefix of the other (Arizona State University Campus Immersion)
        for c in same_city:
            if len(target) >= 12 and (c["_n"].startswith(target) or target.startswith(c["_n"])):
                return c, "ipeds-prefix"
    for target in targets:
        names = {c["_n"]: c for c in same_city}
        best = difflib.get_close_matches(target, list(names), n=1, cutoff=0.9)
        if best:
            return names[best[0]], "ipeds-fuzzy"
    return None, None


def nominatim(query):
    url = NOMINATIM + "?" + urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    try:
        data = json.loads(http_get(url))
    except Exception as e:  # noqa
        log(f"    geocoder error for {query!r}: {e}")
        return None
    time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
    if not data:
        return None
    return {"lat": round(float(data[0]["lat"]), 5), "lon": round(float(data[0]["lon"]), 5)}


def geocode_all(schools, cache, overrides, network):
    ipeds = load_ipeds()
    changed = False
    for s in schools:
        ov = overrides.get(s["name"], {})
        entry = cache.get(s["name"], {})
        if "lat" not in entry or "lon" not in entry:
            if s["country"] == "US":
                m, how = match_ipeds(s, ipeds)
                if m and m["lat"] and m["lon"]:
                    entry = {"lat": float(m["lat"]), "lon": float(m["lon"]),
                             "website": m["website"], "source": how, "matched": m["name"]}
                    log(f"  [{how:12}] {s['name']}  ->  {m['name']}")
            if "lat" not in entry and network:
                place = ", ".join(x for x in (s["city"], s["stateName"], s["countryName"]) if x)
                hit = nominatim(f"{s['name']}, {place}") or nominatim(place)
                if hit:
                    entry = {**hit, "source": "nominatim", "matched": place}
                    log(f"  [nominatim   ] {s['name']}  ->  {place}")
            if "lat" in entry:
                cache[s["name"]] = entry
                changed = True
            else:
                log(f"  [UNRESOLVED  ] {s['name']} ({s['city']}, {s['state']}, {s['country']}) "
                    f"- add coordinates to data/overrides.json")
        # apply overrides last so they always win
        for k in ("lat", "lon", "website", "logo", "name"):
            if k in ov:
                entry[k] = ov[k]
        s["lat"] = entry.get("lat")
        s["lon"] = entry.get("lon")
        s["website"] = domain_of(entry.get("website", ""))
        s["_logo_override"] = entry.get("logo")
        if "name" in ov:
            s["name"] = ov["name"]
    return changed


# ----------------------------------------------------------------------------- logos
def find_site_icon(domain):
    """Look for a high-resolution icon declared in the site's HTML."""
    try:
        html = http_get(f"https://{domain}/", timeout=15).decode("utf-8", "ignore")[:200000]
    except Exception:
        try:
            html = http_get(f"https://www.{domain}/", timeout=15).decode("utf-8", "ignore")[:200000]
        except Exception:
            return None
    best, best_size = None, 0
    for tag in re.findall(r"<link[^>]+>", html, flags=re.I):
        rel = re.search(r"rel=[\"']([^\"']+)", tag, flags=re.I)
        href = re.search(r"href=[\"']([^\"']+)", tag, flags=re.I)
        if not rel or not href:
            continue
        rel = rel.group(1).lower()
        if "icon" not in rel:
            continue
        size = 180 if "apple-touch" in rel else 32
        m = re.search(r"sizes=[\"'](\d+)x", tag, flags=re.I)
        if m:
            size = int(m.group(1))
        if href.group(1).lower().endswith(".svg"):
            size = 512
        if size > best_size:
            best, best_size = href.group(1), size
    if not best or best_size < 48:
        return None
    return urllib.parse.urljoin(f"https://{domain}/", best.replace("&amp;", "&"))


def save_logo(raw, dest):
    """Normalise whatever we downloaded to a PNG (or SVG). Returns (path, pixel size)."""
    if raw.lstrip()[:5].lower().startswith(b"<svg") or b"<svg" in raw[:2000]:
        dest = dest.with_suffix(".svg")
        dest.write_bytes(raw)
        return dest, 512
    try:
        from PIL import Image  # optional dependency, see scripts/requirements.txt
        img = Image.open(io.BytesIO(raw))
        if getattr(img, "n_frames", 1) > 1:  # .ico with several sizes: take the largest
            sizes = sorted(getattr(img, "ico", None).sizes()) if hasattr(img, "ico") else []
            if sizes:
                img.size = sizes[-1]
                img.load()
        img = img.convert("RGBA")
        if max(img.size) > 256:
            img.thumbnail((256, 256))
        img.save(dest, "PNG")
        return dest, min(img.size)
    except ImportError:
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            dest.write_bytes(raw)
            return dest, 0
        return None, 0
    except Exception:
        return None, 0


def fetch_logos(schools, network, refetch):
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    for s in schools:
        dest = LOGO_DIR / f"{s['id']}.png"
        existing = [p for p in LOGO_DIR.glob(f"{s['id']}.*") if p.suffix in (".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp")]
        override = s.pop("_logo_override", None)
        if override and not override.startswith("http"):
            existing = [LOGO_DIR / override] if (LOGO_DIR / override).exists() else []
        elif network and (refetch or not existing):
            sources = []
            if override:
                sources.append(("logo-url", override))
            elif s["website"]:
                icon = find_site_icon(s["website"])
                if icon:
                    sources.append(("logo-site", icon))
                sources.append(("logo-google", LOGO_SERVICE.format(domain=s["website"])))
                sources.append(("logo-ddg", LOGO_SERVICE_2.format(domain=s["website"])))
            for tag, url in sources:
                try:
                    raw = http_get(url)
                except Exception as e:  # noqa
                    log(f"  [{tag + '-fail':12}] {s['name']}: {e}")
                    continue
                if len(raw) < 200:  # Google returns a tiny default globe for unknown domains
                    continue
                for old in existing:
                    old.unlink(missing_ok=True)
                saved, px = save_logo(raw, dest)
                if saved:
                    existing = [saved]
                    log(f"  [{tag:12}] {s['name']} ({px}px)")
                    break
            time.sleep(0.2)
        s["logo"] = f"logos/{existing[0].name}" if existing else None


# ----------------------------------------------------------------------------- output
def privacy_check(schools, rows):
    """Fail loudly if anything that looks like student data reached the output."""
    for s in schools:
        extra = set(s) - ALLOWED_SCHOOL_KEYS
        if extra:
            sys.exit(f"PRIVACY CHECK FAILED: unexpected keys {extra} in output for {s['name']}")
    blob = json.dumps(schools).lower()
    ids = {pick(r, "student id", "studentid", "id") for r in rows}
    ids = {i for i in ids if i and len(i) >= 4}
    for i in ids:
        if f'"{i}"' in blob or f":{i}," in blob:
            sys.exit(f"PRIVACY CHECK FAILED: student id {i} found in output")
    names = {pick(r, "name", "student name") for r in rows}
    names = {n.lower() for n in names if n and "," in n}
    for n in names:
        if n in blob:
            sys.exit(f"PRIVACY CHECK FAILED: a student name was found in output")


def main(argv):
    network = "--no-network" not in argv
    refetch = "--refetch-logos" in argv
    args = [a for a in argv if not a.startswith("--")]
    src = find_input(args[0] if args else None)
    log(f"Reading {src}")
    rows = read_rows(src)
    log(f"  {len(rows)} student rows")

    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    schools, years = aggregate(rows, overrides.get("aliases", {}))
    log(f"  {len(schools)} distinct schools, class years {', '.join(years)}")

    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    log("Geocoding...")
    if geocode_all(schools, cache, overrides.get("schools", {}), network):
        CACHE.write_text(json.dumps(dict(sorted(cache.items())), indent=1, ensure_ascii=False) + "\n")
    log("Logos...")
    fetch_logos(schools, network, refetch)

    schools.sort(key=lambda s: (-s["total"], s["name"]))
    privacy_check(schools, rows)

    out = {
        "generated": date.today().isoformat(),
        "source": src.name,
        "years": years,
        "totalStudents": sum(s["total"] for s in schools),
        "schools": schools,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    unresolved = [s["name"] for s in schools if s["lat"] is None]
    log(f"Wrote {OUT_JSON.relative_to(ROOT)}  ({out['totalStudents']} students, {len(schools)} schools)")
    if unresolved:
        log(f"WARNING: {len(unresolved)} school(s) have no coordinates and will not get a map pin: "
            + "; ".join(unresolved))
    log("Bundling single-file build...")
    sys.path.insert(0, str(ROOT / "scripts"))
    import bundle  # noqa: E402
    bundle.main()
    log("Done.")


if __name__ == "__main__":
    main(sys.argv[1:])
