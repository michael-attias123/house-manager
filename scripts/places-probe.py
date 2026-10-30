"""Read-only: what other sources know about places to go out in Be'er Sheva.

Run by .github/workflows/places-probe.yml, from GitHub's network (these sites
are not reachable from every machine). For each source it prints whether it
answered, how its pages are built, and a few sample places, to decide which
ones the weekly load should read:

- Dapei Zahav (d.co.il): the city's restaurants, with addresses and hours.
- Club Hub: the restaurants that honor the "חבר טעמים" card, and their branches.
- Wolt: restaurants by coordinates (unofficial API; a single request here).
- Isracard's "חבר" club page: the chains its loadable cards work at.
- Hever's own "חבר טעמים" store locator, searchable by town.
- visitbr7.co.il, the city's tourism site: its night-life page.

Nothing is written anywhere. A source that fails is reported and skipped.
"""

import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from html import unescape

CENTER = (31.2518, 34.7913)
CITY = "באר שבע"
UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
)


def get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9", "Accept-Encoding": "gzip"}
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            body = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return resp.status, body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:2000]


def text_of(html: str) -> str:
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def around(text: str, word: str, width: int = 90, limit: int = 5) -> list[str]:
    return [text[max(0, m.start() - width): m.end() + width] for m in re.finditer(re.escape(word), text)][:limit]


def json_ld(html: str) -> list:
    out = []
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        out.extend(data if isinstance(data, list) else data.get("@graph", [data]))
    return out


def page_shape(html: str) -> None:
    print(f"  size {len(html):,} chars; JSON-LD types:",
          dict(Counter(str(d.get("@type")) for d in json_ld(html) if isinstance(d, dict))))
    for marker in ("__NEXT_DATA__", "__NUXT__", "window.__INITIAL_STATE__", "ng-version", "data-reactroot"):
        if marker in html:
            print(f"  has {marker}")
    apis = sorted(set(re.findall(r'https?://[a-z0-9.-]*(?:api)[a-z0-9.-]*\.[a-z]+/[^"\'\s<>]{0,80}', html)))
    if apis:
        print("  api-looking URLs:", *apis[:12], sep="\n    ")


def section(title: str):
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def dapei_zahav() -> None:
    section("Dapei Zahav (d.co.il): restaurants in Be'er Sheva (city9000)")
    pages = {}
    for offset in (0, 40):
        url = f"https://www.d.co.il/h-c30420-e0-p{offset}-l0-city9000/"
        status, html = get(url)
        print(f"{url} -> HTTP {status}")
        pages[offset] = html
        if status != 200:
            print("  ", text_of(html)[:300])
            return
    html = pages[0]
    page_shape(html)
    text = text_of(html)
    total = re.search(r"(\d[\d,]*)\s*(?:תוצאות|עסקים|מסעדות)", text)
    print("  results line:", total.group(0) if total else "not found")
    places = [d for d in json_ld(html) if isinstance(d, dict) and d.get("@type") not in ("BreadcrumbList", "WebSite", "Organization")]
    for d in places[:5]:
        print("  JSON-LD place:", json.dumps({k: d.get(k) for k in ("@type", "name", "address", "telephone", "openingHours", "geo")}, ensure_ascii=False)[:400])
    links = re.findall(r'href="(/[^"]*?(?:city9000|באר-שבע)[^"]*)"[^>]*>\s*([^<]{2,40})<', html)
    print("  category links on the page (first 25):")
    for href, label in list(dict.fromkeys(links))[:25]:
        print(f"    {label.strip()} -> {href}")
    biz = re.findall(r'href="(/[a-z0-9-]*/?\d{6,}[^"]*)"', html)
    print(f"  business-looking links: {len(set(biz))}; samples:", *list(dict.fromkeys(biz))[:5], sep="\n    ")
    print("  hours mentions:", len(re.findall(r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}", text)), "| phone mentions:", len(re.findall(r"0\d{1,2}-?\d{7}", text)))
    print("  text sample:", text[:1200])


def club_hub() -> None:
    section('Club Hub: "חבר טעמים" (hvr-blue-card)')
    url = "https://www.clubhub.co.il/clubs/hvr-blue-card"
    status, html = get(url)
    print(f"{url} -> HTTP {status}")
    if status != 200:
        print("  ", text_of(html)[:300])
        return
    page_shape(html)
    deals = list(dict.fromkeys(re.findall(r'href="(/deal/[0-9a-f]{24}[^"]*)"', html)))
    print(f"  deal links in the HTML: {len(deals)}")
    for d in deals[:10]:
        print("   ", urllib.parse.unquote(d))
    text = text_of(html)
    print("  Be'er Sheva mentions:", *around(text, CITY), sep="\n    ")
    nxt = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if nxt:
        data = json.loads(nxt.group(1))
        print("  __NEXT_DATA__ keys:", list(data.get("props", {}).get("pageProps", {}).keys())[:20])
    print("  text sample:", text[:800])
    # One deal page with a Be'er Sheva branch (Gigsy, from a search result).
    deal = "https://www.clubhub.co.il/deal/64c5359f57d37639cb809b20/"
    status, page = get(deal)
    print(f"{deal} -> HTTP {status}")
    if status == 200:
        page_shape(page)
        t = text_of(page)
        print("  Be'er Sheva on the deal page:", *around(t, CITY), sep="\n    ")
        print("  text sample:", t[:800])


def wolt() -> None:
    section("Wolt: restaurants around the city center (unofficial consumer API)")
    url = f"https://consumer-api.wolt.com/v1/pages/restaurants?lat={CENTER[0]}&lon={CENTER[1]}"
    status, body = get(url)
    print(f"{url} -> HTTP {status}")
    if status != 200:
        print("  ", body[:300])
        return
    data = json.loads(body)
    sections = data.get("sections", [])
    print("  sections:", [(s.get("name"), len(s.get("items", []))) for s in sections][:10])
    venues = [i.get("venue") for s in sections for i in s.get("items", []) if i.get("venue")]
    unique = {v.get("id") or v.get("slug"): v for v in venues}
    print(f"  venues: {len(unique)}")
    if unique:
        sample = next(iter(unique.values()))
        print("  venue keys:", sorted(sample.keys()))
        print("  sample:", json.dumps({k: sample.get(k) for k in ("name", "address", "location", "tags", "short_description", "product_line", "estimate_range")}, ensure_ascii=False)[:600])
    tags = Counter(t for v in unique.values() for t in (v.get("tags") or []))
    print("  tags:", dict(tags.most_common(25)))
    print("  product lines:", dict(Counter(v.get("product_line") for v in unique.values())))
    in_city = [v for v in unique.values() if CITY in (v.get("address") or "") or "Be'er Sheva" in (v.get("address") or "")]
    print(f"  with the city in the address: {len(in_city)}")
    for v in list(unique.values())[:12]:
        print(f"    {v.get('name')} | {v.get('address')} | {','.join(v.get('tags') or [])}")


def isracard() -> None:
    section('Isracard "חבר" club page: where the loadable cards work')
    url = "https://marketing.isracard.co.il/clubs/chever/"
    status, html = get(url)
    print(f"{url} -> HTTP {status}")
    if status != 200:
        print("  ", text_of(html)[:300])
        return
    page_shape(html)
    text = text_of(html)
    for word in ("מסעדות", "נטען", "טעמים", "רשימת"):
        print(f"  around {word}:", *around(text, word, 120, 3), sep="\n    ")
    pdfs = sorted(set(re.findall(r'href="([^"]+\.pdf)"', html)))
    print("  PDFs linked:", *pdfs[:10], sep="\n    ")


def hever_store() -> None:
    section('Hever: the "חבר טעמים" store locator (hvr.co.il/site/pg/teamim_card_store)')
    url = "https://www.hvr.co.il/site/pg/teamim_card_store"
    status, html = get(url)
    print(f"{url} -> HTTP {status}")
    if status != 200:
        print("  ", text_of(html)[:300])
        return
    page_shape(html)
    text = text_of(html)
    print("  needs a login?", any(w in text for w in ("התחברות", "כניסה למערכת", "סיסמה", "קוד אימות")))
    print("  Be'er Sheva mentions:", *around(text, CITY), sep="\n    ")
    for form in re.findall(r"<form[^>]*>.*?</form>", html, re.S | re.I)[:4]:
        head = re.search(r"<form[^>]*>", form).group(0)
        inputs = re.findall(r'<(?:input|select)[^>]*name="([^"]+)"', form)
        print(f"  form {head[:160]} inputs={inputs[:15]}")
    selects = re.findall(r"<select[^>]*>(.*?)</select>", html, re.S | re.I)
    for sel in selects[:3]:
        options = re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)<', sel)
        city = [o for o in options if CITY in o[1]]
        print(f"  select with {len(options)} options; first {options[:4]}; Be'er Sheva: {city}")
    endpoints = sorted(set(re.findall(r'["\'](/[^"\'\s]*(?:ajax|Ajax|ashx|asmx|api|Api|json|Json|store|Store|search|Search)[^"\'\s]*)["\']', html)))
    print("  endpoint-looking paths:", *endpoints[:20], sep="\n    ")
    scripts = [s for s in re.findall(r'<script[^>]+src="([^"]+)"', html) if "hvr" in s or s.startswith("/")]
    print("  own scripts:", *scripts[:15], sep="\n    ")
    for src in scripts[:15]:
        full = src if src.startswith("http") else f"https://www.hvr.co.il{src}"
        st, js = get(full)
        hits = sorted(set(re.findall(r'["\'](/[^"\'\s]{3,120})["\']', js)))
        hits = [h for h in hits if re.search(r"(?i)teamim|store|ajax|ashx|asmx|api|city|branch|search", h)]
        if hits:
            print(f"  {src} (HTTP {st}):", *hits[:15], sep="\n      ")
    inline = " ".join(re.findall(r"<script(?![^>]+src)[^>]*>(.*?)</script>", html, re.S | re.I))
    for word in ("teamim", "ajax", "$.post", "$.get", "fetch(", "XMLHttpRequest", "city", "store"):
        for ctx in around(inline, word, 120, 2):
            print(f"  inline {word}: {ctx}")
    print("  text sample:", text[:1500])


def keys_of(value, depth=0, limit=3) -> str:
    """A JSON value's shape, a few levels deep."""
    if isinstance(value, dict) and depth < limit:
        return "{" + ", ".join(f"{k}: {keys_of(v, depth + 1, limit)}" for k, v in list(value.items())[:25]) + "}"
    if isinstance(value, list):
        return f"[{len(value)} x {keys_of(value[0], depth + 1, limit) if value else ''}]"
    return type(value).__name__


def next_data(html: str) -> dict:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    return json.loads(m.group(1)) if m else {}


def club_hub_deals() -> None:
    """Every "חבר טעמים" deal page, and which ones have a Be'er Sheva branch."""
    section('Club Hub, round 2: the deals behind "חבר טעמים", and their branches')
    status, html = get("https://www.clubhub.co.il/clubs/hvr-blue-card")
    props = next_data(html).get("props", {}).get("pageProps", {})
    deals = props.get("deals") or []
    print(f"  pageProps.deals: {len(deals)}; shape: {keys_of(deals, limit=2)[:1500]}")
    links = list(dict.fromkeys(re.findall(r'href="(/deal/[0-9a-f]{24}[^"]*)"', html)))
    print(f"  deal links: {len(links)}")
    found, shapes = [], 0
    for i, link in enumerate(links):
        url = "https://www.clubhub.co.il" + urllib.parse.quote(urllib.parse.unquote(link))
        st, page = get(url)
        if st != 200:
            print(f"   {urllib.parse.unquote(link)} -> HTTP {st}")
            continue
        data = next_data(page).get("props", {}).get("pageProps", {})
        if shapes < 1:
            print(f"  a deal page's pageProps: {keys_of(data)[:2500]}")
            shapes += 1
        blob = json.dumps(data, ensure_ascii=False)
        if CITY in blob or CITY in page:
            found.append(urllib.parse.unquote(link).split("/")[-1])
            ctx = around(blob, CITY, 160, 2) or around(text_of(page), CITY, 160, 2)
            print(f"  BE'ER SHEVA in {urllib.parse.unquote(link)}:", *ctx, sep="\n      ")
        time.sleep(0.3)
    print(f"  deals with a Be'er Sheva branch: {len(found)} of {len(links)}:", ", ".join(found))


def dapei_zahav_cards() -> None:
    """How one business looks in the list and on its own page; the bars category."""
    section("Dapei Zahav, round 2: a business card, a business page, the bars category")
    st, html = get("https://www.d.co.il/h-c30420-e0-p0-l0-city9000/")
    first = re.search(r'/h-c30420-e0-p0-l0-city9000-t\d+\.nb1/', html)
    if first:
        start = max(0, first.start() - 2500)
        snippet = re.sub(r"\s+", " ", html[start: first.end() + 2500])
        print("  raw HTML around the first business link:\n   ", snippet[:5000])
    for label in ("פאבים ובארים", "בתי קפה"):
        m = re.search(r'href="([^"]+)"[^>]*>(?:(?!</a>).)*?' + re.escape(label), html, re.S)
        print(f"  {label} link:", m.group(1) if m else "not found")
    pages = sorted(set(re.findall(r'href="(/[^"]*?\d{6,}[^"]*)"', html)) - set(re.findall(r'href="(/h-c30420[^"]*)"', html)))
    print("  other numeric links (business pages?):", *pages[:10], sep="\n    ")
    if pages:
        st, page = get("https://www.d.co.il" + pages[0])
        print(f"  {pages[0]} -> HTTP {st}")
        page_shape(page)
        t = text_of(page)
        print("  hours on the page:", re.findall(r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}", t)[:10])
        for d in json_ld(page)[:3]:
            print("  JSON-LD:", json.dumps(d, ensure_ascii=False)[:700])
        print("  text sample:", t[:1200])


def visit_br7() -> None:
    """The city's tourism site: its night-life page and what each place's page holds."""
    section("visitbr7.co.il: night life in Be'er Sheva")
    url = "https://visitbr7.co.il/night_life/"
    status, html = get(url)
    print(f"{url} -> HTTP {status}")
    if status != 200:
        print("  ", text_of(html)[:300])
        return
    page_shape(html)
    print("  WordPress?", "wp-content" in html, "| REST link:", re.findall(r'<link[^>]+rel="https://api.w.org/"[^>]+href="([^"]+)"', html)[:1])
    links = list(dict.fromkeys(re.findall(r'href="(https://visitbr7\.co\.il/[^"#?]+/)"', html)))
    print(f"  links on the page: {len(links)}")
    for link in links[:80]:
        print("   ", urllib.parse.unquote(link))
    text = text_of(html)
    print("  text sample:", text[:2500])
    # The WordPress REST API, if open: post types and a sample.
    st, body = get("https://visitbr7.co.il/wp-json/wp/v2/types")
    print(f"  /wp-json/wp/v2/types -> HTTP {st}")
    if st == 200:
        try:
            types = json.loads(body)
            print("  post types:", {k: v.get("rest_base") for k, v in types.items()})
        except ValueError:
            print("  not JSON:", body[:200])
    # One place page: address, hours, phone, coordinates?
    places = [l for l in links if l != url and "wp-json" not in l and l.count("/") >= 5]
    places.sort(key=lambda l: "/night_life/" not in l)
    for link in places[:2]:
        st, page = get(link)
        print(f"  {urllib.parse.unquote(link)} -> HTTP {st}")
        if st != 200:
            continue
        page_shape(page)
        t = text_of(page)
        print("  hours:", re.findall(r"\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}", t)[:6],
              "| phones:", re.findall(r"0\d{1,2}-?\d{7}", t)[:3],
              "| coordinates:", re.findall(r"3[01]\.\d{4,}\s*,\s*3[45]\.\d{4,}", page)[:2])
        for d in json_ld(page)[:2]:
            print("  JSON-LD:", json.dumps(d, ensure_ascii=False)[:600])
        print("  text sample:", t[:1500])


for probe in (visit_br7,):
    try:
        probe()
    except Exception as e:  # noqa: BLE001 - report and go on to the next source
        print(f"  {probe.__name__} failed: {type(e).__name__}: {e}", file=sys.stderr)
