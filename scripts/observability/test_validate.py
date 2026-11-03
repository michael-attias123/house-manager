"""Tests for validate.py: the repo's own files pass, and each kind of mistake fails."""
import json
import shutil
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
VIEWS = {
    "monitoring.ingest_runs": {"id", "started_at", "finished_at", "status", "duration_s"},
    "monitoring.outbox_now": {"due_pending", "oldest_due_age_s", "gave_up_24h", "devices",
                              "devices_without_success_30d"},
    "monitoring.outbox_hourly": {"hour", "kind", "queued", "sent", "gave_up", "expired",
                                 "p50_latency_s", "p95_latency_s"},
}


FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def repo(tmp_path):
    """A copy of observability/ plus an empty docs/setup.md. Its dashboards are
    the classic ones in fixtures/, not the live files: a save in the Grafana
    UI rewrites a live file (as v2), and these tests must not depend on that.
    test_repo_files_pass checks the live files."""
    shutil.copytree(REPO / "observability", tmp_path / "observability")
    folder = tmp_path / "observability" / "dashboards" / "house-manager"
    for path in folder.glob("*.json"):
        if path.name != "_folder.json":
            path.unlink()
    for path in FIXTURES.glob("*.json"):
        shutil.copy(path, folder / path.name)
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "setup.md").write_text("# setup\n", encoding="utf-8")
    return tmp_path


def errors(root):
    return validate.validate(root).errors


def dash_path(root, name="overview"):
    return root / "observability" / "dashboards" / "house-manager" / f"{name}.json"


def edit_json(path, change):
    doc = json.loads(path.read_text(encoding="utf-8"))
    change(doc)
    path.write_text(json.dumps(doc), encoding="utf-8")


def edit_yaml(path, change):
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(doc)
    path.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")


def alerts(root, group="availability"):
    return root / "observability" / "alerts" / f"{group}.yaml"


def has(errs, text):
    """True if one error contains text; fails with the full list otherwise."""
    assert any(text in e for e in errs), f"no error containing {text!r} in {errs}"
    return True


# ------------------------------------------------------------------ good

def test_repo_files_pass():
    rep = validate.validate(REPO)
    assert rep.errors == []


def test_copy_passes_and_runbooks_only_warn(repo):
    rep = validate.validate(repo)
    assert rep.errors == []
    assert any("runbook-app-down" in w for w in rep.warnings)


def test_strict_fails_on_warnings(repo):
    assert validate.main(["--root", str(repo)]) == 0
    assert validate.main(["--root", str(repo), "--strict"]) == 1


def test_runbook_anchors_present_no_warning(repo):
    anchors = validate.validate_alerts(repo, validate.load_config(repo), validate.Report(repo))
    text = "\n".join(f'<a id="runbook-{a}"></a>' for a in anchors)
    (repo / "docs" / "setup.md").write_text(text, encoding="utf-8")
    assert not any("runbook" in w for w in validate.validate(repo).warnings)


def test_wrapped_dashboard_is_accepted(repo):
    path = dash_path(repo)
    spec = json.loads(path.read_text(encoding="utf-8"))
    wrapped = {"apiVersion": "dashboard.grafana.app/v1", "kind": "Dashboard",
               "metadata": {"name": spec["uid"]}, "spec": spec}
    path.write_text(json.dumps(wrapped), encoding="utf-8")
    assert errors(repo) == []


def v2_dashboard(sql="select table_name, total_bytes from monitoring.table_sizes"):
    """A small dashboard as a Grafana UI save writes it (dashboard.grafana.app/v2)."""
    def query(ref, group, ds, spec):
        return {"kind": "PanelQuery", "spec": {"refId": ref, "hidden": False, "query": {
            "kind": "DataQuery", "group": group, "version": "v0",
            "datasource": {"name": ds}, "spec": spec}}}

    def panel(pid, title, *queries):
        return {"kind": "Panel", "spec": {"id": pid, "title": title, "data": {
            "kind": "QueryGroup", "spec": {"queries": list(queries), "queryOptions": {}, "transformations": []}}}}

    return {"apiVersion": "dashboard.grafana.app/v2", "kind": "Dashboard",
            "metadata": {"name": "hm-database"},
            "spec": {
                "title": "House manager: database", "tags": [], "variables": [],
                "annotations": [{"kind": "AnnotationQuery", "spec": {"builtIn": True, "query": {
                    "kind": "DataQuery", "group": "grafana", "datasource": {"name": "-- Grafana --"}, "spec": {}}}}],
                "elements": {
                    "panel-1": panel(1, "Up", query("A", "prometheus", "grafanacloud-prom", {"expr": "max(pg_up)"})),
                    "panel-2": panel(2, "Tables", query("A", "grafana-postgresql-datasource", "hm-postgres", {"rawSql": sql})),
                },
                "layout": {"kind": "GridLayout", "spec": {"items": []}},
            }}


def write_v2(repo, doc):
    dash_path(repo, "database").write_text(json.dumps(doc), encoding="utf-8")


def test_v2_dashboard_is_accepted(repo):
    write_v2(repo, v2_dashboard())
    assert errors(repo) == []


def first_query(d):
    return d["spec"]["elements"]["panel-1"]["spec"]["data"]["spec"]["queries"][0]["spec"]["query"]


@pytest.mark.parametrize("change, message", [
    (lambda d: first_query(d).update(datasource={"name": "other-prom"}), "not in observability/datasources.json"),
    (lambda d: first_query(d).update(datasource={"name": "${ds}"}), "data source variable"),
    (lambda d: first_query(d).update(group="loki"), "expected 'prometheus'"),
    (lambda d: first_query(d).update(datasource={}), "without a uid"),
    (lambda d: first_query(d).pop("datasource"), "default one"),
    (lambda d: d["spec"]["variables"].append({"kind": "DatasourceVariable", "spec": {"name": "ds"}}), "data source variable 'ds'"),
    (lambda d: d["spec"]["elements"]["panel-2"]["spec"].update(id=1), "unique integer id"),
    (lambda d: d["metadata"].update(name="database"), "must match"),
    (lambda d: d["spec"].pop("title"), "title is required"),
])
def test_v2_dashboard_mistakes(repo, change, message):
    doc = v2_dashboard()
    change(doc)
    write_v2(repo, doc)
    assert has(errors(repo), message)


def test_v2_dashboard_sql_privacy(repo):
    write_v2(repo, v2_dashboard("select title from public.notification_outbox"))
    assert has(errors(repo), "only the views")



@pytest.mark.parametrize("value,seconds", [("0", 0), ("0s", 0), ("30s", 30), ("1h30m", 5400), ("24h", 86400)])
def test_parse_duration(value, seconds):
    assert validate.parse_duration(value) == seconds


@pytest.mark.parametrize("value", ["", "5", "1 h", "m", "-1m", 5, None])
def test_parse_duration_rejects(value):
    assert validate.parse_duration(value) is None


# ------------------------------------------------------------------- SQL

@pytest.mark.parametrize("sql", [
    "select coalesce(extract(epoch from now() - max(finished_at)) / 3600, 9999) as hours "
    "from monitoring.ingest_runs where status in ('ok', 'partial') and finished_at is not null",
    "select hour as time, sum(sent) as sent from monitoring.outbox_hourly where $__timeFilter(hour) group by hour order by hour",
    "select o.kind, count(*) from monitoring.outbox_hourly o group by o.kind;",
])
def test_sql_allowed(sql):
    assert validate.check_sql(sql, VIEWS) == []


@pytest.mark.parametrize("sql,problem", [
    ("select title, body from public.notification_outbox", "only the views"),
    ("select * from monitoring.outbox_now", "select *"),
    ("select last_error from monitoring.outbox_hourly", "not columns"),
    ("select user_id from monitoring.outbox_now", "not columns"),
    ("select hour from monitoring.outbox_hourly; drop table x", "one statement"),
    ('select "kind" from monitoring.outbox_hourly', "quoted identifiers"),
    ("select hour from monitoring.outbox_hourly where kind = '$kind' or kind = ${kind}", "template variables"),
    ("select x from generate_series(1, 3) x", "only the views"),
    ("select 1", "reads no monitoring view"),
    ("select hour from monitoring.outbox_hourly join pg_catalog.pg_authid on true", "only the views"),
    ("select current_user from monitoring.outbox_now", "not columns"),
])
def test_sql_rejected(sql, problem):
    assert any(problem in p for p in validate.check_sql(sql, VIEWS))


# ------------------------------------------------------------ dashboards

@pytest.mark.parametrize("change,message", [
    (lambda d: d.update(id=7), "numeric dashboard id"),
    (lambda d: d.update(uid="overview"), "uid 'overview' must match"),
    (lambda d: d.update(uid="hm-" + "x" * 40), "at most 40"),
    (lambda d: d.pop("title"), "title is required"),
    (lambda d: d.pop("tags"), "'tags' is required"),
    (lambda d: d["panels"][0].update(datasource={"type": "prometheus", "uid": "other-prom"}), "not in observability/datasources.json"),
    (lambda d: d["panels"][0].update(datasource="Prometheus"), "by name"),
    (lambda d: d["panels"][0]["targets"][0].update(datasource={"type": "prometheus", "uid": "${ds}"}), "data source variable"),
    (lambda d: d["panels"][0]["targets"][0].update(datasource={"type": "loki", "uid": "grafanacloud-prom"}), "expected 'prometheus'"),
    (lambda d: d["templating"]["list"].append({"type": "datasource", "name": "ds"}), "data source variable 'ds'"),
    (lambda d: d["panels"][1].update(id=1), "unique integer id"),
    (lambda d: (d["panels"][0].pop("datasource"), d["panels"][0]["targets"][0].pop("datasource")), "default one"),
])
def test_dashboard_mistakes(repo, change, message):
    edit_json(dash_path(repo), change)
    assert has(errors(repo), message)


def test_dashboard_sql_privacy(repo):
    def change(d):
        target = next(t for p in d["panels"] for t in p.get("targets", []) if "rawSql" in t)
        target["rawSql"] = "select title from public.notification_outbox"
    edit_json(dash_path(repo), change)
    assert has(errors(repo), "only the views")


def test_duplicate_dashboard_uid(repo):
    edit_json(dash_path(repo, "jobs"), lambda d: d.update(uid="hm-overview"))
    assert has(errors(repo), "is also used by")


def test_invalid_json(repo):
    dash_path(repo).write_text("{not json", encoding="utf-8")
    assert has(errors(repo), "invalid JSON")


def test_stray_file_and_missing_folder_file(repo):
    base = repo / "observability" / "dashboards"
    (base / "house-manager" / "notes.md").write_text("x", encoding="utf-8")
    (base / "other").mkdir()
    shutil.copy(dash_path(repo), base / "other" / "copy.json")
    edit_json(base / "other" / "copy.json", lambda d: d.update(uid="hm-copy"))
    errs = errors(repo)
    assert has(errs, "only dashboard JSON")
    assert has(errs, "add a _folder.json")


def test_resource_limit(repo):
    folder = repo / "observability" / "dashboards" / "house-manager"
    for i in range(validate.MAX_SYNCED_RESOURCES):
        shutil.copy(dash_path(repo), folder / f"extra{i}.json")
        edit_json(folder / f"extra{i}.json", lambda d, i=i: d.update(uid=f"hm-extra-{i}", title=f"Extra {i}"))
    assert has(errors(repo), "synced resources")


def test_folder_file_checked(repo):
    edit_json(repo / "observability" / "dashboards" / "house-manager" / "_folder.json",
              lambda d: d.update(kind="Dashboard"))
    assert has(errors(repo), "kind Folder")


# ---------------------------------------------------------------- alerts

def rule0(doc):
    return doc["rules"][0]


@pytest.mark.parametrize("change,message", [
    (lambda d: rule0(d).pop("severity"), "severity is required"),
    (lambda d: rule0(d).update(severity="high"), "severity must be one of"),
    (lambda d: rule0(d).update(push="yes"), "push must be true or false"),
    (lambda d: rule0(d).pop("summary_he"), "summary_he is required"),
    (lambda d: rule0(d).update(summary_he="App down"), "short Hebrew text"),
    (lambda d: rule0(d).update(summary_he="בדוק/י את האפליקציה"), "gender-neutral"),
    (lambda d: rule0(d).update(runbook="App Down"), "anchor name"),
    (lambda d: rule0(d).update(**{"for": "5 minutes"}), "not a duration"),
    (lambda d: d.update(interval="15s"), "multiple of 10s"),
    (lambda d: d.update(group="other"), "group must be 'availability'"),
    (lambda d: rule0(d).update(uid="app-down"), "uid must match"),
    (lambda d: d["rules"][1].update(uid=rule0(d)["uid"]), "is also used in"),
    (lambda d: d["rules"][1].update(title=rule0(d)["title"]), "rule title"),
    (lambda d: rule0(d).update(labels={"x": "y"}), "unknown key 'labels'"),
    (lambda d: rule0(d).update(no_data_state="Ignore"), "no_data_state"),
    (lambda d: rule0(d).update(condition="Z"), "not one of its ref_ids"),
    (lambda d: rule0(d).update(condition="A"), "must be an expression"),
    (lambda d: rule0(d)["data"][0].update(datasource_uid="prometheus"), "datasource_uid 'prometheus'"),
    (lambda d: rule0(d)["data"][0]["model"].update(refId="X"), "model.refId"),
    (lambda d: rule0(d)["data"][0]["model"].pop("expr"), "expr is required"),
    (lambda d: rule0(d)["data"][0].update(relative_time_range={"from": 0, "to": 0}), "relative_time_range"),
    (lambda d: rule0(d)["data"][1]["model"].update(expression="Q"), "unknown query 'Q'"),
    (lambda d: rule0(d)["data"][2]["model"].update(type="compare"), "expression type"),
    (lambda d: rule0(d)["data"][2]["model"]["conditions"][0]["evaluator"].update(params=["half"]), "numeric params"),
])
def test_alert_mistakes(repo, change, message):
    edit_yaml(alerts(repo), change)
    assert has(errors(repo), message)


def test_alert_sql_privacy(repo):
    def change(d):
        d["rules"][0]["data"][0]["model"]["rawSql"] = "select body from public.notification_outbox"
    edit_yaml(alerts(repo, "data-freshness"), change)
    assert has(errors(repo), "only the views")


def test_math_expression_refs(repo):
    def change(d):
        d["rules"][1]["data"][2]["model"]["expression"] = "$A > 1800 || $Z >= 3"
    edit_yaml(alerts(repo, "data-freshness"), change)
    assert has(errors(repo), "unknown query 'Z'")


# ------------------------------------------------- policies and mute timings

def policies(root):
    return root / "observability" / "alerting" / "policies.yaml"


def mutes(root):
    return root / "observability" / "alerting" / "mute-timings.yaml"


@pytest.mark.parametrize("change,message", [
    (lambda d: d.update(receiver="slack"), "receiver 'slack' is not a contact point"),
    (lambda d: d["routes"][0].update(receiver="pagerduty"), "is not a contact point"),
    (lambda d: d.update(group_wait="soon"), "not a duration"),
    (lambda d: d["routes"][0]["matchers"][0].update(value=True), "quoted strings"),
    (lambda d: d["routes"][0]["matchers"][0].update(value="yes"), "push label"),
    (lambda d: d["routes"][0]["matchers"][0].update(match="=="), "match must be one of"),
    (lambda d: d["routes"][0].update(mute_timings=["nights"]), "mute timing 'nights'"),
    (lambda d: d.update(matchers=[]), "unknown key 'matchers'"),
    (lambda d: d.pop("receiver"), "needs a receiver"),
])
def test_policy_mistakes(repo, change, message):
    edit_yaml(policies(repo), change)
    assert has(errors(repo), message)


def test_mute_timing_good_and_referenced(repo):
    mutes(repo).write_text(yaml.safe_dump([{"name": "nights", "intervals": [
        {"times": [{"start": "22:00", "end": "24:00"}], "weekdays": ["friday:saturday"], "location": "Asia/Jerusalem"}]}]),
        encoding="utf-8")
    edit_yaml(policies(repo), lambda d: d["routes"][0].update(mute_timings=["nights"]))
    assert errors(repo) == []


@pytest.mark.parametrize("content,message", [
    ({"name": "x"}, "must be a list"),
    ([{"name": "nights"}], "exactly name and intervals"),
    ([{"name": "n", "intervals": [{"times": [{"start": "7am", "end": "09:00"}]}]}], "HH:MM"),
    ([{"name": "n", "intervals": [{"weekdays": ["funday"]}]}], "unknown weekday"),
    ([{"name": "n", "intervals": [{"hours": [1]}]}], "may only have"),
])
def test_mute_timing_mistakes(repo, content, message):
    mutes(repo).write_text(yaml.safe_dump(content), encoding="utf-8")
    assert has(errors(repo), message)


def test_receivers_cross_checked_against_hcl(repo):
    module = repo / "infra" / "modules" / "observability"
    module.mkdir(parents=True)
    (module / "alerting.tf").write_text('resource "grafana_contact_point" "email" {\n  name = "email-owner"\n}\n',
                                        encoding="utf-8")
    warnings = validate.validate(repo).warnings
    assert any('name = "app-push"' in w for w in warnings)
    assert not any('name = "email-owner"' in w for w in warnings)
