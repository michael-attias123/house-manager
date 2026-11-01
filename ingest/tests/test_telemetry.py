"""house_ingest.telemetry: off without env, allow-listed spans and gauges, redaction,
and an export that fails or hangs never breaks the run."""

import json
import math
import re
import shutil
import time
from pathlib import Path

import pytest
from opentelemetry.sdk.metrics.export import (
    MetricExporter,
    MetricExportResult,
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from house_ingest import fetch, telemetry
from house_ingest.__main__ import main
from house_ingest.parse import parse_prices, parse_stores

FIXTURES = Path(__file__).parent / "fixtures"
HEBREW = re.compile(r"[֐-׿]")
GAUGES = {
    "house_ingest_items": {"chain"},
    "house_ingest_stores_failed": {"chain"},
    "house_ingest_chain_seconds": {"chain"},
    "house_ingest_run_status": {"status"},
}


class ListMetricExporter(MetricExporter):
    def __init__(self):
        super().__init__()
        self.batches = []

    def export(self, metrics_data, timeout_millis=10_000, **kwargs):
        self.batches.append(metrics_data)
        return MetricExportResult.SUCCESS

    def force_flush(self, timeout_millis=10_000):
        return True

    def shutdown(self, timeout_millis=30_000, **kwargs):
        pass

    def points(self):
        """{(metric name, frozenset(labels)): value} from everything exported."""
        out = {}
        for data in self.batches:
            for rm in data.resource_metrics:
                for sm in rm.scope_metrics:
                    for metric in sm.metrics:
                        assert metric.unit == ""
                        for p in metric.data.data_points:
                            out[(metric.name, frozenset(p.attributes.items()))] = p.value
        return out


class BrokenSpanExporter(SpanExporter):
    def export(self, spans):
        raise ConnectionError("collector at https://otlp.example.com/v1/traces?token=abc refused")

    def shutdown(self):
        pass


class BrokenMetricExporter(ListMetricExporter):
    def export(self, metrics_data, timeout_millis=10_000, **kwargs):
        raise ConnectionError("refused")


class SlowSpanExporter(SpanExporter):
    def export(self, spans):
        time.sleep(5)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        pass


@pytest.fixture(autouse=True)
def reset_telemetry():
    telemetry._active = None
    yield
    telemetry._active = None


def use_exporters(monkeypatch, spans, metrics):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp.example.com/otlp")
    monkeypatch.setattr(
        telemetry,
        "_exporters",
        lambda: (spans, PeriodicExportingMetricReader(metrics, export_interval_millis=math.inf)),
    )


def fake_download(monkeypatch):
    """fetch.download copies the fixtures instead of calling the scraper."""

    def download(chains, file_type, regex, out_dir, timeout=1500):
        for chain in chains:
            target = out_dir / chain.id
            target.mkdir(parents=True, exist_ok=True)
            for f in (FIXTURES / chain.id).iterdir():
                shutil.copy(f, target / f.name)

    monkeypatch.setattr(fetch, "download", download)
    monkeypatch.setattr(fetch, "folder_for", lambda chain, out_dir: out_dir / chain.id)


def fixture_names():
    """Every store and product name in the fixtures: none may reach telemetry."""
    names = set()
    for f in FIXTURES.glob("*/Stores*.xml"):
        names |= {s.name for s in parse_stores(f.read_bytes())}
    for f in FIXTURES.glob("*/PriceFull*.xml"):
        names |= {p.name for p in parse_prices(f.read_bytes(), f.parent.name)}
    return {n for n in names if n}


def all_text(span):
    yield span.name
    yield str(span.status.description or "")
    for k, v in span.attributes.items():
        yield f"{k}={v}"
    for event in span.events:
        yield event.name
        for k, v in event.attributes.items():
            yield f"{k}={v}"


def run(tmp_path, *extra):
    return main(["run", "--chains", "shufersal,rami_levy", "--dry-run", "--work-dir", str(tmp_path), *extra])


# --- off ------------------------------------------------------------------------


def test_noop_without_endpoint(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    def no_exporters():
        raise AssertionError("exporters built without an endpoint")

    monkeypatch.setattr(telemetry, "_exporters", no_exporters)
    assert telemetry.start({"OTEL_EXPORTER_OTLP_ENDPOINT": "  "}) is False
    assert run(tmp_path, "--from-dir", str(FIXTURES)) == 0
    assert not telemetry.enabled()
    with telemetry.span("store", store_code="1") as span:
        span.set(items=3)
    telemetry.record_chain("x", 1, 0, 1.0)
    telemetry.finish("ok")

    # The per-chain seconds are in the stats either way, next to the existing keys.
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "partial"
    for chain in ("shufersal", "rami_levy"):
        assert isinstance(out["chains"][chain]["seconds"], float)
    assert out["chains"]["shufersal"]["stores"]["277"]["error"] == "no PriceFull file"
    assert out["chains"]["rami_levy"]["stores"]["39"]["items"] == 3


# --- spans and gauges -------------------------------------------------------------


def test_spans_and_gauges_use_only_the_allow_list(monkeypatch, tmp_path, capsys):
    spans, metrics = InMemorySpanExporter(), ListMetricExporter()
    use_exporters(monkeypatch, spans, metrics)
    fake_download(monkeypatch)
    assert run(tmp_path) == 0
    capsys.readouterr()

    finished = spans.get_finished_spans()
    names = sorted(s.name for s in finished)
    assert names == sorted(
        ["ingest.run", "download", "download", "chain:shufersal", "chain:rami_levy", "store", "store", "store"]
    )
    by_id = {s.context.span_id: s for s in finished}
    for s in finished:
        parent = by_id[s.parent.span_id].name if s.parent else None
        if s.name == "ingest.run":
            assert parent is None
        elif s.name == "store":
            assert parent.startswith("chain:")
        else:
            assert parent == "ingest.run", s.name
        assert set(s.attributes) <= telemetry.ATTRIBUTES, s.attributes
        assert not s.events
        assert s.resource.attributes["service.name"] == "house-ingest"

    attrs = {(s.name, s.attributes.get("store_code")): dict(s.attributes) for s in finished}
    assert attrs[("ingest.run", None)] == {"status": "partial"}
    assert attrs[("chain:shufersal", None)] == {"chain_id": "shufersal", "items": 3, "status": "partial"}
    assert attrs[("store", "277")] == {"chain_id": "shufersal", "store_code": "277", "status": "failed"}
    assert attrs[("store", "39")] == {"chain_id": "rami_levy", "store_code": "39", "items": 3, "status": "ok"}

    secret_names = fixture_names()
    assert secret_names
    for s in finished:
        for text in all_text(s):
            assert not HEBREW.search(text), text
            assert not any(n in text for n in secret_names), text

    points = metrics.points()
    assert {name for name, _ in points} == set(GAUGES)
    for name, labels in points:
        assert {k for k, _ in labels} == GAUGES[name]
    assert points[("house_ingest_items", frozenset({("chain", "shufersal")}))] == 3
    assert points[("house_ingest_stores_failed", frozenset({("chain", "shufersal")}))] == 1
    assert points[("house_ingest_stores_failed", frozenset({("chain", "rami_levy")}))] == 0
    assert points[("house_ingest_run_status", frozenset({("status", "partial")}))] == 1
    assert points[("house_ingest_run_status", frozenset({("status", "ok")}))] == 0
    assert len([p for p in points if p[0] == "house_ingest_run_status"]) == 4


def test_an_exception_is_recorded_redacted_and_re_raised(monkeypatch, tmp_path, capsys):
    spans, metrics = InMemorySpanExporter(), ListMetricExporter()
    use_exporters(monkeypatch, spans, metrics)

    def broken(data, chain_id):
        raise ValueError(
            'duplicate key: Key (barcode)=(7290000000001) for "שופרסל דיל" at postgresql://u:pw@db.example.com/postgres'
        )

    monkeypatch.setattr("house_ingest.__main__.parse_prices", broken)
    with pytest.raises(ValueError):
        run(tmp_path, "--from-dir", str(FIXTURES))
    capsys.readouterr()

    finished = {(s.name, s.attributes.get("store_code")): s for s in spans.get_finished_spans()}
    store = finished[("store", "413")]
    assert store.attributes["status"] == "error"
    assert store.status.description == "duplicate key: Key [str]=[str] for [str] at [db-url]"
    [event] = store.events
    assert dict(event.attributes) == {
        "exception.type": "ValueError",
        "exception.message": "duplicate key: Key [str]=[str] for [str] at [db-url]",
    }
    assert finished[("store", "277")].attributes["status"] == "failed"
    assert finished[("chain:shufersal", None)].attributes["status"] == "error"
    assert finished[("ingest.run", None)].attributes["status"] == "error"
    points = metrics.points()
    assert points[("house_ingest_run_status", frozenset({("status", "error")}))] == 1


def test_span_and_chain_names_are_sanitized(monkeypatch):
    spans, metrics = InMemorySpanExporter(), ListMetricExporter()
    use_exporters(monkeypatch, spans, metrics)
    assert telemetry.start()
    with telemetry.span("chain:Rami Levy/באר") as span:
        span.set(chain_id="Rami Levy", name="שופרסל", store_code="12345678901234567890", status="weird", items="7")
    with telemetry.span("שופרסל"):
        pass
    telemetry.finish("weird")
    first, second = spans.get_finished_spans()
    assert first.name == "chain:rami_levy____"
    assert dict(first.attributes) == {
        "chain_id": "rami_levy",
        "store_code": "1234567890123456",
        "status": "error",
        "items": 7,
    }
    assert second.name == "other"


# --- redaction ------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("mail dana.k+x@example.co.il failed", "mail [email] failed"),
        ("row 3f2b8c1e-0a4d-4e8f-9b7a-1c2d3e4f5a6b gone", "row [id] gone"),
        ("store שופרסל דיל באר-שבע closed", "store [he] closed"),
        ('value "Tnuva milk" too long', "value [str] too long"),
        ("value 'secret' too long", "value [str] too long"),
        ("Key (store_id, barcode)=(12, 7290000000001) exists", "Key [str]=[str] exists"),
        ("timeout after 1500 seconds, 3 retries", "timeout after [n] seconds, 3 retries"),
        (
            "could not connect to postgresql://postgres.ref:hunter2@aws-0.pooler.supabase.com:5432/postgres now",
            "could not connect to [db-url] now",
        ),
        ("POSTGRES://user:pw@host/db", "[db-url]"),
        ("GET https://prices.example.com/file.gz?code=abc#x failed", "GET https://prices.example.com/file.gz failed"),
        ("", ""),
    ],
)
def test_redact(text, expected):
    assert telemetry.redact(text) == expected


def test_redact_cuts_to_200_characters():
    assert len(telemetry.redact("x" * 500)) == 200
    assert telemetry.redact(ValueError("bad 'x'")) == "bad [str]"


# --- export failures --------------------------------------------------------------


def test_failing_exporters_do_not_raise(monkeypatch, tmp_path, capsys):
    use_exporters(monkeypatch, BrokenSpanExporter(), BrokenMetricExporter())
    assert run(tmp_path, "--from-dir", str(FIXTURES)) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "partial"


def test_a_hanging_export_is_abandoned(monkeypatch):
    use_exporters(monkeypatch, SlowSpanExporter(), ListMetricExporter())
    assert telemetry.start()
    with telemetry.span("ingest.run"):
        pass
    started = time.monotonic()
    telemetry.finish("ok", timeout_s=0.5)
    assert time.monotonic() - started < 2


def test_setup_failure_turns_telemetry_off(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp.example.com/otlp")

    def broken():
        raise ImportError("no exporter")

    monkeypatch.setattr(telemetry, "_exporters", broken)
    assert telemetry.start() is False
    assert run(tmp_path, "--from-dir", str(FIXTURES)) == 0
    capsys.readouterr()
