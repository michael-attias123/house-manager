# observability

Grafana dashboards and alerting for house-manager, managed the GitOps way:
git is the only source of truth, and nothing is edited in place in Grafana.

```
datasources.json                   the data source uids (and SQL views) files may use
dashboards/house-manager/          synced by Grafana Git Sync (pull)
  _folder.json                     the "House manager" folder: stable uid hm-house-manager
  overview.json frontend.json      dashboards, uids hm-overview, hm-frontend,
  database.json jobs.json            hm-database, hm-jobs
alerts/<group>.yaml                one alert rule group per file  } rendered by infra
alerting/policies.yaml             the notification policy tree   } module.observability,
alerting/mute-timings.yaml         mute timings (may be [])       } applied by the reconciler
```

`scripts/observability/validate.py` checks all of it in CI (the
`observability` job). Run it before pushing:

```bash
python scripts/observability/validate.py          # --strict also fails on warnings
python -m pytest scripts/observability
```

## How changes reach Grafana

| What | Mechanism | Delay |
|---|---|---|
| Dashboards, the folder | Grafana **Git Sync** pulls `observability/dashboards` from `main` (GitHub webhook, 60 s poll as fallback). | seconds |
| Alert rules, policy, mute timings | `.github/workflows/observability-sync.yml` calls shared-platform's `tofu-stack.yml`: a plan targeting `module.observability` and `module.uptime`, a guard (`tools/plan_guard.py`) that refuses any change outside those modules, then the saved plan is applied. Runs on a push to `main` that touches `observability/**`, every 30 minutes, and from the Actions tab. Its own concurrency group; the state lock keeps it and `infra.yml` from writing at once. A plan that fails only on Grafana server errors (5xx, 429, timeouts: `tools/transient.py`) is retried once; on a scheduled run it then ends with a warning and the next run catches up. It fails when no run has reached Grafana for 6 hours (`tools/last_reached.sh`). | minutes |
| Contact points (`email-owner`, `app-push`) | HCL in `infra/modules/observability` (they hold secrets), applied by `infra.yml`. | on merge |

Rules, the policy and mute timings are **provisioned**, so the Grafana UI shows
them read-only. A change made through the API is reverted by the next sync
(at most 30 minutes) and reported on the `infra-drift` issue.

Everything is off until `observability_enabled = true` in
`infra/prod.auto.tfvars`; until then the sync workflow exits with a notice.

## Changing a dashboard

Either way ends in a PR, which CI validates:

- **In the Grafana UI:** edit and **Save**. Git Sync is set to save to a new
  branch and open a PR (never straight to `main`). Merge it; Git Sync pulls it
  back within seconds.
- **In the repo:** edit the JSON and open a PR.

Rules for the JSON (enforced by `validate.py`):

- A fixed `uid` with the `hm-` prefix (at most 40 characters), a `title`, and
  **no numeric `id`** (Grafana assigns it; the uid is the identity).
- Data sources only as `{ "type": ..., "uid": ... }` (v2: `{ "name": <uid> }`) with a uid from
  `datasources.json` (or the built-ins `-- Grafana --`, `-- Mixed --`,
  `-- Dashboard --`, `__expr__`). No names, no `${datasource}` variables:
  Git Sync reads the files as they are, so nothing can be templated.
- SQL (`hm-postgres`) reads only the `monitoring.*` views and the columns
  listed in `datasources.json`: no `select *`, no other schemas, no quoted
  identifiers, one statement. The views hold aggregates and enums only
  (privacy: no titles, bodies, names, ids, amounts or emails).
- Only dashboard JSON and `_folder.json` under `dashboards/`. Each folder has
  a `_folder.json`. At most 20 synced resources in total (Grafana Cloud Free:
  the repository folder, our folders and dashboards; today 6).

### File format: classic or v2

Git Sync accepts these formats for a dashboard file, and `validate.py` checks
all of them with the same rules:

1. **Classic dashboard JSON** (what "Export" gives you), recognised by having
   `panels`, `schemaVersion` and `tags`. Its `uid` becomes the resource name.
2. The Kubernetes-style wrapper: `apiVersion: dashboard.grafana.app/v1`,
   `kind: Dashboard`, `metadata.name` (the uid) and `spec` (the classic
   dashboard JSON; `metadata.name` must equal `spec.uid` if both are set).
3. **v2**: `apiVersion: dashboard.grafana.app/v2`, `metadata.name` (the uid)
   and a `spec` with `elements` (panels) and `layout`. **A save in the
   Grafana UI writes this**, so a dashboard edited in the UI turns into v2 in
   its PR; that is expected, merge it as is. In v2 a query names its data
   source as `"datasource": {"name": "<uid>"}`, with the type in the query's
   `group`; the uid must still be one from `datasources.json`.

Mixing formats across files is fine. The `grafana_dashboard` fallback
(`dashboards_via_git_sync = false`) takes only 1 and 2: before switching to
it, export each v2 dashboard as classic JSON (the plan names any v2 file).

Folders are directories. `_folder.json` (`apiVersion: folder.grafana.app/v1`,
`kind: Folder`, `metadata.name` = the folder uid, `spec.title`) keeps the
folder uid stable when the directory moves.

Sources: Grafana's parser,
[`pkg/registry/apis/provisioning/resources/fileformat.go`](https://github.com/grafana/grafana/blob/main/pkg/registry/apis/provisioning/resources/fileformat.go)
(`ReadClassicResource`: "a classic file format ... with panels/schemaVersion/tags
but no apiVersion/kind"); the export docs
([Git Sync: export resources](https://grafana.com/docs/grafana/latest/as-code/observability-as-code/git-sync/export-resources/),
"Both classic and v2 JSON models are supported"); and the folder metadata file
([Use Git Sync](https://grafana.com/docs/grafana/latest/as-code/git-sync/use-git-sync/#the-git-sync-folder-metadata-file)).

## Changing an alert, a route or a mute timing

Edit the YAML in a PR. CI validates it, the `infra.yml` plan comment shows the
rule diff, and after the merge the sync applies it within minutes. To start
from the UI, use a rule's **Export** and copy the query model into the YAML;
there is no click-to-save for alerts.

**Silences are allowed in the UI:** a silence is runtime state, not
configuration, and it expires by itself. Use one for an emergency.

### `alerts/<group>.yaml`

One rule group per file; `group` must equal the file name. All rules land in
the "House manager alerts" folder (uid `hm-alerts`, created by
`infra/modules/observability/grafana_cloud`). It is separate from the Git
Sync folder "House manager", which belongs to the repository connection.

```yaml
group: availability            # the rule group name (= file name)
interval: 1m                   # evaluation interval, a multiple of 10s
rules:
  - uid: hm-app-down           # stable and unique, prefix hm-, at most 40 characters
    title: AppDown             # the alertname, one CamelCase word, unique
    for: 5m                    # pending period ("0s" for none)
    severity: critical         # critical | warning | info        -> label severity
    push: true                 # true | false, unquoted           -> label push="true"/"false"
    summary: "App unreachable from the probes"   # annotation summary (email)
    summary_he: "האפליקציה לא זמינה"             # annotation summary_he: the push text,
                                                 # short, gender-neutral Hebrew (at most 80 characters)
    runbook: app-down          # -> annotation runbook_url = docs/setup.md#runbook-app-down
    no_data_state: OK          # OK | NoData | Alerting
    exec_err_state: KeepLast   # KeepLast | Error | Alerting | OK
    condition: C               # the ref_id that decides; must be an expression
    data:                      # 1:1 into grafana_rule_group data blocks
      - ref_id: A
        datasource_uid: grafanacloud-prom          # from datasources.json, or __expr__
        relative_time_range: { from: 900, to: 0 }  # seconds; from > 0 for a query
        model:                                     # the query model as Grafana stores it
          refId: A
          datasource: { type: prometheus, uid: grafanacloud-prom }
          expr: avg by (job) (avg_over_time(probe_success{job="app"}[15m]))
          instant: true
      - ref_id: B
        datasource_uid: __expr__
        relative_time_range: { from: 0, to: 0 }
        model: { refId: B, datasource: { type: __expr__, uid: __expr__ },
                 type: reduce, expression: A, reducer: last, settings: { mode: dropNN } }
      - ref_id: C
        datasource_uid: __expr__
        relative_time_range: { from: 0, to: 0 }
        model:
          refId: C
          datasource: { type: __expr__, uid: __expr__ }
          type: threshold
          expression: B
          conditions: [{ type: query, evaluator: { type: lt, params: [0.5] },
                         operator: { type: and }, query: { params: [C] },
                         reducer: { type: last, params: [] } }]
```

Query models by data source: Prometheus and Loki use `expr`, Tempo uses
`query`, Postgres uses `rawSql` with `format: table` (one row, numeric
columns). Expressions are `reduce`, `threshold`, `math` (`$A > 1800 || $B >= 3`),
`resample` or `classic_conditions`.

### `alerting/policies.yaml`

```yaml
receiver: email-owner          # root receiver
group_by: [alertname]
group_wait: 30s
group_interval: 15m
repeat_interval: 24h
routes:                        # child routes, in order
  - receiver: app-push
    matchers: [{ label: push, match: "=", value: "true" }]   # match: = != =~ !~
    continue: true
    # optional: group_by, group_wait, group_interval, repeat_interval,
    # mute_timings: [<name from mute-timings.yaml>], routes: [...]
  - receiver: email-owner
```

Receivers must be contact points defined in HCL: `email-owner` (the owner's
Grafana login; new free stacks can email only their own users) and `app-push`
(the `alert-hook` Edge Function, HMAC-signed, which pushes to the app's admins
and respects quiet hours).

### `alerting/mute-timings.yaml`

A list, empty for now:

```yaml
- name: weekend-mornings       # lowercase, dash-separated, unique
  intervals:
    - weekdays: [friday, saturday]               # or ranges: "monday:thursday"
      times: [{ start: "06:00", end: "09:00" }]  # HH:MM
      location: Asia/Jerusalem
      # also: days_of_month, months, years
```

## The rules

| uid | Title | Group | Condition | For | Severity | Push | Runbook |
|---|---|---|---|---|---|---|---|
| hm-app-down | AppDown | availability | `app` probe success over 15 min < 0.5 | 5m | critical | yes | app-down |
| hm-supabase-down | SupabaseDown | availability | `supabase-auth` probe success over 15 min < 0.5 | 5m | critical | no | supabase-down |
| hm-push-function-down | PushFunctionDown | availability | `send-push` probe (expects 401) success over 45 min < 0.5 | 0s | warning | no | push-function-down |
| hm-price-data-stale | PriceDataStale | data-freshness | hours since the last finished ok/partial ingest run > 30 | 0s | warning | yes | price-data-stale |
| hm-push-delivery-problem | PushDeliveryProblem | data-freshness | oldest due row > 30 min, or gave_up_24h >= 3 | 10m | warning | no | push-delivery |
| hm-database-near-full | DatabaseNearFull | data-freshness | `pg_database_size_bytes` > 400 MB | 1h | warning | yes | database-near-full |
| hm-frontend-errors | FrontendErrors | frontend | > 10 Faro exceptions in production in 1 hour | 0s | warning | no | frontend-errors |
| hm-free-tier-budget | FreeTierBudget | budget | any Grafana Cloud Free limit above 80% | 0s | info | no | free-tier-budget |

## Credits

The Database dashboard is trimmed from the official
[supabase/supabase-grafana](https://github.com/supabase/supabase-grafana)
dashboard (MIT License, Copyright (c) 2023 Supabase).
