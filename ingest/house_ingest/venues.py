"""Loads places to go out in Be'er Sheva from OpenStreetMap into public.venues.

CLI: python -m house_ingest.venues [--dry-run] [--from-file overpass.json]

Run weekly by .github/workflows/venues.yml. Asks Overpass for bars, pubs,
restaurants and cafés inside the city's administrative boundary, upserts them
by osm_ref in one transaction, and hides OSM places that are no longer in the
answer (their deals stay linked). An answer with fewer than half of the places
already loaded is taken as partial and changes nothing. A place an admin edited
(admin_edited_at) keeps the admin's values; one an admin hid (hidden_by_admin)
stays hidden.

Needs only psycopg (not the price scraper or lxml).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import astuple, dataclass, fields
from pathlib import Path

log = logging.getLogger("house_ingest.venues")

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
USER_AGENT = "house-manager-venues/1"

# OSM amenity → venues.kind.
KINDS = {
    "bar": "bar",
    "pub": "pub",
    "biergarten": "pub",
    "nightclub": "nightclub",
    "restaurant": "restaurant",
    "fast_food": "restaurant",
    "cafe": "cafe",
    "ice_cream": "cafe",
}

# The city by its administrative boundary, under any of its names (as
# scripts/venues-probe.py found it).
QUERY = f"""
[out:json][timeout:90];
(
  area["boundary"="administrative"]["name"="באר שבע"];
  area["boundary"="administrative"]["name:en"="Beersheba"];
  area["boundary"="administrative"]["name:en"="Be'er Sheva"];
)->.a;
nwr["amenity"~"^({'|'.join(KINDS)})$"](area.a);
out center tags;
"""

# Below this share of the OSM places already loaded, an answer is partial.
MIN_SHARE = 0.5


@dataclass(frozen=True)
class Venue:
    osm_ref: str
    name: str
    kind: str
    lat: float | None
    lng: float | None
    address: str | None
    opening_hours: str | None
    website: str | None
    phone: str | None
    instagram: str | None
    cuisine: str | None


COLUMNS = [f.name for f in fields(Venue)]


def _tag(tags: dict, *keys: str) -> str | None:
    for key in keys:
        value = (tags.get(key) or "").strip()
        if value:
            return value
    return None


_INSTAGRAM_PROFILE = re.compile(r"^(?:https?://)?(?:www\.|m\.)?instagram\.com/([A-Za-z0-9._]+)/?(?:[?#].*)?$", re.I)
_INSTAGRAM_HANDLE = re.compile(r"^@?([A-Za-z0-9._]{1,30})$")
# instagram.com/<these>/... is a post, a reel and so on, not a profile.
_INSTAGRAM_PATHS = {"p", "reel", "reels", "tv", "stories", "explore"}


def normalize_instagram(value: str | None) -> str | None:
    """A profile ('@name', 'name', or its URL) → 'name'; another URL is kept as a URL; anything else → None."""
    value = (value or "").strip()
    if not value:
        return None
    m = _INSTAGRAM_PROFILE.match(value) or _INSTAGRAM_HANDLE.match(value)
    if m and m.group(1).lower() not in _INSTAGRAM_PATHS:
        return m.group(1)
    if re.match(r"^https?://", value, re.I):
        return value
    if "instagram.com/" in value.lower():
        return "https://" + value
    return None


def normalize_website(value: str | None) -> str | None:
    """'www.example.com' → 'https://www.example.com', so the app can link it."""
    if not value:
        return None
    return value if re.match(r"^https?://", value, re.I) else "https://" + value


def parse_venue(element: dict) -> Venue | None:
    """One Overpass element → a Venue, or None for a place without a name."""
    tags = element.get("tags") or {}
    name = _tag(tags, "name:he", "name")
    if not name:
        return None
    # Ways and relations come with their center (out center).
    point = element if element.get("type") == "node" else element.get("center") or {}
    lat, lng = point.get("lat"), point.get("lon")
    if lat is None or lng is None:
        lat = lng = None
    street = _tag(tags, "addr:street")
    # Several numbers are separated by ";": the first one is the one to call.
    phone = (_tag(tags, "phone", "contact:phone", "contact:mobile") or "").split(";")[0].strip()
    return Venue(
        osm_ref=f"{element['type']}/{element['id']}",
        name=name,
        kind=KINDS.get(tags.get("amenity", ""), "other"),
        lat=float(lat) if lat is not None else None,
        lng=float(lng) if lng is not None else None,
        address=" ".join(p for p in (street, _tag(tags, "addr:housenumber")) if p) if street else None,
        opening_hours=_tag(tags, "opening_hours"),
        website=normalize_website(_tag(tags, "website", "contact:website", "url")),
        phone=phone or None,
        instagram=normalize_instagram(_tag(tags, "contact:instagram", "instagram")),
        cuisine=_tag(tags, "cuisine"),
    )


def parse_venues(elements: Iterable[dict]) -> list[Venue]:
    """Overpass elements → venues, one per osm_ref, skipping places without a name."""
    venues: dict[str, Venue] = {}
    for element in elements:
        venue = parse_venue(element)
        if venue:
            venues[venue.osm_ref] = venue
    return list(venues.values())


def is_partial(existing: Iterable[str], returned: Iterable[str], min_share: float = MIN_SHARE) -> bool:
    """True when fewer than min_share of the OSM places already loaded came back.

    Overpass sometimes answers with part of the result (a timeout inside the
    query); hiding everything it left out would empty the catalog.
    """
    existing = set(existing)
    if not existing:
        return False
    return len(existing & set(returned)) < len(existing) * min_share


def fetch_elements(
    query: str = QUERY,
    endpoints: list[str] = ENDPOINTS,
    attempts: int = 4,
    urlopen: Callable = urllib.request.urlopen,
    sleep: Callable[[float], None] = time.sleep,
) -> list[dict]:
    """Asks Overpass, alternating between the endpoints, with a growing pause between attempts."""
    data = urllib.parse.urlencode({"data": query}).encode()
    error: Exception | None = None
    for attempt in range(attempts):
        url = endpoints[attempt % len(endpoints)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=120) as resp:
                payload = json.load(resp)
            # A query that ran out of time or memory still answers 200, with
            # whatever it found so far and a "remark".
            remark = payload.get("remark") or ""
            if "error" in remark.lower():
                raise RuntimeError(remark)
            return payload["elements"]
        except Exception as e:  # noqa: BLE001 - log and retry
            error = e
            log.warning("%s: %s", url, e)
            if attempt + 1 < attempts:
                sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass did not answer: {error}")


def connect(url: str):
    import psycopg

    # Same as db.connect (which would import the price parsers): the Supabase
    # pooler (transaction mode) does not support prepared statements.
    return psycopg.connect(url, autocommit=False, prepare_threshold=None)


def sync_venues(conn, venues: list[Venue]) -> dict:
    """Upserts the venues and hides OSM places missing from them, in one transaction.

    Changes nothing when the answer looks partial (is_partial). Returns counts and a status.
    """
    with conn.cursor() as cur:
        cur.execute("select osm_ref from public.venues where source = 'osm' and not hidden")
        existing = {r[0] for r in cur.fetchall()}
        returned = {v.osm_ref for v in venues}
        stats = {"existing": len(existing), "returned": len(venues), "came_back": len(existing & returned)}
        if is_partial(existing, returned):
            conn.rollback()
            return {"status": "partial", **stats}

        cur.execute(
            """
            create temp table stage_venues (
              osm_ref text, name text, kind text, lat double precision, lng double precision, address text,
              opening_hours text, website text, phone text, instagram text, cuisine text
            ) on commit drop
            """
        )
        with cur.copy(f"copy stage_venues ({', '.join(COLUMNS)}) from stdin") as copy:
            for v in venues:
                copy.write_row(astuple(v))

        cols = ", ".join(COLUMNS)
        data_cols = [c for c in COLUMNS if c != "osm_ref"]
        # An admin's edit wins over OSM (admin_update_venue), and a place an
        # admin hid is not shown again; both are still hidden when gone from OSM.
        edited = "venues.admin_edited_at is not null"
        cur.execute(
            f"""
            insert into public.venues ({cols}, source, status, hidden)
            select {cols}, 'osm', 'approved', false from stage_venues
            on conflict (osm_ref) do update set
              {", ".join(f"{c} = case when {edited} then venues.{c} else excluded.{c} end" for c in data_cols)},
              hidden = venues.hidden_by_admin
            where (venues.hidden and not venues.hidden_by_admin)
              or (not ({edited}) and ({", ".join(f"venues.{c}" for c in data_cols)})
                  is distinct from ({", ".join(f"excluded.{c}" for c in data_cols)}))
            """
        )
        stats["written"] = cur.rowcount
        cur.execute(
            """
            update public.venues v set hidden = true
            where v.source = 'osm' and not v.hidden
              and not exists (select 1 from stage_venues s where s.osm_ref = v.osm_ref)
            """
        )
        stats["hidden"] = cur.rowcount
    conn.commit()
    return {"status": "ok", **stats}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="house_ingest.venues", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing")
    parser.add_argument("--from-file", type=Path, help="read a saved Overpass JSON answer instead of asking Overpass")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    # Strip: a secret pasted with a trailing newline otherwise becomes part of
    # the database name (as in the price ingest).
    db_url = (os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if not args.dry_run and not db_url:
        print("SUPABASE_DB_URL is not set; nothing to do. See docs/setup.md.", file=sys.stderr)
        return 0

    if args.from_file:
        elements = json.loads(args.from_file.read_text(encoding="utf-8"))["elements"]
    else:
        elements = fetch_elements()
    venues = parse_venues(elements)
    summary: dict = {
        "elements": len(elements),
        "venues": len(venues),
        "by_kind": dict(Counter(v.kind for v in venues).most_common()),
    }
    if not venues:
        # The area was not found, or Overpass answered with nothing.
        print(json.dumps({"status": "failed", **summary}, ensure_ascii=False, indent=2))
        return 1
    if args.dry_run:
        print(json.dumps({"status": "dry-run", **summary}, ensure_ascii=False, indent=2))
        return 0

    conn = connect(db_url)
    try:
        result = sync_venues(conn, venues)
    finally:
        conn.close()
    print(json.dumps({**result, **summary}, ensure_ascii=False, indent=2))
    if result["status"] == "partial":
        log.error("Only %(came_back)s of %(existing)s known places came back; nothing changed.", result)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
