"""End-to-end load into a database with the migrations applied.

Runs only when TEST_DATABASE_URL is set (scripts/db-test.sh database, CI).
"""

import os
from pathlib import Path

import pytest

from house_ingest.__main__ import main

FIXTURES = Path(__file__).parent / "fixtures"
DB_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL not set")


def test_run_loads_fixture_prices(monkeypatch, capsys):
    import psycopg

    monkeypatch.setenv("SUPABASE_DB_URL", DB_URL)
    assert main(["run", "--chains", "shufersal,rami_levy", "--from-dir", str(FIXTURES)]) == 0
    capsys.readouterr()

    with psycopg.connect(DB_URL) as conn:
        stores = conn.execute(
            "select chain_id, store_code, active from stores where chain_id in ('shufersal','rami_levy') order by 1, 2"
        ).fetchall()
        assert stores == [("rami_levy", "39", True), ("shufersal", "277", True), ("shufersal", "413", True)]
        milk = conn.execute(
            "select s.chain_id, p.price from prices p join stores s on s.id = p.store_id "
            "where p.barcode = '7290000000001' order by 1"
        ).fetchall()
        assert [(c, float(p)) for c, p in milk] == [("rami_levy", 6.2), ("shufersal", 6.9)]
        run = conn.execute("select status from ingest_runs order by id desc limit 1").fetchone()
        # Store 277 has no PriceFull fixture.
        assert run == ("partial",)

    # A second run with a changed price records history and is idempotent otherwise.
    with psycopg.connect(DB_URL) as conn:
        conn.execute("update prices set price = 5.00 where barcode = '7290000000001'")
        conn.commit()
    assert main(["run", "--chains", "shufersal,rami_levy", "--from-dir", str(FIXTURES)]) == 0
    with psycopg.connect(DB_URL) as conn:
        changes = conn.execute("select count(*) from price_history where barcode = '7290000000001'").fetchone()[0]
        assert changes == 2
