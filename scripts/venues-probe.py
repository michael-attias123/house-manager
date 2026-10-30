"""Read-only: how much OpenStreetMap knows about places to go out in Be'er Sheva.

Run by .github/workflows/venues-probe.yml. Prints counts by kind and how many
places have a name, opening hours, a website and so on, to decide how much
the "לאן יוצאים" feature can lean on OSM and how much on places added by hand.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
AMENITIES = "bar|pub|restaurant|cafe|nightclub|biergarten|fast_food|ice_cream"
# The city by its administrative boundary, and a bounding box as a cross-check.
QUERY_AREA = f"""
[out:json][timeout:90];
(
  area["boundary"="administrative"]["name"="באר שבע"];
  area["boundary"="administrative"]["name:en"="Beersheba"];
  area["boundary"="administrative"]["name:en"="Be'er Sheva"];
)->.a;
nwr["amenity"~"^({AMENITIES})$"](area.a);
out center tags;
"""
QUERY_BBOX = f"""
[out:json][timeout:90];
nwr["amenity"~"^({AMENITIES})$"](31.20,34.73,31.30,34.86);
out center tags;
"""
TAGS = ["name", "name:he", "opening_hours", "happy_hours", "website", "contact:website", "phone",
        "contact:phone", "contact:instagram", "contact:facebook", "cuisine", "addr:street", "outdoor_seating"]


def overpass(query: str) -> list[dict]:
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(4):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "house-manager-venues-probe/1"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.load(resp)["elements"]
        except Exception as e:  # noqa: BLE001 - print and retry
            print(f"{url}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("Overpass did not answer")


def report(title: str, els: list[dict]) -> None:
    print(f"\n=== {title}: {len(els)} places")
    print("by amenity:", dict(Counter(e["tags"].get("amenity") for e in els).most_common()))
    print("by element type:", dict(Counter(e["type"] for e in els)))
    for tag in TAGS:
        n = sum(1 for e in els if tag in e["tags"])
        print(f"  {tag:20} {n:4}  ({100 * n // max(len(els), 1)}%)")
    bars = [e for e in els if e["tags"].get("amenity") in ("bar", "pub", "biergarten", "nightclub")]
    print(f"\nbars/pubs/clubs: {len(bars)}; with opening_hours: {sum('opening_hours' in e['tags'] for e in bars)}")
    for e in bars[:25]:
        t = e["tags"]
        print(f"  {t.get('amenity'):10} {t.get('name:he') or t.get('name') or '(no name)'} | "
              f"{t.get('opening_hours', '-')} | happy_hours={t.get('happy_hours', '-')}")
    sample = [e["tags"]["opening_hours"] for e in els if "opening_hours" in e["tags"]][:15]
    print("\nopening_hours samples:", *sample, sep="\n  ")


area = overpass(QUERY_AREA)
report("Be'er Sheva administrative area", area)
bbox = overpass(QUERY_BBOX)
report("Bounding box 31.20,34.73 – 31.30,34.86", bbox)
