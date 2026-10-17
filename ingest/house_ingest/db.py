"""Writes parsed prices to Postgres (Supabase) in a few set-based statements."""

from __future__ import annotations

import json
from collections.abc import Iterable

import psycopg

from .parse import PriceRecord, StoreRecord


def connect(url: str) -> psycopg.Connection:
    # prepare_threshold=None: the Supabase pooler (transaction mode) does not
    # support prepared statements.
    return psycopg.connect(url, autocommit=False, prepare_threshold=None)


def start_run(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("insert into public.ingest_runs default values returning id")
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def finish_run(conn: psycopg.Connection, run_id: int, status: str, stats: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update public.ingest_runs set finished_at = now(), status = %s, stats = %s where id = %s",
            (status, json.dumps(stats, ensure_ascii=False), run_id),
        )
    conn.commit()


def upsert_chain(conn: psycopg.Connection, chain_id: str, name: str, chain_code: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.chains (id, name, chain_code) values (%s, %s, %s)
            on conflict (id) do update set name = excluded.name,
              chain_code = coalesce(excluded.chain_code, chains.chain_code)
            """,
            (chain_id, name, chain_code),
        )


def sync_stores(conn: psycopg.Connection, chain_id: str, stores: Iterable[StoreRecord]) -> dict[str, int]:
    """Upserts the selected stores, deactivates the chain's others. Returns code → id."""
    stores = list(stores)
    ids: dict[str, int] = {}
    with conn.cursor() as cur:
        for s in stores:
            cur.execute(
                """
                insert into public.stores (chain_id, store_code, name, city, address, active)
                values (%s, %s, %s, %s, %s, true)
                on conflict (chain_id, store_code) do update set
                  name = excluded.name, city = excluded.city, address = excluded.address, active = true
                returning id
                """,
                (chain_id, s.store_code, s.name, s.city, s.address),
            )
            ids[s.store_code] = cur.fetchone()[0]
        cur.execute(
            "update public.stores set active = false where chain_id = %s and not (store_code = any(%s))",
            (chain_id, [s.store_code for s in stores]),
        )
    return ids


def load_store_prices(conn: psycopg.Connection, store_id: int, prices: list[PriceRecord]) -> dict[str, int]:
    """Replaces one store's price list. Returns counts."""
    with conn.cursor() as cur:
        cur.execute(
            """
            create temp table if not exists stage_prices (
              barcode text, name text, manufacturer text, quantity numeric, unit text,
              is_weighted boolean, price numeric, unit_price numeric, price_updated_at timestamp
            ) on commit delete rows
            """
        )
        with cur.copy(
            "copy stage_prices (barcode, name, manufacturer, quantity, unit, is_weighted, price, unit_price, price_updated_at) from stdin"
        ) as copy:
            for p in prices:
                copy.write_row(
                    (p.barcode, p.name, p.manufacturer, p.quantity, p.unit, p.is_weighted, p.price, p.unit_price, p.price_updated_at)
                )

        cur.execute(
            """
            insert into public.products (barcode, name, manufacturer, quantity, unit, is_weighted, updated_at)
            select distinct on (barcode) barcode, name, manufacturer, quantity, unit, is_weighted, now()
            from stage_prices order by barcode
            on conflict (barcode) do update set
              name = excluded.name, manufacturer = excluded.manufacturer, quantity = excluded.quantity,
              unit = excluded.unit, is_weighted = excluded.is_weighted, updated_at = now()
            where (products.name, products.manufacturer, products.quantity, products.unit, products.is_weighted)
              is distinct from (excluded.name, excluded.manufacturer, excluded.quantity, excluded.unit, excluded.is_weighted)
               or products.updated_at < now() - interval '7 days'
            """
        )
        products = cur.rowcount
        cur.execute(
            """
            insert into public.prices (store_id, barcode, price, unit_price, price_updated_at)
            select distinct on (barcode) %s, barcode, round(price, 2), round(unit_price, 2),
              price_updated_at at time zone 'Asia/Jerusalem'
            from stage_prices order by barcode
            on conflict (store_id, barcode) do update set
              price = excluded.price, unit_price = excluded.unit_price, price_updated_at = excluded.price_updated_at
            where prices.price is distinct from excluded.price or prices.unit_price is distinct from excluded.unit_price
            """,
            (store_id,),
        )
        changed = cur.rowcount
        cur.execute(
            """
            delete from public.prices p
            where p.store_id = %s and not exists (select 1 from stage_prices s where s.barcode = p.barcode)
            """,
            (store_id,),
        )
        removed = cur.rowcount
        cur.execute("update public.stores set last_ingested_at = now() where id = %s", (store_id,))
    return {"items": len(prices), "products_written": products, "prices_written": changed, "prices_removed": removed}


def cleanup(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("delete from public.price_history where changed_on < current_date - 180")
        cur.execute(
            """
            delete from public.products p
            where p.updated_at < now() - interval '90 days'
              and not exists (select 1 from public.prices where barcode = p.barcode)
            """
        )
