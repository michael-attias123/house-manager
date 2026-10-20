"""CLI: python -m house_ingest {run,discover} [options]

run       download today's Stores + PriceFull files for the configured chains'
          branches in the city and load them into the database.
discover  print the branches found in the city per chain (nothing is written).
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import os
import sys
import tempfile
from pathlib import Path

from . import db, fetch
from .config import ChainConfig, Config, load_config
from .parse import StoreRecord, in_city, parse_prices, parse_stores

log = logging.getLogger("house_ingest")


def select_stores(chain: ChainConfig, stores: list[StoreRecord], config: Config) -> list[StoreRecord]:
    if chain.stores:
        pinned = set(chain.stores)
        return [s for s in stores if s.store_code in pinned]
    excluded = [re.compile(p, re.IGNORECASE) for p in config.exclude_store_names]
    local = [
        s
        for s in stores
        if in_city(s, config.city_names, config.city_codes) and not any(p.search(s.name) for p in excluded)
    ]
    return sorted(local, key=lambda s: s.name)[: config.max_stores_per_chain]


def chain_folder(chain: ChainConfig, work: Path, from_dir: Path | None) -> Path:
    return from_dir / chain.id if from_dir else fetch.folder_for(chain, work)


def discover_stores(chains: list[ChainConfig], work: Path, from_dir: Path | None):
    """Returns {chain_id: (chain_code, [all stores])}."""
    if not from_dir:
        fetch.download(chains, "STORE_FILE", fetch.stores_regex(), work)
    found: dict[str, tuple[str | None, list[StoreRecord]]] = {}
    for chain in chains:
        folder = chain_folder(chain, work, from_dir)
        files = fetch.latest_files(folder, "stores")
        stores: dict[str, StoreRecord] = {}
        chain_code = None
        for path, info in files.values():
            chain_code = info.chain_code
            for s in parse_stores(path.read_bytes()):
                stores[s.store_code] = s
        found[chain.id] = (chain_code, list(stores.values()))
        log.info("%s: %d stores in Stores file(s)", chain.id, len(stores))
    return found


def cmd_discover(config: Config, chains: list[ChainConfig], work: Path, from_dir: Path | None) -> int:
    found = discover_stores(chains, work, from_dir)
    for chain in chains:
        chain_code, stores = found[chain.id]
        local = [s for s in stores if in_city(s, config.city_names, config.city_codes)]
        print(f"\n{chain.name} ({chain.id}, {chain_code or '?'}): {len(stores)} stores, {len(local)} in city")
        for s in sorted(local, key=lambda s: s.name):
            print(f"  {s.store_code:>5}  {s.name}  —  {s.address or ''}, {s.city}")
    return 0


def cmd_run(config: Config, chains: list[ChainConfig], work: Path, from_dir: Path | None, dry_run: bool) -> int:
    # Strip: a secret pasted with a trailing newline otherwise becomes part of
    # the database name ("postgres\n does not exist").
    db_url = (os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if not dry_run and not db_url:
        print("SUPABASE_DB_URL is not set; nothing to do. See docs/setup.md.", file=sys.stderr)
        return 0

    found = discover_stores(chains, work, from_dir)
    selected = {c.id: select_stores(c, found[c.id][1], config) for c in chains}
    stores_by_code = {
        found[c.id][0]: [s.store_code for s in selected[c.id]] for c in chains if found[c.id][0] and selected[c.id]
    }
    if stores_by_code and not from_dir:
        fetch.download(
            [c for c in chains if selected[c.id]], "PRICE_FULL_FILE", fetch.prices_regex(stores_by_code), work
        )

    stats: dict[str, dict] = {}
    conn = None
    run_id = None
    if not dry_run:
        conn = db.connect(db_url)
        run_id = db.start_run(conn)

    failures = 0
    for chain in chains:
        chain_code, _ = found[chain.id]
        chosen = selected[chain.id]
        chain_stats: dict = {"stores": {}}
        stats[chain.id] = chain_stats
        if not chosen:
            chain_stats["error"] = "no stores found in city (or Stores file unavailable)"
            failures += 1
            continue
        folder = chain_folder(chain, work, from_dir)
        price_files = fetch.latest_files(folder, "pricefull")
        if conn:
            db.upsert_chain(conn, chain.id, chain.name, chain_code)
            store_ids = db.sync_stores(conn, chain.id, chosen)
            conn.commit()
        for store in chosen:
            entry = price_files.get(store.store_code)
            if not entry:
                chain_stats["stores"][store.store_code] = {"name": store.name, "error": "no PriceFull file"}
                failures += 1
                continue
            path, _info = entry
            prices = parse_prices(path.read_bytes(), chain.id)
            result: dict = {"name": store.name, "file": path.name, "items": len(prices)}
            if conn and prices:
                result.update(db.load_store_prices(conn, store_ids[store.store_code], prices))
                conn.commit()
            chain_stats["stores"][store.store_code] = result
            log.info("%s %s: %d items", chain.id, store.name, len(prices))

    status = "ok" if failures == 0 else ("partial" if any(s.get("stores") for s in stats.values()) else "failed")
    if conn:
        db.cleanup(conn)
        conn.commit()
        db.finish_run(conn, run_id, status, stats)
        conn.close()
    print(json.dumps({"status": status, "chains": stats}, ensure_ascii=False, indent=2))
    return 0 if status != "failed" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="house_ingest", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run", "discover"])
    parser.add_argument("--chains", help="comma-separated chain ids from config.yaml (default: all)")
    parser.add_argument("--config", type=Path, help="path to config.yaml")
    parser.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    parser.add_argument("--work-dir", type=Path, help="keep downloaded files here (default: temp dir)")
    parser.add_argument(
        "--from-dir",
        type=Path,
        help="skip downloading; read files from DIR/<chain id>/ (Stores*.xml, PriceFull*.xml)",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    config = load_config(args.config) if args.config else load_config()
    chains = config.chains
    if args.chains:
        wanted = set(args.chains.split(","))
        chains = [c for c in chains if c.id in wanted]

    with tempfile.TemporaryDirectory(prefix="house-ingest-") as tmp:
        work = args.work_dir or Path(tmp)
        work.mkdir(parents=True, exist_ok=True)
        if args.command == "discover":
            return cmd_discover(config, chains, work, args.from_dir)
        return cmd_run(config, chains, work, args.from_dir, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
