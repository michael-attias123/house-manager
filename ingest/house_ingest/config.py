from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "config.yaml"


@dataclass
class ChainConfig:
    id: str
    name: str
    scraper: str
    stores: list[str] = field(default_factory=list)


@dataclass
class Config:
    city_names: list[str]
    city_codes: list[str]
    max_stores_per_chain: int
    chains: list[ChainConfig]
    # Case-insensitive regexes on the store name, for branches that are not
    # supermarkets (drugstores, online-order warehouses).
    exclude_store_names: list[str] = field(default_factory=list)

    def chain(self, chain_id: str) -> ChainConfig:
        return next(c for c in self.chains if c.id == chain_id)


def load_config(path: Path = DEFAULT_CONFIG) -> Config:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Config(
        city_names=raw["city"]["names"],
        city_codes=[str(c) for c in raw["city"].get("codes", [])],
        max_stores_per_chain=int(raw.get("max_stores_per_chain", 6)),
        exclude_store_names=list(raw.get("exclude_store_names", [])),
        chains=[
            ChainConfig(
                id=c["id"],
                name=c["name"],
                scraper=c["scraper"],
                stores=[str(s) for s in c.get("stores", [])],
            )
            for c in raw["chains"]
        ],
    )
