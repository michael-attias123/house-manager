"""Parsers for the Stores and PriceFull XML files.

Chains publish the same fields with different casing and nesting
(Shufersal: <STORES><STORE><STOREID>, Cerberus chains: <Stores><Store><StoreId>,
items under <Items><Item> or <Products><Product>), so elements are matched by
their lower-cased child tag names rather than by path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

from lxml import etree


@dataclass(frozen=True)
class StoreRecord:
    store_code: str
    name: str
    city: str | None
    address: str | None


@dataclass(frozen=True)
class PriceRecord:
    barcode: str
    name: str
    manufacturer: str | None
    quantity: Decimal | None
    unit: str | None
    is_weighted: bool
    price: Decimal
    unit_price: Decimal | None
    price_updated_at: datetime | None


def _local(tag: object) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1].lower()


def _fields(element: etree._Element) -> dict[str, str]:
    return {_local(child.tag): (child.text or "").strip() for child in element}


def _parse_xml(content: bytes) -> etree._Element:
    parser = etree.XMLParser(recover=True, huge_tree=True, resolve_entities=False, no_network=True)
    root = etree.fromstring(content, parser)
    if root is None:
        raise ValueError("not an XML document")
    return root


def normalize_store_code(code: str) -> str:
    """'039' and '39' are the same branch."""
    stripped = code.strip().lstrip("0")
    return stripped or "0"


def parse_stores(content: bytes) -> list[StoreRecord]:
    root = _parse_xml(content)
    stores: dict[str, StoreRecord] = {}
    for element in root.iter():
        f = _fields(element)
        if "storeid" not in f or "storename" not in f or not f["storeid"]:
            continue
        code = normalize_store_code(f["storeid"])
        stores[code] = StoreRecord(
            store_code=code,
            name=f["storename"],
            city=f.get("city") or None,
            address=f.get("address") or None,
        )
    return list(stores.values())


_CITY_STRIP = re.compile(r"[\s\-\"'״׳]")


def _city_key(value: str) -> str:
    return _CITY_STRIP.sub("", value)


def in_city(store: StoreRecord, names: list[str], codes: list[str]) -> bool:
    if not store.city:
        return False
    city = store.city.strip()
    if city in codes:
        return True
    key = _city_key(city)
    return any(_city_key(n) == key for n in names)


def _decimal(value: str | None) -> Decimal | None:
    if not value:
        return None
    try:
        return Decimal(value.replace(",", ""))
    except InvalidOperation:
        return None


def _datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def is_internal_code(code: str, item_type: str | None) -> bool:
    """Chain-specific codes (produce, bakery, in-store weighed items)."""
    if item_type == "0":
        return True
    if not code.isdigit() or len(code) < 8:
        return True
    # GS1 prefix 2 = restricted circulation (variable weight, in-store labels).
    return len(code) == 13 and code.startswith("2")


def parse_prices(content: bytes, chain_id: str) -> list[PriceRecord]:
    root = _parse_xml(content)
    items: dict[str, PriceRecord] = {}
    for element in root.iter():
        f = _fields(element)
        if "itemcode" not in f or "itemprice" not in f:
            continue
        code = f["itemcode"].strip()
        price = _decimal(f["itemprice"])
        name = f.get("itemname") or f.get("itemnm") or ""
        if not code or price is None or price <= 0 or not name:
            continue
        barcode = f"{chain_id}:{code}" if is_internal_code(code, f.get("itemtype")) else code.lstrip("0")
        weighted = f.get("bisweighted", "").lower() in ("1", "true")
        items[barcode] = PriceRecord(
            barcode=barcode,
            name=" ".join(name.split()),
            manufacturer=(f.get("manufacturername") or None),
            quantity=_decimal(f.get("quantity")),
            unit=(f.get("unitofmeasure") or f.get("unitqty") or None),
            is_weighted=weighted,
            price=price,
            unit_price=_decimal(f.get("unitofmeasureprice")),
            price_updated_at=_datetime(f.get("priceupdatedate")),
        )
    return list(items.values())


_FILE_NAME = re.compile(r"^(?P<kind>[A-Za-z]+?)(?P<chain>\d{13})-(?P<store>\d+)-(?P<stamp>\d{8,14})", re.IGNORECASE)


@dataclass(frozen=True)
class FileInfo:
    kind: str
    chain_code: str
    store_code: str
    stamp: str


def parse_file_name(name: str) -> FileInfo | None:
    """PriceFull7290027600007-413-202610170300.xml → kind, chain, store, timestamp."""
    match = _FILE_NAME.match(name.rsplit("/", 1)[-1])
    if not match:
        return None
    return FileInfo(
        kind=match["kind"].lower(),
        chain_code=match["chain"],
        store_code=normalize_store_code(match["store"]),
        stamp=match["stamp"],
    )
