from pathlib import Path

from house_ingest.config import load_config
from house_ingest.fetch import latest_files, prices_regex
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
    assert (info.kind, info.chain_code, info.store_code, info.stamp) == ("pricefull", "7290027600007", "413", "202610170300")
    latest = latest_files(FIXTURES / "shufersal", "pricefull")
    assert latest["413"][0].name == "PriceFull7290027600007-413-202610170300.xml"
    assert latest_files(FIXTURES / "shufersal", "stores")["0"][0].name.startswith("Stores")


def test_price_regex_selects_only_configured_stores():
    pattern = re.compile(prices_regex({"7290058140886": ["39"], "7290027600007": ["413", "277"]}))
    from datetime import date

    today = date.today().strftime("%Y%m%d")
    assert pattern.search(f"PriceFull7290058140886-039-{today}0010")
    assert pattern.search(f"PriceFull7290027600007-413-{today}0300")
    assert not pattern.search(f"PriceFull7290027600007-012-{today}0300")
    assert not pattern.search(f"Price7290027600007-413-{today}0300")
    assert not pattern.search("PriceFull7290027600007-413-201901010300")
