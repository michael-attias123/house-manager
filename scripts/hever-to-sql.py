"""The "חבר טעמים" list for Be'er Sheva, as rows for a migration.

Hever's store locator (hvr.co.il/site/pg/teamim_card_store) is behind a login
and turns GitHub's network away, so it is exported by hand: in the browser,
logged in, the JSON its search returns ({"branch": [...]}). This prints the
VALUES rows that supabase/migrations/20261103000100_hever_teamim.sql loads;
paste them there (or into a new migration) to refresh. The export itself is
not kept in the repository.

Usage: python scripts/hever-to-sql.py export.json > rows.sql
       python scripts/hever-to-sql.py --test
"""

import json
import re
import sys

CITY = "באר שבע"
# web/src/features/going-out/lib/geo.ts BEER_SHEVA.bbox
SOUTH, WEST, NORTH, EAST = 31.2, 34.73, 31.3, 34.86
DAYS = {"א-ה": "Su-Th", "שישי": "Fr", "שבת": "Sa"}
LETTERS = {"א": "Su", "ב": "Mo", "ג": "Tu", "ד": "We", "ה": "Th", "ו": "Fr", "ש": "Sa"}
# "10:00-23:00", "א'-ד' 10:00-23:00", "יום ב' 09:00-22:30", "ה׳ 10:00-00:00".
TIMED = re.compile(
    r"(?:(?:יום\s*)?([א-ו])['׳]?(?:\s*-\s*([א-ו])['׳]?)?\s+)?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})"
)


def wanted(b: dict) -> bool:
    """A place to sit in Be'er Sheva, with a location inside the city."""
    try:
        lat, lng = float(b["latitude"]), float(b["longitude"])
    except (KeyError, ValueError):
        return False
    return (
        b.get("city", "").strip() == CITY
        and "ישיבה" in b.get("delivery", "")
        and SOUTH <= lat <= NORTH
        and WEST <= lng <= EAST
    )


def kind(category: str) -> str:
    if "בר-פאב" in category:
        return "bar"
    return "restaurant" if category.startswith("מסעדה") else "cafe"


def day_rules(days: str, value: str) -> tuple[list[str], str | None]:
    """One line of Hever's hours → OSM rules for those days, and a condition.

    Times, with or without days of their own ("א'-ד' 10:00-23:00 ה'
    10:00-00:00", "09:00-22:00 יום ב' 09:00-22:30"), become rules; text left
    over without digits ("כולל ארוחות עסקיות") is a condition for the deal's
    note. Anything else with digits ("08:00-שעתיים לכניסת שבת", "מוצ"ש -
    23:00") is kept as a comment, which lib/hours.ts reads as unknown and shows.
    No times at all is `unknown`: in OSM a day left out would mean closed.
    """
    value = re.sub(r"\s+", " ", value).strip()
    matches = list(TIMED.finditer(value))
    rest = TIMED.sub(" ", value).strip(" ,;.-")
    if matches and not re.search(r"\d", rest):
        rules = []
        for m in matches:
            first, last, h1, m1, h2, m2 = m.groups()
            on = LETTERS[first] + (f"-{LETTERS[last]}" if last else "") if first else days
            rules.append(f"{on} {int(h1):02d}:{m1}-{int(h2):02d}:{m2}")
        return rules, rest or None
    if re.search(r"\d", value):
        return [f'{days} "{value.replace(chr(34), "״").replace(chr(39), "׳")[:80]}"'], None
    return [f"{days} unknown"], value or None


def parse_hours(text: str) -> tuple[str | None, list[str]]:
    """Hever's "א-ה: …\\nשישי: …\\nשבת: …" → OSM opening_hours, and the conditions found."""
    rules, found, known = [], [], False
    for line in text.split("\n"):
        label, _, value = line.partition(":")
        days = DAYS.get(label.strip())
        if not days:
            continue
        day, condition = day_rules(days, value)
        rules += day
        known = known or not day[0].endswith(" unknown")
        if condition and condition not in found:
            found.append(condition)
    return ("; ".join(rules) if known else None), found


def opening_hours(text: str) -> str | None:
    return parse_hours(text)[0]


def cuisine(b: dict) -> str | None:
    parts = [t.strip() for t in b.get("type", "").split(",") if t.strip()]
    if b.get("kosher", "").strip():
        parts.append(b["kosher"].strip())
    return "; ".join(parts) or None


def website(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    return value if re.match(r"https?://", value) else f"https://{value}"


def conditions(hours: str) -> list[str]:
    """Conditions written among the hours: "כולל ארוחות עסקיות, לא כולל כפל חברי מועדון"."""
    return parse_hours(hours)[1]


def note(limitations: str, hours: str = "") -> str | None:
    text = re.sub(r"\s*<br\s*/?>\s*", " · ", limitations).strip(" ·")
    text = text.replace("Take?away", "Take away")
    return " · ".join([t for t in [text, *conditions(hours)] if t])[:200] or None


def row(b: dict) -> tuple:
    return (
        b["name"].strip(),
        kind(b.get("category", "")),
        round(float(b["latitude"]), 6),
        round(float(b["longitude"]), 6),
        b.get("address", "").strip() or None,
        b.get("phone", "").strip() or None,
        website(b.get("website", "")),
        opening_hours(b.get("hours", "")),
        cuisine(b),
        note(b.get("limitations", ""), b.get("hours", "")),
    )


def sql(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, float):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def main(path: str) -> None:
    branches = json.load(open(path, encoding="utf-8"))["branch"]
    rows = [row(b) for b in branches if wanted(b)]
    print(f"-- {len(rows)} places, from {len(branches)} branches", file=sys.stderr)
    print(",\n".join("  (" + ", ".join(sql(v) for v in r) + ")" for r in rows))


def test() -> None:
    assert opening_hours("א-ה: 12:00-23:00\nשישי: 12:00-שעתיים לפני כניסת שבת\nשבת: מצאת השבת - 23:30") == (
        'Su-Th 12:00-23:00; Fr "12:00-שעתיים לפני כניסת שבת"; Sa "מצאת השבת - 23:30"'
    )
    assert opening_hours('א-ה: 9:00-21:30\nשישי: \nשבת: מוצ"ש -23:00') == (
        'Su-Th 09:00-21:30; Fr unknown; Sa "מוצ״ש -23:00"'
    )
    assert opening_hours("א-ה:  \nשישי:  \nשבת: ") is None
    # A condition where the hours should be: unknown that day, the text to the note.
    odd = "א-ה: כולל ארוחות עסקיות, לא כולל כפל חברי מועדון\nשישי: 19:00-00:30\nשבת: "
    assert opening_hours(odd) == "Su-Th unknown; Fr 19:00-00:30; Sa unknown"
    assert note("", odd) == "כולל ארוחות עסקיות, לא כולל כפל חברי מועדון"
    # Days of their own inside a group, and a condition after the times.
    assert opening_hours("א-ה: א'-ד' 10:00-23:00 ה' 10:00-00:00\nשישי: \nשבת: ") == (
        "Su-We 10:00-23:00; Th 10:00-00:00; Fr unknown; Sa unknown"
    )
    assert opening_hours("א-ה: 09:00-22:00 יום ב' 09:00-22:30\nשישי: 08:00-15:00\nשבת: 19:00-00:00") == (
        "Su-Th 09:00-22:00; Mo 09:00-22:30; Fr 08:00-15:00; Sa 19:00-00:00"
    )
    with_note = "א-ה: א'-ד' 12:00-00:00 ה' 12:00-00:30 כולל עסקיות\nשישי: 12:00-00:30\nשבת: 12:00-00:30"
    assert opening_hours(with_note) == "Su-We 12:00-00:00; Th 12:00-00:30; Fr 12:00-00:30; Sa 12:00-00:30"
    assert note("", with_note) == "כולל עסקיות"
    assert kind("מסעדה,בר-פאב") == "bar" and kind("מסעדה,בית קפה") == "restaurant"
    assert kind("גלידריה מתוקים וקינוחים,בית קפה") == "cafe"
    assert note("בישיבה בלבד<br/>לא כולל Take?away<br/>") == "בישיבה בלבד · לא כולל Take away"
    assert website("angelina.rest.co.il") == "https://angelina.rest.co.il"
    assert cuisine({"type": "בשרים,ים תיכוני", "kosher": "כשר"}) == "בשרים; ים תיכוני; כשר"
    base = {"city": CITY, "delivery": "ישיבה במסעדה", "latitude": "31.25", "longitude": "34.79"}
    assert wanted(base)
    assert not wanted({**base, "delivery": "איסוף עצמי"})
    assert not wanted({**base, "latitude": "32.089"})  # a Tel Aviv address listed under Be'er Sheva
    assert sql("ג'סיקה") == "'ג''סיקה'"
    print("ok")


if __name__ == "__main__":
    test() if sys.argv[1:] == ["--test"] else main(sys.argv[1])
