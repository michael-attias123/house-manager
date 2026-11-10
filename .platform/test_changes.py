"""house-manager's CI areas (.platform/changes.toml): each path wakes only its own jobs.
Runs in ci.yml's changes job against shared-platform's tools/changes.py (SHARED_TOOLS)."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.environ.get("SHARED_TOOLS", str(Path(__file__).resolve().parents[1] / ".shared-platform" / "tools")))
import changes  # noqa: E402

CONFIG = changes.load(str(Path(__file__).resolve().parent / "changes.toml"))
NONE = {a: False for a in CONFIG.areas}


def only(*areas):
    return {**NONE, **{a: True for a in areas}}


@pytest.mark.parametrize("files, expected", [
    (["observability/dashboards/house-manager/database.json"], only("observability")),
    (["observability/alerts/app.yaml", "scripts/observability/validate.py"], only("observability")),
    (["docs/setup.md"], only("observability")),
    (["web/src/app/Layout.tsx"], only("web")),
    (["supabase/migrations/2026_x.sql"], only("database")),
    (["ingest/house_ingest/parse.py"], only("database")),
    (["supabase/functions/send-push/index.ts"], only("functions")),
    (["infra/main.tf", "README.md", ".github/workflows/infra.yml"], NONE),
    (["web/a.ts", "supabase/functions/x.ts"], only("web", "functions")),
    ([".github/workflows/ci.yml"], only(*CONFIG.areas)),
    ([".platform/changes.toml"], only(*CONFIG.areas)),
    ([], NONE),
])
def test_areas(files, expected):
    assert changes.areas_for(CONFIG, files) == expected
