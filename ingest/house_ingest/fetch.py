"""Downloads Stores and PriceFull files with il-supermarket-scraper.

The scraper (non-commercial license, Sefi Erlich,
https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers)
knows each chain's publishing site. We only tell it which file names to
fetch, then pick the newest file per store from the download folder.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from pathlib import Path

from .config import ChainConfig
from .parse import FileInfo, parse_file_name

log = logging.getLogger(__name__)


def _recent_days(days: int = 2) -> str:
    today = date.today()
    return "|".join((today - timedelta(days=i)).strftime("%Y%m%d") for i in range(days))


def stores_regex() -> str:
    return rf"^Stores\w*?\d{{13}}-\d+-(?:{_recent_days(3)})"


def prices_regex(stores_by_chain_code: dict[str, list[str]]) -> str:
    parts = [
        rf"{chain_code}-0*(?:{'|'.join(re.escape(s) for s in sorted(codes))})-"
        for chain_code, codes in sorted(stores_by_chain_code.items())
        if codes
    ]
    return rf"^PriceFull(?:{'|'.join(parts)})(?:{_recent_days(2)})"


def folder_for(chain: ChainConfig, out_dir: Path) -> Path:
    from il_supermarket_scarper import DumpFolderNames

    return out_dir / DumpFolderNames[chain.scraper].value


def download(chains: list[ChainConfig], file_type: str, regex: str, out_dir: Path, timeout: int = 1500) -> None:
    """file_type: STORE_FILE or PRICE_FULL_FILE."""
    from il_supermarket_scarper import ScarpingTask

    log.info("downloading %s for %s (regex %s)", file_type, [c.id for c in chains], regex)
    task = ScarpingTask(
        enabled_scrapers=[c.scraper for c in chains],
        files_types=[file_type],
        file_name_regex=regex,
        multiprocessing=max(1, len(chains)),
        output_configuration={"output_mode": "disk", "base_storage_path": str(out_dir)},
        status_configuration={"database_type": "json", "base_path": str(out_dir / "status")},
        timeout_in_seconds=timeout,
    )
    task.start()
    task.join()


def latest_files(folder: Path, kind: str) -> dict[str, tuple[Path, FileInfo]]:
    """Newest file of `kind` ("stores", "pricefull") per store code in a folder."""
    latest: dict[str, tuple[Path, FileInfo]] = {}
    if not folder.exists():
        return latest
    for path in folder.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in (".xml", ""):
            continue
        info = parse_file_name(path.name)
        if not info or not info.kind.startswith(kind):
            continue
        if kind == "stores" or info.kind == kind:
            current = latest.get(info.store_code)
            if current is None or current[1].stamp < info.stamp:
                latest[info.store_code] = (path, info)
    return latest
