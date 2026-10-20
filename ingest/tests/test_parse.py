from pathlib import Path

from house_ingest.config import load_config
from house_ingest.fetch import israel_today, latest_files, prices_regex
from house_ingest.parse import in_city, is_internal_code, parse_file_name, parse_prices, parse_stores
import re

FIXTURES = Path(__file__).parent / "fixtures"
CONFIG = load_config()


def test_parses_shufersal_stores_and_matches_city_spellings():
    stores = parse_stores((FIXTURES / "shufersal/Stores7290027600007-000-202610170201.xml").read_bytes())
    assert {s.store_code for s in stores} == {"413", "12", "277"}
    local = [s.store_code for s in stores if in_city(s, CONFIG.city_names, CONFIG.city_codes)]
    assert sorted(local) == ["277", "413"]


def test_parses_cerberus_stores():
    stores = parse_stores((FIXTURES / "rami_levy/Stores7290058140886-000-202610170010.xml").read_bytes())
    beer_sheva = [s for s in stores if in_city(s, CONFIG.city_names, CONFIG.city_codes)]
    assert [(s.store_code, s.name) for s in beer_sheva] == [("39", "באר שבע - ביג")]


def test_parses_prices_and_namespaces_internal_codes():
    prices = {p.barcode: p for p in parse_prices((FIXTURES / "shufersal/PriceFull7290027600007-413-202610170300.xml").read_bytes(), "shufersal")}
    assert set(prices) == {"7290000000001", "7290000000002", "shufersal:200"}
    milk = prices["7290000000001"]
    assert milk.name == "חלב תנובה 3% 1 ליטר"
    assert str(milk.price) == "6.90"
    assert milk.price_updated_at.isoformat() == "2026-10-16T05:40:00"
    assert prices["shufersal:200"].is_weighted


def test_variable_weight_codes_are_internal():
    prices = {p.barcode for p in parse_prices((FIXTURES / "rami_levy/PriceFull7290058140886-039-202610170010.xml").read_bytes(), "rami_levy")}
    assert prices == {"7290000000001", "rami_levy:100", "rami_levy:2000000012345"}
    assert is_internal_code("123", "1")
    assert not is_internal_code("7290000000001", "1")


def test_file_names_and_latest_file():
    info = parse_file_name("PriceFull7290027600007-413-202610170300.xml")
    assert (info.kind, info.chain_code, info.store_code, info.stamp) == ("pricefull", "7290027600007", "413", "20261017030000")
    latest = latest_files(FIXTURES / "shufersal", "pricefull")
    assert latest["413"][0].name == "PriceFull7290027600007-413-202610170300.xml"
    assert latest_files(FIXTURES / "shufersal", "stores")["0"][0].name.startswith("Stores")


def test_price_regex_selects_only_configured_stores():
    pattern = re.compile(prices_regex({"7290058140886": ["39"], "7290027600007": ["413", "277"]}))
    today = israel_today().strftime("%Y%m%d")
    assert pattern.search(f"PriceFull7290058140886-039-{today}0010")
    assert pattern.search(f"PriceFull7290027600007-413-{today}0300")
    assert not pattern.search(f"PriceFull7290027600007-012-{today}0300")
    assert not pattern.search(f"Price7290027600007-413-{today}0300")
    assert not pattern.search("PriceFull7290027600007-413-201901010300")


def test_file_names_with_subchain_and_split_time():
    # Current shapes (2026): sub-chain segment and/or dash between date and time.
    cases = {
        "PriceFull7290027600007-001-169-20261020-030000.gz": ("pricefull", "7290027600007", "169", "20261020030000"),
        "pricefull7290058140886-001-027-20261020-001001.gz": ("pricefull", "7290058140886", "27", "20261020001001"),
        "PriceFull7290055700007-001-416-20261020-000012.xml": ("pricefull", "7290055700007", "416", "20261020000012"),
        "PriceFull7290058140886-039-202610200513.gz": ("pricefull", "7290058140886", "39", "20261020051300"),
        "Stores7290058140886-000-20261020-050500.xml": ("stores", "7290058140886", "0", "20261020050500"),
        "Stores7290027600007-000-20261020-020.xml": ("stores", "7290027600007", "0", "20261020020000"),
    }
    for name, expected in cases.items():
        info = parse_file_name(name)
        assert info and (info.kind, info.chain_code, info.store_code, info.stamp) == expected, name


def test_latest_file_across_name_shapes(tmp_path):
    for name in (
        "PriceFull7290058140886-039-202610200513.xml",
        "PriceFull7290058140886-001-039-20261020-120023.xml",
        "PriceFull7290058140886-001-039-20261019-235959.xml",
        "Stores7290058140886-000-20261020-050500.xml",
        "Stores7290058140886-000-20261020-000100.xml",
    ):
        (tmp_path / name).write_text("<x/>")
    assert latest_files(tmp_path, "pricefull")["39"][0].name == "PriceFull7290058140886-001-039-20261020-120023.xml"
    assert latest_files(tmp_path, "stores")["0"][0].name == "Stores7290058140886-000-20261020-050500.xml"


def test_price_regex_accepts_subchain_split_time_and_any_case():
    from house_ingest.fetch import stores_regex

    today = israel_today().strftime("%Y%m%d")
    pattern = re.compile(prices_regex({"7290058140886": ["27"], "7290027600007": ["169"], "7290055700007": ["1"]}))
    assert pattern.search(f"PriceFull7290027600007-001-169-{today}-030000.gz")
    assert pattern.search(f"pricefull7290058140886-001-027-{today}-001001.gz")
    assert pattern.search(f"PriceFull7290058140886-027-{today}0513.gz")
    assert pattern.search(f"PriceFull7290055700007-001-001-{today}-000012.gz")
    # the sub-chain is never mistaken for the store
    assert not pattern.search(f"PriceFull7290055700007-001-416-{today}-000012.gz")
    assert not pattern.search(f"PriceFull7290027600007-001-170-{today}-030000.gz")
    assert not pattern.search(f"PromoFull7290027600007-001-169-{today}-030000.gz")
    assert not pattern.search("PriceFull7290027600007-001-169-20190101-030000.gz")
    stores = re.compile(stores_regex())
    assert stores.search(f"Stores7290027600007-000-{today}-020.gz")
    assert stores.search(f"Stores7290058140886-000-{today}-050500.xml")
    assert stores.search(f"Stores7290058140886-000-{today}0500.xml")
