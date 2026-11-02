"""Tests for changes.py: each path wakes only its own CI jobs."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import changes  # noqa: E402

NONE = {a: False for a in changes.AREAS}


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
    ([".github/workflows/ci.yml"], only(*changes.AREAS)),
    ([], NONE),
])
def test_areas(files, expected):
    assert changes.areas_for(files) == expected


def test_unknown_runs_everything():
    assert changes.areas_for(None) == only(*changes.AREAS)
    assert changes.changed_files("workflow_dispatch", "main", "") is None
    assert changes.changed_files("push", "main", "0" * 40) is None
    assert changes.changed_files("push", "main", "f" * 40) is None  # not a commit here
