"""Places from OpenStreetMap (house_ingest.venues).

overpass_sample.json is written by hand in Overpass's JSON shape, with
made-up names; the opening_hours values have the shapes found in Be'er Sheva.
The database test at the end runs only when TEST_DATABASE_URL is set
(scripts/db-test.sh database, CI).
"""

import io
import json
import os
from dataclasses import replace
from pathlib import Path

import pytest

from house_ingest import venues as v

FIXTURE = Path(__file__).parent / "fixtures" / "overpass_sample.json"
ELEMENTS = json.loads(FIXTURE.read_text(encoding="utf-8"))["elements"]
DB_URL = os.environ.get("TEST_DATABASE_URL")


def by_ref(venues):
    return {x.osm_ref: x for x in venues}


def test_parses_the_sample_and_skips_places_without_a_name():
    venues = by_ref(v.parse_venues(ELEMENTS))
    assert len(ELEMENTS) == 11
    # node/9000000008 has no name at all, node/9000000010 only blank ones.
    assert sorted(venues) == sorted(
        f"{e['type']}/{e['id']}" for e in ELEMENTS if e["id"] not in (9000000008, 9000000010)
    )


def test_maps_amenities_to_kinds():
    kinds = {ref: x.kind for ref, x in by_ref(v.parse_venues(ELEMENTS)).items()}
    assert kinds == {
        "node/9000000001": "bar",
        "way/9000000002": "pub",  # biergarten
        "node/9000000003": "restaurant",
        "node/9000000004": "restaurant",  # fast_food
        "node/9000000005": "cafe",
        "node/9000000006": "cafe",  # ice_cream
        "node/9000000007": "nightclub",
        "relation/9000000009": "restaurant",
        "node/9000000011": "cafe",
    }
    assert v.parse_venue({"type": "node", "id": 1, "lat": 31.2, "lon": 34.8, "tags": {"amenity": "bbq", "name": "x"}}).kind == "other"


def test_hebrew_name_comes_first():
    venues = by_ref(v.parse_venues(ELEMENTS))
    assert venues["node/9000000001"].name == "בר הדוגמה"
    assert venues["node/9000000005"].name == "הבית של הקפה"
    assert venues["way/9000000002"].name == "גינת השכונה"  # no name:he
    assert venues["node/9000000011"].name == "קפה פינתי"  # name:he only


def test_ways_and_relations_use_their_center():
    venues = by_ref(v.parse_venues(ELEMENTS))
    assert (venues["node/9000000001"].lat, venues["node/9000000001"].lng) == (31.2425, 34.7905)
    assert (venues["way/9000000002"].lat, venues["way/9000000002"].lng) == (31.2448, 34.7921)
    assert (venues["relation/9000000009"].lat, venues["relation/9000000009"].lng) == (31.2502, 34.7720)
    no_center = v.parse_venue({"type": "way", "id": 5, "tags": {"amenity": "bar", "name": "בלי מרכז"}})
    assert (no_center.lat, no_center.lng) == (None, None)


def test_address_from_street_and_house_number():
    venues = by_ref(v.parse_venues(ELEMENTS))
    assert venues["node/9000000001"].address == "רחוב הדוגמה 12"
    assert venues["relation/9000000009"].address == "שדרות הבדיה"
    # A house number without a street says nothing.
    assert venues["node/9000000007"].address is None
    assert venues["node/9000000004"].address is None


def test_contact_fallbacks():
    venues = by_ref(v.parse_venues(ELEMENTS))
    restaurant = venues["node/9000000003"]
    assert restaurant.phone == "+972 8-000-0003"
    assert restaurant.website == "https://example.com/mivchan"
    assert restaurant.cuisine == "pizza;italian"
    garden = venues["way/9000000002"]
    # The first of several numbers; a website without a scheme gets one.
    assert garden.phone == "+972 8-000-0001"
    assert garden.website == "https://www.example.com/ginat"
    assert venues["node/9000000006"].phone is None


def test_opening_hours_are_kept_verbatim():
    venues = by_ref(v.parse_venues(ELEMENTS))
    assert venues["node/9000000001"].opening_hours == 'Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"'
    assert venues["way/9000000002"].opening_hours == "Mo-We, Su 12:00-00:00; Th-Sa 12:00-01:00"
    assert venues["node/9000000003"].opening_hours == "10:00-24:00; Fr,Sa 09:00-24:00"
    assert venues["node/9000000004"].opening_hours is None


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("https://www.instagram.com/bar.hadugma/", "bar.hadugma"),
        ("http://instagram.com/bar_hadugma?igsh=abc", "bar_hadugma"),
        ("instagram.com/bar.hadugma", "bar.hadugma"),
        ("@cafe.example", "cafe.example"),
        ("cafe.example", "cafe.example"),
        ("https://www.instagram.com/p/AbCdEf123/", "https://www.instagram.com/p/AbCdEf123/"),
        ("instagram.com/reel/xyz", "https://instagram.com/reel/xyz"),
        ("https://linktr.ee/somewhere", "https://linktr.ee/somewhere"),
        ("not a handle", None),
        ("  ", None),
        (None, None),
    ],
)
def test_instagram_is_a_handle_or_a_url(raw, expected):
    assert v.normalize_instagram(raw) == expected


def test_instagram_from_the_sample():
    venues = by_ref(v.parse_venues(ELEMENTS))
    assert venues["node/9000000001"].instagram == "bar.hadugma"
    assert venues["node/9000000005"].instagram == "cafe.example"
    assert venues["relation/9000000009"].instagram == "https://www.instagram.com/p/AbCdEf123/"  # plain instagram tag


def test_partial_response_guard():
    known = {f"node/{i}" for i in range(10)}
    # The first load, and an answer with half or more of the known places.
    assert not v.is_partial(set(), {"node/1"})
    assert not v.is_partial(known, {f"node/{i}" for i in range(5)})
    assert not v.is_partial(known, known | {"node/99"})
    # Fewer than half came back, however many new ones there are.
    assert v.is_partial(known, {f"node/{i}" for i in range(4)})
    assert v.is_partial(known, {f"node/{i}" for i in range(4)} | {f"way/{i}" for i in range(20)})
    assert v.is_partial(known, set())


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_fetch_retries_and_falls_back_to_the_second_endpoint():
    calls, pauses = [], []
    answers = [
        OSError("connection reset"),
        {"elements": [], "remark": 'runtime error: Query timed out in "query" at line 8 after 91 seconds.'},
        {"elements": ELEMENTS[:2]},
    ]

    def urlopen(req, timeout):
        calls.append(req.full_url)
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return FakeResponse(json.dumps(answer).encode())

    elements = v.fetch_elements(urlopen=urlopen, sleep=pauses.append)
    assert elements == ELEMENTS[:2]
    assert calls == [v.ENDPOINTS[0], v.ENDPOINTS[1], v.ENDPOINTS[0]]
    assert pauses == [5, 10]


def test_fetch_gives_up():
    def urlopen(req, timeout):
        raise OSError("blocked")

    with pytest.raises(RuntimeError, match="Overpass did not answer"):
        v.fetch_elements(attempts=2, urlopen=urlopen, sleep=lambda s: None)


def test_query_covers_the_city_and_every_amenity():
    assert '["name"="באר שבע"]' in v.QUERY and '["name:en"="Beersheba"]' in v.QUERY and "Be'er Sheva" in v.QUERY
    for amenity in ("bar", "pub", "restaurant", "cafe", "nightclub", "biergarten", "fast_food", "ice_cream"):
        assert amenity in v.QUERY


def test_dry_run_from_file(capsys, monkeypatch):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert v.main(["--dry-run", "--from-file", str(FIXTURE)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "dry-run" and out["elements"] == 11 and out["venues"] == 9
    assert out["by_kind"] == {"restaurant": 3, "cafe": 3, "bar": 1, "pub": 1, "nightclub": 1}


def test_without_a_database_url_nothing_happens(capsys, monkeypatch):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert v.main(["--from-file", str(FIXTURE)]) == 0
    assert "SUPABASE_DB_URL is not set" in capsys.readouterr().err


@pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL not set")
def test_sync_upserts_hides_and_refuses_a_partial_answer(monkeypatch, capsys):
    import psycopg

    def rows(conn):
        return {
            r[0]: r[1:]
            for r in conn.execute(
                "select osm_ref, name, kind, hidden, status, household_id, updated_at from venues where source = 'osm'"
            ).fetchall()
        }

    # db_test.sql left OSM places of its own: hidden, they do not count as known.
    with psycopg.connect(DB_URL) as conn:
        conn.execute("update venues set hidden = true where source = 'osm'")

    monkeypatch.setenv("SUPABASE_DB_URL", DB_URL)
    assert v.main(["--from-file", str(FIXTURE)]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "ok"
    venues = v.parse_venues(ELEMENTS)
    refs = {x.osm_ref for x in venues}

    with psycopg.connect(DB_URL) as conn:
        loaded = rows(conn)
        assert {r for r, (_n, _k, hidden, *_rest) in loaded.items() if not hidden} == refs
        name, kind, hidden, status, household_id, _ = loaded["way/9000000002"]
        assert (name, kind, hidden, status, household_id) == ("גינת השכונה", "pub", False, "approved", None)
        bar = conn.execute(
            "select lat, lng, address, opening_hours, instagram from venues where osm_ref = 'node/9000000001'"
        ).fetchone()
        assert bar == (31.2425, 34.7905, "רחוב הדוגמה 12", 'Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"', "bar.hadugma")

        # The same answer again writes nothing.
        assert v.sync_venues(conn, venues)["written"] == 0
        assert rows(conn) == loaded

        # A place gone from OSM is hidden; a renamed one is updated.
        gone = "node/9000000006"
        renamed = [replace(x, name="בר הדוגמה החדש") if x.osm_ref == "node/9000000001" else x for x in venues]
        result = v.sync_venues(conn, [x for x in renamed if x.osm_ref != gone])
        assert (result["status"], result["written"], result["hidden"]) == ("ok", 1, 1)
        after = rows(conn)
        assert after[gone][2] is True
        assert after["node/9000000001"][0] == "בר הדוגמה החדש"

        # Fewer than half of the known places: nothing changes.
        result = v.sync_venues(conn, venues[:3])
        assert result["status"] == "partial" and result["came_back"] == 3 and result["existing"] == 8
        assert rows(conn) == after

        # The place is back in OSM: shown again.
        assert v.sync_venues(conn, venues)["status"] == "ok"
        assert rows(conn)[gone][2] is False
