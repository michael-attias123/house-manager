"""Tests for plan_guard.py."""
import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plan_guard  # noqa: E402


def plan(*changes, **extra):
    return {
        "format_version": "1.2",
        "resource_changes": [
            {"address": address, "change": {"actions": actions, "after": {"secret": "never-printed"}}}
            for address, actions in changes
        ],
        **extra,
    }


def run(tmp_path, doc, capsys):
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    code = plan_guard.main([str(path)])
    return code, capsys.readouterr().out


@pytest.mark.parametrize("address", [
    "module.observability.grafana_rule_group.this[\"availability\"]",
    "module.observability.module.inner.grafana_folder.this",
    "module.uptime.grafana_synthetic_monitoring_check.app[0]",
    "module.uptime[0].grafana_synthetic_monitoring_check.app",
])
def test_in_scope(address):
    assert plan_guard.in_scope(address)


@pytest.mark.parametrize("address", [
    "module.backend.supabase_project.this",
    "module.observability_extra.thing.x",
    "module.uptimes.thing.x",
    "grafana_folder.root",
    "module.hosting.cloudflare_pages_project.this",
])
def test_out_of_scope(address):
    assert not plan_guard.in_scope(address)


def test_changes_inside_pass(tmp_path, capsys):
    code, out = run(tmp_path, plan(
        ("module.observability.grafana_rule_group.this[\"budget\"]", ["update"]),
        ("module.uptime.grafana_synthetic_monitoring_check.app", ["delete", "create"]),
    ), capsys)
    assert code == 0
    assert "2 change(s)" in out
    assert "delete-create module.uptime" in out
    assert "never-printed" not in out


def test_change_outside_refused(tmp_path, capsys):
    code, out = run(tmp_path, plan(
        ("module.observability.grafana_rule_group.this[\"budget\"]", ["update"]),
        ("module.backend.supabase_settings.this", ["update"]),
    ), capsys)
    assert code == 1
    assert "module.backend.supabase_settings.this is outside" in out
    assert "never-printed" not in out


def test_reads_and_no_ops_ignored(tmp_path, capsys):
    code, out = run(tmp_path, plan(
        ("module.secrets.data.sops_file.this", ["read"]),
        ("module.backend.supabase_project.this", ["no-op"]),
    ), capsys)
    assert code == 0
    assert "0 change(s)" in out


def test_no_resource_changes_key(tmp_path, capsys):
    code, _ = run(tmp_path, {"format_version": "1.2"}, capsys)
    assert code == 0


def test_errored_plan_refused(tmp_path, capsys):
    code, out = run(tmp_path, plan(errored=True), capsys)
    assert code == 1
    assert "errored" in out


def test_not_a_plan_refused(tmp_path, capsys):
    code, _ = run(tmp_path, {"resource_changes": []}, capsys)
    assert code == 1


def test_unreadable_file(tmp_path, capsys):
    (tmp_path / "plan.json").write_text("{oops", encoding="utf-8")
    assert plan_guard.main([str(tmp_path / "plan.json")]) == 1
    assert plan_guard.main([str(tmp_path / "missing.json")]) == 1


def test_stdin(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(plan(
        ("module.observability.grafana_mute_timing.this[\"x\"]", ["create"])))))
    assert plan_guard.main(["-"]) == 0


def test_usage():
    assert plan_guard.main([]) == 1
