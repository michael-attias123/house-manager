#!/usr/bin/env python3
"""Checks the GitOps files in observability/ (see observability/README.md).

Dashboards (observability/dashboards, read by Grafana Git Sync):
  - classic dashboard JSON (panels, schemaVersion and tags present, which is
    how Git Sync recognises it) or the dashboard.grafana.app wrapper;
  - a fixed uid with the hm- prefix, a title, no numeric id, unique uids;
  - every data source referenced by an allowed uid (observability/
    datasources.json), never by name or ${variable};
  - SQL reads only the monitoring.* views and their listed columns;
  - each folder has a _folder.json; at most 20 synced resources (Cloud Free).
Alert rules (observability/alerts/<group>.yaml), the notification policy and
mute timings (observability/alerting): the documented schema, labels and
annotations, durations, unique uids, allowed data sources, valid
expressions, and receivers from the fixed contact point list.

Runbook anchors missing from docs/setup.md, and contact points not found in
infra/modules/observability, are warnings; --strict makes them errors.

Usage: python scripts/observability/validate.py [--root DIR] [--strict]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

UID_RE = re.compile(r"^hm-[a-z0-9]+(-[a-z0-9]+)*$")
UID_MAX = 40  # Grafana's limit for dashboard, folder and rule uids
ANCHOR_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
GROUP_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TITLE_RE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
REF_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
DURATION_RE = re.compile(r"^(?:0|(?:\d+(?:ms|s|m|h|d|w|y))+)$")
DURATION_PART_RE = re.compile(r"(\d+)(ms|s|m|h|d|w|y)")
HEBREW_RE = re.compile(r"[א-ת]")
# "עשה/תה"-style gendered forms; UI text is gender-neutral (CLAUDE.md).
GENDERED_RE = re.compile(r"[א-ת]+/[א-ת]{1,3}(?![א-ת])")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")

MAX_SYNCED_RESOURCES = 20  # Git Sync on Grafana Cloud Free
MAX_FOLDER_DEPTH = 4
SEVERITIES = {"critical", "warning", "info"}
NO_DATA_STATES = {"OK", "NoData", "Alerting"}
EXEC_ERR_STATES = {"KeepLast", "Error", "Alerting", "OK"}
EXPR_TYPES = {"math", "reduce", "threshold", "resample", "classic_conditions"}
EVALUATORS = {"gt", "lt", "gte", "lte", "eq", "ne", "within_range", "outside_range",
              "within_range_included", "outside_range_included"}
MATCH_OPS = {"=", "!=", "=~", "!~"}
WEEKDAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

RULE_KEYS = {"uid", "title", "for", "severity", "push", "summary", "summary_he", "runbook",
             "no_data_state", "exec_err_state", "condition", "data"}
DATA_KEYS = {"ref_id", "datasource_uid", "relative_time_range", "model"}
ROUTE_KEYS = {"receiver", "matchers", "continue", "group_by", "group_wait", "group_interval",
              "repeat_interval", "mute_timings", "routes"}
ROOT_POLICY_KEYS = {"receiver", "group_by", "group_wait", "group_interval", "repeat_interval", "routes"}
INTERVAL_KEYS = {"times", "weekdays", "days_of_month", "months", "years", "location"}

# Words a monitoring query may use besides the view columns and its own aliases.
SQL_WORDS = set("""
select from where and or not in is null as group by order asc desc limit offset case when then
else end distinct on join left right inner outer full cross having true false between like
ilike any all exists union with nulls first last filter interval over partition rows range
within coalesce nullif greatest least extract epoch now max min sum avg count round floor ceil
abs date_trunc to_timestamp percentile_cont percentile_disc cast numeric integer int bigint
smallint float double precision real decimal bool boolean text varchar timestamptz timestamp
date time zone at current_date current_timestamp hour day minute second week month year
""".split())


@dataclass
class Config:
    datasources: dict[str, str]  # uid -> type
    builtin: set[str]
    views: dict[str, set[str]]
    receivers: set[str]


@dataclass
class Report:
    root: Path
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def _rel(self, path: Path) -> str:
        try:
            return path.relative_to(self.root).as_posix()
        except ValueError:
            return path.as_posix()

    def error(self, path: Path, msg: str) -> None:
        self.errors.append(f"{self._rel(path)}: {msg}")

    def warn(self, path: Path, msg: str) -> None:
        self.warnings.append(f"{self._rel(path)}: {msg}")


def parse_duration(value: object) -> float | None:
    """Seconds for a Grafana/Prometheus duration ("1m", "1h30m", "0"), else None."""
    if not isinstance(value, str) or not DURATION_RE.match(value):
        return None
    scale = {"ms": 0.001, "s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800, "y": 31536000}
    return float(sum(int(n) * scale[u] for n, u in DURATION_PART_RE.findall(value)))


def load_config(root: Path) -> Config:
    data = json.loads((root / "observability" / "datasources.json").read_text(encoding="utf-8"))
    return Config(
        datasources={d["uid"]: d["type"] for d in data["datasources"]},
        builtin=set(data["builtin"]),
        views={name: set(cols) for name, cols in data["postgres_views"].items()},
        receivers=set(data["receivers"]),
    )


# ----------------------------------------------------------------------- SQL

def check_sql(sql: object, views: dict[str, set[str]]) -> list[str]:
    """Problems with a monitoring query: it may read only the allowed views and columns."""
    if not isinstance(sql, str) or not sql.strip():
        return ["empty SQL"]
    s = sql.lower()
    s = re.sub(r"--[^\n]*", " ", s)
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    problems = []
    if '"' in s:
        problems.append("quoted identifiers are not allowed")
    s = re.sub(r"'(?:[^']|'')*'", " ", s)  # string literals
    s = s.strip()
    if s.endswith(";"):
        s = s[:-1]
    if ";" in s:
        problems.append("one statement only")
    if re.search(r"\$\{?[a-z]", s.replace("$__", "")):
        problems.append("template variables are not allowed in SQL")
    s = re.sub(r"\$__\w+", " ", s)  # Grafana macros: their arguments are still checked
    if re.search(r"(^|[\s,(])\*\s*(,|\bfrom\b|$)", s) or ".*" in s:
        problems.append("select * is not allowed; name the columns")
    s = re.sub(r"\bextract\s*\(\s*\w+\s+from\b", "extract(", s)

    tables = re.findall(r"\b(?:from|join)\s+([a-z_][a-z0-9_.]*)(\s*\()?", s)
    used = set()
    for name, paren in tables:
        if paren or name not in views:
            problems.append(f"reads {name}: only the views {', '.join(sorted(views))} are allowed")
        else:
            used.add(name)
    if not used and not problems:
        problems.append("reads no monitoring view")

    aliases = set(re.findall(r"\bas\s+([a-z_][a-z0-9_]*)", s))
    for alias in re.findall(r"\b(?:from|join)\s+[a-z_][a-z0-9_.]*\s+(?:as\s+)?([a-z_][a-z0-9_]*)", s):
        if alias not in SQL_WORDS:
            aliases.add(alias)
    columns = set().union(*(views[v] for v in used)) if used else set()
    for view in sorted(views, key=len, reverse=True):
        s = re.sub(r"\b" + re.escape(view) + r"\b", " ", s)

    bad = set()
    for token in re.findall(r"\b[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*", s):
        parts = token.split(".")
        if len(parts) == 2 and parts[0] in aliases:
            name = parts[1]
        elif len(parts) == 1:
            name = parts[0]
        else:
            bad.add(token)
            continue
        if name not in columns and name not in SQL_WORDS and name not in aliases:
            bad.add(token)
    if bad:
        problems.append("uses names that are not columns of the views it reads: " + ", ".join(sorted(bad)))
    return problems


# ---------------------------------------------------------------- dashboards

def _datasource_problems(ref: object, cfg: Config) -> list[str]:
    if isinstance(ref, str):
        if ref in cfg.builtin:
            return []
        return [f"data source {ref!r} by name: reference it as {{type, uid}} with an allowed uid"]
    if not isinstance(ref, dict):
        return []
    uid = ref.get("uid")
    if not isinstance(uid, str):
        return ["data source without a uid"]
    if "$" in uid:
        return [f"data source variable {uid!r}: use a fixed allowed uid"]
    if uid in cfg.builtin:
        return []
    if uid not in cfg.datasources:
        return [f"data source uid {uid!r} is not in observability/datasources.json"]
    want = cfg.datasources[uid]
    if ref.get("type") not in (None, want):
        return [f"data source {uid!r} has type {ref.get('type')!r}, expected {want!r}"]
    return []


def _walk_datasources(node: object, cfg: Config, problems: list[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "datasource":
                problems.extend(_datasource_problems(value, cfg))
            _walk_datasources(value, cfg, problems)
    elif isinstance(node, list):
        for item in node:
            _walk_datasources(item, cfg, problems)


def _iter_panels(panels: list) -> list[dict]:
    out = []
    for panel in panels:
        if isinstance(panel, dict):
            out.append(panel)
            out.extend(_iter_panels(panel.get("panels") or []))
    return out


def _check_dashboard(path: Path, doc: object, cfg: Config, rep: Report) -> tuple[str, str] | None:
    if not isinstance(doc, dict):
        rep.error(path, "not a JSON object")
        return None
    if "apiVersion" in doc:
        api = doc.get("apiVersion")
        if not (isinstance(api, str) and api.startswith("dashboard.grafana.app/")) or doc.get("kind") != "Dashboard":
            rep.error(path, "a wrapped dashboard needs apiVersion dashboard.grafana.app/* and kind Dashboard")
            return None
        spec = doc.get("spec")
        name = (doc.get("metadata") or {}).get("name")
        if not isinstance(spec, dict):
            rep.error(path, "a wrapped dashboard needs a spec object")
            return None
        if spec.get("uid") not in (None, name):
            rep.error(path, f"metadata.name {name!r} and spec.uid {spec.get('uid')!r} differ")
        dash, uid = spec, name
    else:
        dash, uid = doc, doc.get("uid")
        for key, kind in (("panels", list), ("schemaVersion", int), ("tags", list)):
            if not isinstance(dash.get(key), kind):
                rep.error(path, f"{key!r} is required ({kind.__name__}): Git Sync recognises classic dashboard JSON by panels, schemaVersion and tags")
    if not isinstance(uid, str) or not UID_RE.match(uid) or len(uid) > UID_MAX:
        rep.error(path, f"uid {uid!r} must match {UID_RE.pattern} and be at most {UID_MAX} characters")
        uid = None
    title = dash.get("title")
    if not isinstance(title, str) or not title.strip():
        rep.error(path, "title is required")
    if dash.get("id") is not None:
        rep.error(path, "remove the numeric dashboard id: Grafana assigns it, the uid is the identity")
    for var in (dash.get("templating") or {}).get("list") or []:
        if isinstance(var, dict) and var.get("type") == "datasource":
            rep.error(path, f"data source variable {var.get('name')!r}: use fixed allowed uids")

    problems: list[str] = []
    _walk_datasources(dash, cfg, problems)
    for problem in dict.fromkeys(problems):
        rep.error(path, problem)

    panels = _iter_panels(dash.get("panels") or [])
    ids = [p.get("id") for p in panels]
    if any(not isinstance(i, int) for i in ids) or len(set(ids)) != len(ids):
        rep.error(path, "every panel needs a unique integer id")
    for panel in panels:
        label = f"panel {panel.get('title')!r}"
        panel_ds = panel.get("datasource")
        for target in panel.get("targets") or []:
            ds = target.get("datasource") or panel_ds
            if ds is None:
                rep.error(path, f"{label}: a query without a data source would use the default one")
                continue
            uid_ = ds.get("uid") if isinstance(ds, dict) else ds
            if uid_ == "-- Mixed --" and target.get("datasource") is None:
                rep.error(path, f"{label}: a query in a mixed panel needs its own data source")
            is_sql = cfg.datasources.get(uid_) == "grafana-postgresql-datasource"
            if is_sql or "rawSql" in target:
                for problem in check_sql(target.get("rawSql"), cfg.views):
                    rep.error(path, f"{label}, query {target.get('refId')}: {problem}")
    return (uid, title) if uid else None


def _check_folder(path: Path, doc: object, rep: Report) -> str | None:
    if not isinstance(doc, dict):
        rep.error(path, "not a JSON object")
        return None
    api = doc.get("apiVersion")
    if not (isinstance(api, str) and api.startswith("folder.grafana.app/")) or doc.get("kind") != "Folder":
        rep.error(path, "_folder.json needs apiVersion folder.grafana.app/* and kind Folder")
    uid = (doc.get("metadata") or {}).get("name")
    if not isinstance(uid, str) or not UID_RE.match(uid) or len(uid) > UID_MAX:
        rep.error(path, f"metadata.name {uid!r} must match {UID_RE.pattern} and be at most {UID_MAX} characters")
        uid = None
    title = (doc.get("spec") or {}).get("title")
    if not isinstance(title, str) or not title.strip():
        rep.error(path, "spec.title is required")
    return uid


def validate_dashboards(root: Path, cfg: Config, rep: Report) -> None:
    base = root / "observability" / "dashboards"
    if not base.is_dir():
        rep.error(base, "missing")
        return
    uids: dict[str, Path] = {}
    titles: dict[tuple[Path, str], Path] = {}
    folders = 0
    dashboards = 0

    def claim(uid: str | None, path: Path) -> None:
        if uid is None:
            return
        if uid in uids:
            rep.error(path, f"uid {uid!r} is also used by {rep._rel(uids[uid])}")
        uids[uid] = path

    for path in sorted(base.rglob("*")):
        rel = path.relative_to(base)
        if path.is_dir():
            folders += 1
            if len(rel.parts) > MAX_FOLDER_DEPTH:
                rep.error(path, f"folders nest at most {MAX_FOLDER_DEPTH} deep in Git Sync")
            if not (path / "_folder.json").is_file():
                rep.error(path, "add a _folder.json so the folder keeps a stable uid")
            continue
        if path.name == ".keep":
            continue
        if path.suffix != ".json":
            rep.error(path, "only dashboard JSON and _folder.json belong under observability/dashboards (Git Sync reads every file)")
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            rep.error(path, f"invalid JSON: {exc}")
            continue
        if path.name == "_folder.json":
            if path.parent == base:
                rep.error(path, "the sync root is the repository's own folder; put _folder.json in a subfolder")
            claim(_check_folder(path, doc, rep), path)
            continue
        if path.parent == base:
            rep.error(path, "put dashboards in a folder (observability/dashboards/<folder>/)")
        dashboards += 1
        found = _check_dashboard(path, doc, cfg, rep)
        if found:
            uid, title = found
            claim(uid, path)
            key = (path.parent, str(title).strip().lower())
            if key in titles:
                rep.error(path, f"title {title!r} is also used by {rep._rel(titles[key])} in the same folder")
            titles[key] = path

    # +1: Git Sync's folder-type sync creates a folder for the repository itself.
    total = 1 + folders + dashboards
    if total > MAX_SYNCED_RESOURCES:
        rep.error(base, f"{total} synced resources (folders + dashboards); Grafana Cloud Free allows {MAX_SYNCED_RESOURCES}")


# -------------------------------------------------------------------- alerts

def _expr_refs(model: dict) -> set[str]:
    kind = model.get("type")
    expression = model.get("expression")
    if kind == "math":
        return set(re.findall(r"\$\{?([A-Za-z][A-Za-z0-9_]*)\}?", str(expression or "")))
    if kind == "classic_conditions":
        refs = set()
        for cond in model.get("conditions") or []:
            refs.update((cond.get("query") or {}).get("params") or [])
        return refs
    return {expression} if isinstance(expression, str) else set()


def _check_model(where: str, path: Path, item: dict, ds_type: str | None, cfg: Config, rep: Report) -> None:
    model = item.get("model")
    ref = item.get("ref_id")
    if not isinstance(model, dict):
        rep.error(path, f"{where}: model must be a mapping")
        return
    if model.get("refId") != ref:
        rep.error(path, f"{where}: model.refId must be {ref!r}")
    ds = model.get("datasource")
    if ds is not None:
        if not isinstance(ds, dict) or ds.get("uid") != item.get("datasource_uid"):
            rep.error(path, f"{where}: model.datasource.uid must equal datasource_uid")
        elif ds_type and ds.get("type") not in (None, ds_type):
            rep.error(path, f"{where}: model.datasource.type must be {ds_type!r}")
    if ds_type == "__expr__":
        kind = model.get("type")
        if kind not in EXPR_TYPES:
            rep.error(path, f"{where}: expression type must be one of {sorted(EXPR_TYPES)}")
        elif kind in ("reduce", "threshold", "resample", "math") and not model.get("expression"):
            rep.error(path, f"{where}: expression is required")
        if kind == "reduce" and model.get("reducer") not in ("last", "mean", "min", "max", "sum", "count", "median"):
            rep.error(path, f"{where}: reducer must be last, mean, min, max, sum, count or median")
        if kind == "threshold":
            conditions = model.get("conditions")
            if not isinstance(conditions, list) or not conditions:
                rep.error(path, f"{where}: a threshold needs conditions")
            for cond in conditions or []:
                ev = (cond or {}).get("evaluator") or {}
                params = ev.get("params")
                if ev.get("type") not in EVALUATORS or not isinstance(params, list) or not params \
                        or not all(isinstance(p, (int, float)) and not isinstance(p, bool) for p in params):
                    rep.error(path, f"{where}: threshold evaluator needs a type in {sorted(EVALUATORS)} and numeric params")
    elif ds_type in ("prometheus", "loki"):
        if not isinstance(model.get("expr"), str) or not model["expr"].strip():
            rep.error(path, f"{where}: expr is required")
    elif ds_type == "tempo":
        if not isinstance(model.get("query"), str) or not model["query"].strip():
            rep.error(path, f"{where}: query is required")
    elif ds_type == "grafana-postgresql-datasource":
        if model.get("format") not in ("table", "time_series"):
            rep.error(path, f"{where}: format must be table or time_series")
        for problem in check_sql(model.get("rawSql"), cfg.views):
            rep.error(path, f"{where}: {problem}")


def _check_rule(path: Path, rule: object, cfg: Config, rep: Report) -> tuple[str | None, str | None, str | None]:
    if not isinstance(rule, dict):
        rep.error(path, "each rule must be a mapping")
        return None, None, None
    uid = rule.get("uid")
    where = f"rule {uid or rule.get('title')!r}"
    for key in sorted(RULE_KEYS - rule.keys()):
        rep.error(path, f"{where}: {key} is required")
    for key in sorted(rule.keys() - RULE_KEYS):
        rep.error(path, f"{where}: unknown key {key!r}")
    if not isinstance(uid, str) or not UID_RE.match(uid) or len(uid) > UID_MAX:
        rep.error(path, f"{where}: uid must match {UID_RE.pattern} and be at most {UID_MAX} characters")
        uid = None
    title = rule.get("title")
    if not isinstance(title, str) or not TITLE_RE.match(title):
        rep.error(path, f"{where}: title must be one CamelCase word (it is the alertname)")
        title = None
    if "for" in rule and parse_duration(rule.get("for")) is None:
        rep.error(path, f"{where}: for {rule.get('for')!r} is not a duration (e.g. 0s, 5m, 1h)")
    if "severity" in rule and rule.get("severity") not in SEVERITIES:
        rep.error(path, f"{where}: severity must be one of {sorted(SEVERITIES)}")
    if "push" in rule and not isinstance(rule.get("push"), bool):
        rep.error(path, f"{where}: push must be true or false (unquoted)")
    summary = rule.get("summary")
    if "summary" in rule and (not isinstance(summary, str) or not summary.strip() or len(summary) > 200):
        rep.error(path, f"{where}: summary must be text of at most 200 characters")
    he = rule.get("summary_he")
    if "summary_he" in rule:
        if not isinstance(he, str) or not HEBREW_RE.search(he) or len(he) > 80:
            rep.error(path, f"{where}: summary_he must be short Hebrew text (at most 80 characters)")
        elif GENDERED_RE.search(he):
            rep.error(path, f"{where}: summary_he must be gender-neutral (rephrase instead of slash forms)")
    runbook = rule.get("runbook")
    if "runbook" in rule and (not isinstance(runbook, str) or not ANCHOR_RE.match(runbook)):
        rep.error(path, f"{where}: runbook must be an anchor name such as app-down")
        runbook = None
    if "no_data_state" in rule and rule.get("no_data_state") not in NO_DATA_STATES:
        rep.error(path, f"{where}: no_data_state must be one of {sorted(NO_DATA_STATES)}")
    if "exec_err_state" in rule and rule.get("exec_err_state") not in EXEC_ERR_STATES:
        rep.error(path, f"{where}: exec_err_state must be one of {sorted(EXEC_ERR_STATES)}")

    data = rule.get("data")
    if not isinstance(data, list) or not data:
        rep.error(path, f"{where}: data must be a non-empty list")
        return uid, title, runbook
    refs: dict[str, str | None] = {}
    for item in data:
        if not isinstance(item, dict):
            rep.error(path, f"{where}: each data entry must be a mapping")
            continue
        ref = item.get("ref_id")
        qwhere = f"{where}, query {ref}"
        for key in sorted(DATA_KEYS - item.keys()):
            rep.error(path, f"{qwhere}: {key} is required")
        for key in sorted(item.keys() - DATA_KEYS):
            rep.error(path, f"{qwhere}: unknown key {key!r}")
        if not isinstance(ref, str) or not REF_RE.match(ref) or ref in refs:
            rep.error(path, f"{qwhere}: ref_id must be a unique name such as A")
            continue
        ds_uid = item.get("datasource_uid")
        if ds_uid == "__expr__":
            ds_type = "__expr__"
        elif ds_uid in cfg.datasources:
            ds_type = cfg.datasources[ds_uid]
        else:
            rep.error(path, f"{qwhere}: datasource_uid {ds_uid!r} is not in observability/datasources.json")
            ds_type = None
        refs[ref] = ds_type
        rtr = item.get("relative_time_range")
        if not isinstance(rtr, dict) or set(rtr) != {"from", "to"} \
                or not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in rtr.values()) \
                or rtr["from"] < rtr["to"] or (ds_type not in ("__expr__", None) and rtr["from"] == 0):
            rep.error(path, f"{qwhere}: relative_time_range needs integer seconds from >= to (from > 0 for a query)")
        _check_model(qwhere, path, item, ds_type, cfg, rep)
    for item in data:
        if isinstance(item, dict) and item.get("datasource_uid") == "__expr__" and isinstance(item.get("model"), dict):
            for target in _expr_refs(item["model"]):
                if target not in refs or target == item.get("ref_id"):
                    rep.error(path, f"{where}, query {item.get('ref_id')}: refers to unknown query {target!r}")
    if not any(t not in ("__expr__", None) for t in refs.values()):
        rep.error(path, f"{where}: needs at least one data source query")
    condition = rule.get("condition")
    if condition not in refs:
        rep.error(path, f"{where}: condition {condition!r} is not one of its ref_ids")
    elif refs[condition] != "__expr__":
        rep.error(path, f"{where}: condition must be an expression (reduce, threshold or math)")
    return uid, title, runbook


def validate_alerts(root: Path, cfg: Config, rep: Report) -> set[str]:
    base = root / "observability" / "alerts"
    files = sorted(list(base.glob("*.yaml")) + list(base.glob("*.yml")))
    if not files:
        rep.error(base, "no alert rule files")
    uids: dict[str, Path] = {}
    titles: dict[str, Path] = {}
    anchors: set[str] = set()
    for path in files:
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            rep.error(path, f"invalid YAML: {exc}")
            continue
        if not isinstance(doc, dict):
            rep.error(path, "must be a mapping with group, interval and rules")
            continue
        for key in sorted(doc.keys() - {"group", "interval", "rules"}):
            rep.error(path, f"unknown key {key!r}")
        group = doc.get("group")
        if not isinstance(group, str) or not GROUP_RE.match(group) or group != path.stem:
            rep.error(path, f"group must be {path.stem!r} (one rule group per file, named like the file)")
        interval = parse_duration(doc.get("interval"))
        if not interval or interval % 10:
            rep.error(path, "interval must be a duration that is a multiple of 10s (e.g. 1m)")
        rules = doc.get("rules")
        if not isinstance(rules, list) or not rules:
            rep.error(path, "rules must be a non-empty list")
            continue
        for rule in rules:
            uid, title, runbook = _check_rule(path, rule, cfg, rep)
            if uid:
                if uid in uids:
                    rep.error(path, f"rule uid {uid!r} is also used in {rep._rel(uids[uid])}")
                uids[uid] = path
            if title:
                if title in titles:
                    rep.error(path, f"rule title {title!r} is also used in {rep._rel(titles[title])}")
                titles[title] = path
            if runbook:
                anchors.add(runbook)
    return anchors


def check_runbooks(root: Path, anchors: set[str], rep: Report) -> None:
    doc = root / "docs" / "setup.md"
    text = doc.read_text(encoding="utf-8") if doc.is_file() else ""
    for anchor in sorted(anchors):
        if not re.search(r"runbook-" + re.escape(anchor) + r"(?![a-z0-9-])", text):
            rep.warn(doc, f'no anchor "runbook-{anchor}" (add <a id="runbook-{anchor}"></a> to the runbook section)')


# ------------------------------------------------------ policies and mutes

def validate_mute_timings(root: Path, rep: Report) -> set[str]:
    path = root / "observability" / "alerting" / "mute-timings.yaml"
    if not path.is_file():
        rep.error(path, "missing (it may be an empty list: [])")
        return set()
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        rep.error(path, f"invalid YAML: {exc}")
        return set()
    if doc is None:
        doc = []
    if not isinstance(doc, list):
        rep.error(path, "must be a list of mute timings")
        return set()
    names: set[str] = set()
    for timing in doc:
        if not isinstance(timing, dict) or set(timing) != {"name", "intervals"}:
            rep.error(path, "each mute timing has exactly name and intervals")
            continue
        name = timing["name"]
        if not isinstance(name, str) or not GROUP_RE.match(name) or name in names:
            rep.error(path, f"mute timing name {name!r} must be unique, lowercase and dash-separated")
            continue
        names.add(name)
        intervals = timing["intervals"]
        if not isinstance(intervals, list) or not intervals:
            rep.error(path, f"{name}: intervals must be a non-empty list")
            continue
        for interval in intervals:
            if not isinstance(interval, dict) or not interval or interval.keys() - INTERVAL_KEYS:
                rep.error(path, f"{name}: an interval may only have {sorted(INTERVAL_KEYS)}")
                continue
            for t in interval.get("times") or []:
                if not isinstance(t, dict) or set(t) != {"start", "end"} \
                        or not all(isinstance(v, str) and HHMM_RE.match(v) for v in t.values()):
                    rep.error(path, f"{name}: times need start and end as \"HH:MM\"")
            for day in interval.get("weekdays") or []:
                base_days = str(day).split(":")
                if not all(d in WEEKDAYS for d in base_days):
                    rep.error(path, f"{name}: unknown weekday {day!r}")
    return names


def _check_route(path: Path, route: object, where: str, is_root: bool, cfg: Config, mutes: set[str], rep: Report) -> None:
    if not isinstance(route, dict):
        rep.error(path, f"{where}: must be a mapping")
        return
    allowed = ROOT_POLICY_KEYS if is_root else ROUTE_KEYS
    for key in sorted(route.keys() - allowed):
        rep.error(path, f"{where}: unknown key {key!r}")
    receiver = route.get("receiver")
    if is_root and receiver is None:
        rep.error(path, "the root policy needs a receiver")
    if receiver is not None and receiver not in cfg.receivers:
        rep.error(path, f"{where}: receiver {receiver!r} is not a contact point ({', '.join(sorted(cfg.receivers))})")
    for key in ("group_wait", "group_interval", "repeat_interval"):
        if key in route and not parse_duration(route[key]):
            rep.error(path, f"{where}: {key} {route[key]!r} is not a duration")
    if "group_by" in route and (not isinstance(route["group_by"], list)
                                or not all(isinstance(x, str) for x in route["group_by"])):
        rep.error(path, f"{where}: group_by must be a list of label names")
    if "continue" in route and not isinstance(route["continue"], bool):
        rep.error(path, f"{where}: continue must be true or false")
    for name in route.get("mute_timings") or []:
        if name not in mutes:
            rep.error(path, f"{where}: mute timing {name!r} is not in mute-timings.yaml")
    for matcher in route.get("matchers") or []:
        if not isinstance(matcher, dict) or set(matcher) != {"label", "match", "value"}:
            rep.error(path, f"{where}: a matcher has exactly label, match and value")
            continue
        if matcher["match"] not in MATCH_OPS:
            rep.error(path, f"{where}: match must be one of {sorted(MATCH_OPS)}")
        if not isinstance(matcher["label"], str) or not isinstance(matcher["value"], str):
            rep.error(path, f"{where}: matcher label and value must be quoted strings")
        elif matcher["label"] == "push" and matcher["value"] not in ("true", "false"):
            rep.error(path, f"{where}: the push label is \"true\" or \"false\"")
        elif matcher["label"] == "severity" and matcher["match"] == "=" and matcher["value"] not in SEVERITIES:
            rep.error(path, f"{where}: severity is one of {sorted(SEVERITIES)}")
    if not is_root and "matchers" not in route and route.get("continue"):
        rep.error(path, f"{where}: a catch-all route with continue: true repeats every alert")
    for i, child in enumerate(route.get("routes") or []):
        _check_route(path, child, f"{where} > routes[{i}]", False, cfg, mutes, rep)


def validate_policies(root: Path, cfg: Config, mutes: set[str], rep: Report) -> set[str]:
    path = root / "observability" / "alerting" / "policies.yaml"
    if not path.is_file():
        rep.error(path, "missing")
        return set()
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        rep.error(path, f"invalid YAML: {exc}")
        return set()
    _check_route(path, doc, "root", True, cfg, mutes, rep)
    used: set[str] = set()

    def collect(route: object) -> None:
        if isinstance(route, dict):
            if isinstance(route.get("receiver"), str):
                used.add(route["receiver"])
            for child in route.get("routes") or []:
                collect(child)

    collect(doc)
    return used


def check_receivers_in_hcl(root: Path, receivers: set[str], rep: Report) -> None:
    module = root / "infra" / "modules" / "observability"
    files = sorted(module.rglob("*.tf")) if module.is_dir() else []
    if not files:
        rep.warn(module, "no HCL yet: contact point names not cross-checked")
        return
    text = "\n".join(f.read_text(encoding="utf-8") for f in files)
    for receiver in sorted(receivers):
        if not re.search(r'\bname\s*=\s*"' + re.escape(receiver) + '"', text):
            rep.warn(module, f'no contact point with name = "{receiver}"')


# ---------------------------------------------------------------------- main

def validate(root: Path) -> Report:
    rep = Report(root)
    try:
        cfg = load_config(root)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        rep.error(root / "observability" / "datasources.json", f"cannot read: {exc}")
        return rep
    validate_dashboards(root, cfg, rep)
    anchors = validate_alerts(root, cfg, rep)
    check_runbooks(root, anchors, rep)
    mutes = validate_mute_timings(root, rep)
    used = validate_policies(root, cfg, mutes, rep)
    check_receivers_in_hcl(root, used, rep)
    return rep


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2],
                        help="repository root (default: this checkout)")
    parser.add_argument("--strict", action="store_true",
                        help="treat warnings (runbook anchors, contact points in HCL) as errors")
    args = parser.parse_args(argv)
    rep = validate(args.root.resolve())
    annotate = os.environ.get("GITHUB_ACTIONS") == "true"
    warn_level = "error" if args.strict else "warning"
    for msg in rep.errors:
        print(f"::error::{msg}" if annotate else f"error: {msg}")
    for msg in rep.warnings:
        print(f"::{warn_level}::{msg}" if annotate else f"{warn_level}: {msg}")
    failed = bool(rep.errors) or (args.strict and bool(rep.warnings))
    print(f"observability: {len(rep.errors)} errors, {len(rep.warnings)} warnings"
          + (" (strict)" if args.strict else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
