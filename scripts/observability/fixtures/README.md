Classic dashboards for `test_validate.py`, copied from `observability/dashboards`
when they were still classic JSON. The tests edit these, never the live files,
so a Grafana UI save (which rewrites a live file as v2) cannot break them.
