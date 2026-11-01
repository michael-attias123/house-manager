"""OpenTelemetry for the price ingest: spans per chain and store, and a few gauges.

Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (prices.yml maps it from the
GRAFANA_OTLP_* secrets; OTEL_EXPORTER_OTLP_HEADERS carries the auth). Then:

  ingest.run
    download            (Stores files, then PriceFull files)
    chain:<id>
      store             one per branch

Attributes are an allow-list: chain_id, store_code, items, status. Store and
product names never leave the process; exception text goes through redact().
Gauges (no unit suffix, one data point each, sent at the end):
house_ingest_items{chain}, house_ingest_stores_failed{chain},
house_ingest_chain_seconds{chain}, house_ingest_run_status{status}.

Nothing here may fail or slow the ingest: every call is wrapped, exports have
short timeouts, and everything is sent once by finish(), which waits at most
FLUSH_TIMEOUT_S.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

log = logging.getLogger(__name__)

SERVICE_NAME = "house-ingest"
EXPORT_TIMEOUT_S = 5
FLUSH_TIMEOUT_S = 15

SPAN_NAMES = {"ingest.run", "download", "store"}  # plus chain:<id>
ATTRIBUTES = {"chain_id", "store_code", "items", "status"}
EXCEPTION_ATTRIBUTES = {"exception.type", "exception.message"}
# Run, chain, store and download status; "error" is an exception.
STATUSES = ("ok", "partial", "failed", "error")


# --- redaction (the same rules as web/src/lib/telemetry/redact.ts) ---------

_HEBREW = "֐-׿יִ-ﭏ"
_REDACTIONS: list[tuple[re.Pattern[str], Any]] = [
    (re.compile(r"postgres(?:ql)?://\S+", re.IGNORECASE), "[db-url]"),
    # Any other URL keeps its origin and path; the query and hash go.
    (re.compile(r"(https?://[^\s?#\"'<>]*)[?#]\S*", re.IGNORECASE), r"\1"),
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE), "[id]"),
    (re.compile(r"\"[^\"]*\"|'[^']*'|“[^”]*”|\([^()]*\)"), "[str]"),
    (re.compile(rf"[{_HEBREW}]+(?:[\s\"'׳״-]+[{_HEBREW}]+)*"), "[he]"),
    (re.compile(r"\d{2,}"), "[n]"),
]
MAX_TEXT = 200


def redact(text: object) -> str:
    """Exception text without addresses, ids, names, values or DB URLs; at most 200 characters."""
    try:
        out = str(text)
        for pattern, repl in _REDACTIONS:
            out = pattern.sub(repl, out)
        return out[:MAX_TEXT]
    except Exception:
        return "[unreadable]"


def _chain_slug(chain_id: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", str(chain_id).lower())[:32] or "unknown"


def _span_name(name: str) -> str:
    if name in SPAN_NAMES:
        return name
    if name.startswith("chain:"):
        return "chain:" + _chain_slug(name[len("chain:") :])
    return "other"


def _clean(attrs: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in attrs.items():
        if key not in ATTRIBUTES or value is None:
            continue
        if key == "status":
            value = value if value in STATUSES else "error"
        elif key == "chain_id":
            value = _chain_slug(value)
        elif key == "items":
            value = int(value)
        else:
            value = str(value)[:16]
        out[key] = value
    return out


# --- spans ------------------------------------------------------------------


class _NoopSpan:
    def set(self, **attrs: Any) -> None:
        pass


class _Span:
    def __init__(self, span: Any):
        self._span = span

    def set(self, **attrs: Any) -> None:
        try:
            self._span.set_attributes(_clean(attrs))
        except Exception:
            pass

    def fail(self, error: BaseException) -> None:
        try:
            from opentelemetry.trace import Status, StatusCode

            message = redact(error)
            self._span.set_attribute("status", "error")
            self._span.add_event(
                "exception", {"exception.type": type(error).__name__, "exception.message": message}
            )
            self._span.set_status(Status(StatusCode.ERROR, message))
        except Exception:
            pass


@dataclass
class _ChainMetrics:
    items: int = 0
    stores_failed: int = 0
    seconds: float = 0.0


@dataclass
class _Telemetry:
    tracer_provider: Any
    meter_provider: Any
    tracer: Any
    chains: dict[str, _ChainMetrics] = field(default_factory=dict)


_active: _Telemetry | None = None


def _exporters() -> tuple[Any, Any]:
    """(span exporter, metric reader). Tests replace this with in-memory ones."""
    import math

    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

    # Both read OTEL_EXPORTER_OTLP_ENDPOINT (+ /v1/traces, /v1/metrics) and
    # OTEL_EXPORTER_OTLP_HEADERS from the environment.
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(timeout=EXPORT_TIMEOUT_S),
        # No background thread: finish() collects once.
        export_interval_millis=math.inf,
        export_timeout_millis=EXPORT_TIMEOUT_S * 1000,
    )
    return OTLPSpanExporter(timeout=EXPORT_TIMEOUT_S), reader


def enabled() -> bool:
    return _active is not None


def start(env: dict[str, str] | None = None) -> bool:
    """Turns telemetry on if OTEL_EXPORTER_OTLP_ENDPOINT is set. Returns whether it is on."""
    global _active
    env = os.environ if env is None else env
    if _active is not None or not (env.get("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip():
        return _active is not None
    try:
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        # The exporters' retry warnings name the collector host; the logs are public.
        logging.getLogger("opentelemetry").setLevel(logging.ERROR)
        span_exporter, metric_reader = _exporters()
        resource = Resource.create({"service.name": (env.get("OTEL_SERVICE_NAME") or "").strip() or SERVICE_NAME})
        tracer_provider = TracerProvider(resource=resource, shutdown_on_exit=False)
        # Exports only on finish(): the delay is longer than any run.
        tracer_provider.add_span_processor(
            BatchSpanProcessor(
                span_exporter,
                schedule_delay_millis=3_600_000,
                max_queue_size=4096,
                max_export_batch_size=512,
                export_timeout_millis=EXPORT_TIMEOUT_S * 1000,
            )
        )
        meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader], shutdown_on_exit=False)
        _active = _Telemetry(tracer_provider, meter_provider, tracer_provider.get_tracer("house_ingest"))
        log.info("telemetry: on")
    except Exception as error:
        log.warning("telemetry: off (%s)", type(error).__name__)
        _active = None
    return _active is not None


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[_Span | _NoopSpan]:
    """A span around a block. An exception in the block is recorded (redacted) and re-raised."""
    t = _active
    cm = None
    handle: _Span | _NoopSpan = _NoopSpan()
    if t is not None:
        try:
            cm = t.tracer.start_as_current_span(
                _span_name(name), record_exception=False, set_status_on_exception=False
            )
            handle = _Span(cm.__enter__())
            handle.set(**attrs)
        except Exception:
            cm, handle = None, _NoopSpan()
    try:
        yield handle
    except BaseException as error:
        if isinstance(handle, _Span):
            handle.fail(error)
        raise
    finally:
        if cm is not None:
            try:
                cm.__exit__(None, None, None)
            except Exception:
                pass


def record_chain(chain_id: str, items: int, stores_failed: int, seconds: float) -> None:
    """Values for the per-chain gauges, sent by finish()."""
    t = _active
    if t is None:
        return
    try:
        t.chains[_chain_slug(chain_id)] = _ChainMetrics(int(items), int(stores_failed), round(float(seconds), 1))
    except Exception:
        pass


def finish(status: str, timeout_s: float = FLUSH_TIMEOUT_S) -> None:
    """Sets the gauges and sends everything once. Never raises; waits at most timeout_s."""
    global _active
    t, _active = _active, None
    if t is None:
        return
    try:
        meter = t.meter_provider.get_meter("house_ingest")
        items = meter.create_gauge("house_ingest_items", unit="", description="Prices loaded per chain, last run")
        failed = meter.create_gauge(
            "house_ingest_stores_failed", unit="", description="Stores without prices per chain, last run"
        )
        seconds = meter.create_gauge(
            "house_ingest_chain_seconds", unit="", description="Seconds spent on each chain after download, last run"
        )
        run_status = meter.create_gauge(
            "house_ingest_run_status", unit="", description="1 for the last run's status, 0 for the others"
        )
        for chain, m in t.chains.items():
            items.set(m.items, {"chain": chain})
            failed.set(m.stores_failed, {"chain": chain})
            seconds.set(m.seconds, {"chain": chain})
        status = status if status in STATUSES else "error"
        for s in STATUSES:
            run_status.set(1 if s == status else 0, {"status": s})
    except Exception as error:
        log.warning("telemetry: gauges skipped (%s)", type(error).__name__)

    def flush() -> None:
        for step in (
            lambda: t.tracer_provider.force_flush(int(timeout_s * 1000)),
            lambda: t.meter_provider.force_flush(int(timeout_s * 1000)),
            lambda: t.tracer_provider.shutdown(),
            lambda: t.meter_provider.shutdown(timeout_millis=int(timeout_s * 1000)),
        ):
            try:
                step()
            except Exception as error:
                log.warning("telemetry: export failed (%s)", type(error).__name__)

    # A daemon thread, so a hanging export can't hold the process past timeout_s.
    worker = threading.Thread(target=flush, name="telemetry-flush", daemon=True)
    try:
        worker.start()
        worker.join(timeout_s)
        if worker.is_alive():
            log.warning("telemetry: export still running after %ss; giving up", timeout_s)
    except Exception as error:
        log.warning("telemetry: export failed (%s)", type(error).__name__)
