"""One-off: the bars on visitbr7.co.il/night_life, with their address, phone
and a geocoded location, printed as JSON between BEGIN/END markers. Run by
.github/workflows/visitbr7-dump.yml (the site is not reachable from every
machine). Read-only; removed once the import is written.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from html import unescape

UA = "house-manager/1 (a private household app; one-off import)"


def get(url: str) -> tuple[int, str, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, "", {}


def text_of(html: str) -> str:
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()


posts, page = [], 1
while True:
    status, body, headers = get(
        f"https://visitbr7.co.il/wp-json/wp/v2/night_life?per_page=100&page={page}"
        "&_fields=id,slug,link,title,content,excerpt,acf,meta,modified"
    )
    print(f"REST page {page}: HTTP {status}")
    if status != 200:
        break
    posts += json.loads(body)
    if page >= int(headers.get("X-WP-TotalPages") or headers.get("x-wp-totalpages") or 1):
        break
    page += 1
print(f"posts: {len(posts)}")

out = []
for p in posts:
    title = unescape(p["title"]["rendered"]).strip()
    status, html, _ = get(p["link"])
    page_text = text_of(html) if status == 200 else ""
    # The place's own block: from its title in the breadcrumb to "לפרטים".
    m = re.search(re.escape(title) + r"\s+" + re.escape(title) + r"\s+(.*?)\s+לפרטים", page_text)
    block = m.group(1) if m else ""
    address = re.search(r"כתובת:\s*(.+?)(?:\s+טלפון:|$)", block)
    phone = re.search(r"טלפון:\s*([\d\-\s]{9,14}\d)", block)
    maps = re.findall(r"(3[01]\.\d{4,})\s*,\s*(3[45]\.\d{4,})", html)
    item = {
        "id": p["id"],
        "slug": urllib.parse.unquote(p["slug"]),
        "link": urllib.parse.unquote(p["link"]),
        "title": title,
        "description": text_of(p.get("content", {}).get("rendered", ""))[:600],
        "block": block[:700],
        "address": address.group(1).strip() if address else None,
        "phone": re.sub(r"\s", "", phone.group(1)) if phone else None,
        "page_coordinates": maps[:2],
        "acf": p.get("acf") or None,
        "modified": p.get("modified"),
    }
    query = f"{item['address'] or title}, באר שבע"
    status, geo, _ = get(
        "https://nominatim.openstreetmap.org/search?"
        + urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "il"})
    )
    hit = (json.loads(geo) or [None])[0] if status == 200 and geo else None
    item["geocode"] = (
        {"query": query, "lat": float(hit["lat"]), "lng": float(hit["lon"]), "name": hit.get("display_name"),
         "type": hit.get("type")} if hit else {"query": query, "status": status}
    )
    out.append(item)
    time.sleep(1.2)  # Nominatim's limit is one request a second.

print("BEGIN")
print(json.dumps(out, ensure_ascii=False))
print("END")
