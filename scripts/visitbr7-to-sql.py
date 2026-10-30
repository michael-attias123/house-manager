"""The bars on the city's tourism site (visitbr7.co.il/night_life), as rows for a migration.

The site turns some networks away, so its list was read once, from GitHub
Actions, into a JSON array: per place the WordPress post (title, slug, link,
description), its page text (block), the site's own fields (acf: address,
phone, website, more links) and a Nominatim geocode of "address (or title),
באר שבע". This prints the VALUES rows that
supabase/migrations/20261104000100_visitbr7_bars.sql loads; paste them there
(or into a new migration) to refresh. The export itself is not kept in the
repository.

Usage: python scripts/visitbr7-to-sql.py export.json > rows.sql
       python scripts/visitbr7-to-sql.py --test
"""

import json
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# web/src/features/going-out/lib/geo.ts BEER_SHEVA.bbox
SOUTH, WEST, NORTH, EAST = 31.2, 34.73, 31.3, 34.86
# A bar tour, not a place.
SKIP = {"סיור ברים בעיר העתיקה"}
# Nominatim found the place itself, or only its street (or a stop near it).
EXACT = {"bar", "pub", "nightclub", "restaurant", "cafe", "biergarten"}
STREET = {"residential", "tertiary", "secondary", "primary", "bus_stop"}
# Share and tracking parameters; others (facebook.com/profile.php?id=…) are the address.
TRACKING = re.compile(r"^(?:utm_.*|igsh|igshid|mibextid|fbclid|si|ref)$")
URL = re.compile(r"https?://\S+")
INSTAGRAM = re.compile(r"^https?://(?:www\.|m\.)?instagram\.com/([A-Za-z0-9._]+)/?$", re.I)
TIME = r"(\d{1,2}:\d{2})"
DASH = r"\s*[–—-]\s*"
HE_DAYS = {"ראשון": "Su", "שני": "Mo", "שלישי": "Tu", "רביעי": "We", "חמישי": "Th", "שישי": "Fr", "שבת": "Sa"}
DAY_WORD = "|".join(HE_DAYS)


def clean_text(value: str | None) -> str:
    """Curly quotes as plain ones, spaces collapsed."""
    value = (value or "").translate({0x2019: "'", 0x2018: "'", 0x201C: '"', 0x201D: '"'})
    return re.sub(r"\s+", " ", value).strip()


def name(title: str) -> str:
    """"בומבינו בר – bombino bar & coffee" → "בומבינו בר": the Latin repeat goes."""
    title = clean_text(title)
    return re.sub(r"\s+[–—-]\s+[^א-ת]*$", "", title).strip()


def kind(p: dict) -> str:
    """Dance and live-music clubs, pubs and beer places, and bars (with a kitchen or not)."""
    title, text = clean_text(p["title"]), clean_text(p.get("description"))
    if "מועדון" in title or "מועדון ההופעות" in text:
        return "nightclub"
    if re.search(r"פאב|בירה", title) or "בר ספורט" in text:
        return "pub"
    return "bar"


def tidy_address(value: str) -> str | None:
    value = clean_text(value)
    value = re.sub(r",?\s*באר[\s-]?שבע$", "", value).strip(" ,")
    # "אנילביץ17" → "אנילביץ 17"
    value = re.sub(r"([א-ת])(\d)", r"\1 \2", value)
    return value or None


def address(p: dict) -> str | None:
    """The site's field, else "<street> <number> באר שבע" in the text."""
    own = tidy_address((p.get("acf") or {}).get("address") or "")
    if own:
        return own
    m = re.search(r"((?:[א-ת\"'״׳]+ )*[א-ת\"'״׳]+) (\d+),? (?:ב)?באר שבע", clean_text(p.get("description")))
    return tidy_address(f"{m.group(1)} {m.group(2)}") if m else None


def phone(p: dict) -> str | None:
    """A phone number, not "יצירת קשר דרך האינסטגרם"."""
    value = clean_text((p.get("acf") or {}).get("phone") or p.get("phone") or "")
    if re.fullmatch(r"[\d\s()+*-]+", value) and len(re.sub(r"\D", "", value)) >= 9:
        return value
    return None


def clean_url(url: str) -> str:
    """protect.checkpoint.com/v2/___<url>___… → <url>, without share and tracking parameters."""
    m = re.match(r"https?://protect\.checkpoint\.com/v2/___(.+?)___", url)
    if m:
        url = m.group(1)
    parts = urlsplit(url.rstrip(".,"))
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)]
    return urlunsplit(parts._replace(query=urlencode(query), fragment=""))


def links(p: dict) -> list[str]:
    """Every link the site gives, its own website field first, in order."""
    acf = p.get("acf") or {}
    fields = [acf.get("website") or "", acf.get("attraction_event_choose_link") or ""]
    fields += [s.get("social_link") or "" for s in acf.get("socials_rep") or []]
    return [clean_url(u) for f in fields for u in URL.findall(f)]


def instagram(p: dict) -> str | None:
    """The handle, as venues.instagram keeps it (ingest/house_ingest/venues.py)."""
    for url in links(p):
        m = INSTAGRAM.match(url.split("?")[0])
        if m:
            return m.group(1)
    return None


def website(p: dict) -> str | None:
    """The site or Facebook page: the first link that is not Instagram."""
    return next((u for u in links(p) if "instagram.com" not in u.lower()), None)


def hhmm(t: str) -> str:
    h, m = t.split(":")
    return f"{int(h):02d}:{m}"


def opening_hours(text: str) -> str | None:
    """The hours a description states, in the OSM syntax lib/hours.ts reads; None when it states none.

    "כל יום בין השעות 10:00 – 02:00" → "Mo-Su 10:00-02:00". "פתוח כל יום
    מהשעה 20:00" has no closing time and lib/hours.ts reads no open end
    ("20:00+"), so it is a comment: unknown, never closed. Day ranges
    ("ראשון עד חמישי – 17:00 עד 02:00 שישי – … מוצש – …") become one rule each;
    the Saturday-night one ("מוצ״ש") says so in a comment, since it starts
    only once Shabbat is out.
    """
    text = clean_text(text)
    m = re.search(rf"כל יום (?:בין השעות)?\D*{TIME}{DASH}{TIME}", text)
    if m:
        return f"Mo-Su {hhmm(m[1])}-{hhmm(m[2])}"
    m = re.search(rf"כל יום (?:החל )?מהשעה {TIME}", text)
    if m:
        return f'Mo-Su "מהשעה {hhmm(m[1])}"'
    rules = []
    day = rf"(?:({DAY_WORD})(?: עד ({DAY_WORD}))?|(מוצ[\"״]?ש))"
    for m in re.finditer(rf"{day}{DASH}{TIME}(?: עד |{DASH}){TIME}", text):
        first, last, saturday_night, start, end = m.groups()
        if saturday_night:
            rules.append(f'Sa {hhmm(start)}-{hhmm(end)} "במוצאי שבת"')
        else:
            on = HE_DAYS[first] + (f"-{HE_DAYS[last]}" if last else "")
            rules.append(f"{on} {hhmm(start)}-{hhmm(end)}")
    return "; ".join(rules) or None


def cuisine(text: str) -> str | None:
    return "כשר" if re.search(r"(?<![א-ת])כשר(?![א-ת])", clean_text(text)) else None


def location(p: dict) -> tuple[float | None, float | None, str]:
    """The geocode when it is the place or its street, inside the city; else none."""
    g = p.get("geocode") or {}
    if "lat" not in g or g.get("type") not in EXACT | STREET:
        return None, None, "none"
    lat, lng = float(g["lat"]), float(g["lng"])
    if not (SOUTH <= lat <= NORTH and WEST <= lng <= EAST):
        return None, None, "none"
    return round(lat, 6), round(lng, 6), "exact" if g["type"] in EXACT else "street"


def wanted(p: dict) -> bool:
    return name(p["title"]) not in SKIP


def row(p: dict) -> tuple:
    text = p.get("description") or ""
    lat, lng, _ = location(p)
    return (
        name(p["title"]),
        kind(p),
        lat,
        lng,
        address(p),
        phone(p),
        website(p),
        instagram(p),
        opening_hours(text),
        cuisine(text),
    )


def sql(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, float):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def main(path: str) -> None:
    posts = json.load(open(path, encoding="utf-8"))
    places = [p for p in posts if wanted(p)]
    print(f"-- {len(places)} places, from {len(posts)} posts", file=sys.stderr)
    for p in places:
        print(f"--   {name(p['title'])}: location {location(p)[2]}", file=sys.stderr)
    print(",\n".join("  (" + ", ".join(sql(v) for v in row(p)) + ")" for p in places))


def test() -> None:
    assert name("בומבינו בר – bombino bar & coffee") == "בומבינו בר"
    assert name("מנצ’ילה") == "מנצ'ילה" and name("החלוץ 33") == "החלוץ 33"
    assert not wanted({"title": "סיור ברים בעיר העתיקה"})
    assert kind({"title": "מועדון הפורום"}) == "nightclub"
    assert kind({"title": "החלוץ 33", "description": "החלוץ 33, מועדון ההופעות של עמותת איילים"}) == "nightclub"
    assert kind({"title": "טרנטולה פאב"}) == kind({"title": "בית בירה"}) == "pub"
    assert kind({"title": "ששון בר", "description": "בר ספורט שמשדר משחקי כדורגל"}) == "pub"
    assert kind({"title": "גלריית סול", "description": "בית קפה ... ובערב המקום הופך לבר, בירות מהחבית"}) == "bar"
    bombino = "בית קפה ביום ובר קוקטיילים בלילה! כל יום בין השעות ☀️10:00 – 02:00🌙 קקל 59 באר שבע המקום כשר 0525398499"
    assert address({"acf": {"address": ""}, "description": bombino}) == "קקל 59"
    assert address({"acf": {"address": 'קק"ל 101'}}) == 'קק"ל 101'
    assert address({"acf": {"address": "ישפרו פלנט "}}) == "ישפרו פלנט"
    assert address({"acf": {"address": "שלמה המלך 2, באר שבע"}}) == "שלמה המלך 2"
    assert address({"acf": {"address": "אנילביץ17"}}) == "אנילביץ 17"
    assert address({"acf": {"address": ""}, "description": "בר שכונתי עם מטבח בשרי כשר"}) is None
    assert phone({"acf": {"phone": "054-932-5943"}}) == "054-932-5943"
    assert phone({"acf": {"phone": "יצירת קשר דרך האינסטגרם"}}) is None
    assert phone({"acf": {"phone": ""}, "phone": None}) is None
    assert clean_url("https://www.facebook.com/profile.php?id=61559161834469") == (
        "https://www.facebook.com/profile.php?id=61559161834469"
    )
    assert clean_url("https://www.facebook.com/profile.php?id=61551347680540&mibextid=LQQJ4d") == (
        "https://www.facebook.com/profile.php?id=61551347680540"
    )
    checkpoint = (
        "https://protect.checkpoint.com/v2/___https://www.facebook.com/solstudioart2021?mibextid=ZbWKwL___"
        ".YzJlOmJlZXJzaGV2YTpjOm86YjIxM2QxOWExMWE3YTZiZWYz"
    )
    assert website({"acf": {"website": checkpoint}}) == "https://www.facebook.com/solstudioart2021"
    two = "https://www.facebook.com/ashanhazman?mibextid=ZbWKwL , https://www.instagram.com/ashanhazman?igsh=MXJt=="
    assert website({"acf": {"website": two}}) == "https://www.facebook.com/ashanhazman"
    assert instagram({"acf": {"website": two}}) == "ashanhazman"
    ig = "https://www.instagram.com/ringelblum.13?igsh=MWR2cWZoeDR6eXFmMA%3D%3D&utm_source=qr"
    assert instagram({"acf": {"website": ig}}) == "ringelblum.13" and website({"acf": {"website": ig}}) is None
    assert instagram({"acf": {"website": "https://www.instagram.com/sassonbar/"}}) == "sassonbar"
    victoria = {
        "acf": {
            "website": "     ",
            "attraction_event_choose_link": "https://victoria-br7.co.il/  https://www.instagram.com/victoria.br7?igsh=b",
            "socials_rep": [{"social_type": "insta", "social_link": "https://www.instagram.com/victoria.br7?igsh=b"}],
        }
    }
    assert website(victoria) == "https://victoria-br7.co.il/" and instagram(victoria) == "victoria.br7"
    assert opening_hours(bombino) == "Mo-Su 10:00-02:00"
    assert opening_hours("בר חברים. פתוח כל יום מהשעה 20:00") == 'Mo-Su "מהשעה 20:00"'
    perla = "בר שכונתי קטן. שעות פתיחה ראשון עד חמישי – 17:00 עד 02:00 שישי – 21:30 עד 02:00 מוצש – 19:00 עד 02:00"
    assert opening_hours(perla) == 'Su-Th 17:00-02:00; Fr 21:30-02:00; Sa 19:00-02:00 "במוצאי שבת"'
    assert opening_hours("בר שכונתי עם מטבח בשרי כשר") is None
    assert cuisine("כשר בהשגחת הרבנות") == cuisine("מטבח בשרי כשר") == "כשר"
    assert cuisine("בר מסעדה סטודנטאלי , תפריט בשרי") is None and cuisine("הכשרה") is None
    exact = {"geocode": {"lat": 31.2554228, "lng": 34.7953067, "type": "bar"}}
    assert location(exact) == (31.255423, 34.795307, "exact")
    assert location({"geocode": {"lat": 31.2375551, "lng": 34.7923359, "type": "tertiary"}})[2] == "street"
    assert location({"geocode": {"query": "x", "status": 200}}) == (None, None, "none")
    assert location({"geocode": {"lat": 32.08, "lng": 34.78, "type": "bar"}}) == (None, None, "none")
    assert location({"geocode": {"lat": 31.24, "lng": 34.78, "type": "administrative"}}) == (None, None, "none")
    assert sql("מנצ'ילה") == "'מנצ''ילה'" and sql(None) == "null"
    print("ok")


if __name__ == "__main__":
    test() if sys.argv[1:] == ["--test"] else main(sys.argv[1])
