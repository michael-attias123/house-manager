# house-manager

A private household app for a couple: shared shopping list, supermarket basket
comparison (Be'er Sheva), Splitwise-style expense splitting, recurring bills,
chores, and savings insights. Hebrew, RTL, mobile-first PWA.

## Layout

```
web/                React 19 + TypeScript + Vite PWA (Tailwind 4, TanStack Query, React Router 7)
  src/app/          shell: feature registry (features.ts), Layout, router, dashboard
  src/features/<f>/ one folder per feature (see below)
  src/lib/          supabase client, money (agorot), dates (ISO days), recurrence, realtime
  src/components/   shared UI (ui/*), ErrorBoundary
supabase/
  migrations/       one SQL file per feature; RLS on every table
  tests/            local_stub.sql (Supabase stand-in) + db_test.sql (RLS/RPC checks)
  functions/        Edge Functions (Deno): send-push, deployed by db-migrate.yml
ingest/             Python 3.12: Price Transparency files → Postgres (daily GitHub Action)
scripts/db-test.sh  migrations + db_test.sql + ingest tests on a throwaway Postgres
docs/setup.md       deployment guide (Hebrew)
```

## Commands

```bash
cd web && pnpm dev | pnpm lint | pnpm typecheck | pnpm test | pnpm build
cd web && pnpm dev:demo | pnpm build:demo   # no backend: src/demo fakes Supabase with sample data
./scripts/db-test.sh            # needs local Postgres binaries or DATABASE_URL
cd ingest && python -m pytest   # parser tests (DB test runs via db-test.sh)
```

CI (`.github/workflows/ci.yml`) runs all of the above. Run them before pushing.

## Adding a feature

1. **Migration**: `supabase/migrations/<timestamp>_<feature>.sql`. Every table gets
   `household_id uuid not null references households on delete cascade`, RLS
   enabled, a policy `using (public.is_member(household_id)) with check (...)`,
   and explicit `grant ... to authenticated` (new Supabase projects do not
   auto-grant). Add checks to `supabase/tests/db_test.sql`.
2. **Types**: add the row interface to `web/src/lib/db-types.ts`.
3. **Folder** `web/src/features/<feature>/`:
   - `api.ts`: plain async functions over `supabase` + `unwrap()`.
   - `hooks.ts`: TanStack Query hooks, with a `<feature>Keys` object for query keys.
   - `lib/*.ts`: pure logic, with a `*.test.ts` next to it.
   - `<Feature>Page.tsx`, optional `Widget.tsx` (dashboard card), `components/`.
   - `index.ts`: exports a `FeatureDefinition` (`app/types.ts`): id, title,
     lucide icon, path, routes (lazy page), `nav` placement, optional Widget.
4. **Register** it in `web/src/app/features.ts`. Nav, routes and dashboard
   pick it up from there; `app/features.test.ts` checks ids and paths are unique.
5. **Demo**: `src/demo` stands in for Supabase in the demo build. A new table
   works there as is; a new RPC or view needs a TS version in `demo/rpc.ts`,
   and sample rows go in `demo/seed.ts`.
6. **Insights** (optional): add a rule file in `features/insights/rules/` and
   list it in `rules/index.ts`. Rules are pure `(InsightData) => Insight[]`.

Features may import another feature's `api.ts`, `hooks.ts` or `lib/`, never
its components.

## Conventions

- Money: numbers in shekels at the edges, integer agorot inside calculations
  (`toAgorot`/`fromAgorot`). Format with `formatILS`. Splits must sum exactly;
  the rounding remainder goes to the payer (same rule in `split.ts` and SQL
  `default_shares`).
- Dates: ISO calendar days (`'2026-10-17'`) in local time, via `lib/dates.ts`.
- UI text is Hebrew and gender-neutral (avoid "עשה/תה"; rephrase instead).
  Use logical CSS (`ms-`, `pe-`, `start`), never left/right, so RTL works.
  Wrap numbers mixed into Hebrew text in `<span className="num">` (LTR isolate).
- Charts: single-hue `bg-viz` (`--viz-mark`, validated for light and dark).
  No categorical rainbows; label values directly.
- Mutations that the partner should see live: `useRealtimeInvalidate(table, ...)`
  (one shared channel per table) and add the table to the `supabase_realtime`
  publication in its migration.
- No `alert`/`confirm`/`prompt` (blocked in some embeds); use `ConfirmButton`.
- Server-side multi-row writes go through an RPC (`complete_trip`,
  `save_expense`, `pay_bill`) so they are atomic and validated.
- Sign-up is limited by `public.allowed_emails` (a trigger on `auth.users`;
  an empty list lets everyone in). The owner adds addresses in the admin
  screen or the SQL editor; never commit real ones.
- Admin (`features/admin`): admins are user ids in `public.app_admins`
  (SQL only, no client access). App-wide RPCs are named `admin_*`, are
  security definer and start with `if not public.is_admin() then raise
  ... errcode '42501'`; the client calls `is_admin()` only to decide what
  to show. Their demo ports in `demo/rpc.ts` keep the same guards.
- Notifications: `enqueue_notification()` is the single entry point (prefs, quiet hours,
  dedup by `(user_id, dedup_key)`); a source is a trigger or RPC that calls it or
  `notify_members()`, never an insert into `notification_outbox`.
- Every notification kind is off by default (`notification_prefs`, per user, not per
  household); a new kind needs a pref column, its check entry and a toggle in `features/notifications`.
- Columns that name a household member are listed once, in SQL
  `move_member_refs()` (and `MEMBER_COLUMNS` in `demo/rpc.ts`); a new one
  goes there. `detach_member()` is the one rule for taking a member out
  (admin removal and deleted accounts): placeholder if they have history.

## Going out ("יוצאים")

Places in Be'er Sheva and their deals (`features/going-out`, migrations
`*_going_out.sql`, `*_venue_favorites.sql`, `*_hever_teamim.sql`,
`*_visitbr7_bars.sql`). Places come
from OpenStreetMap (`ingest/house_ingest/venues.py`, weekly `venues.yml`; it
touches only `source = 'osm'`, keeps admin edits and details other sources
filled in), from the "חבר טעמים" list (`source = 'hever'`, a one-time import
made with `scripts/hever-to-sql.py`, see docs/setup.md), from the city's
tourism site (`source = 'visitbr7'`, a one-time import of its bars made with
`scripts/visitbr7-to-sql.py`) and from households
(`community`, approved by an admin). Deals are written by households and
approved in the admin's "הצעות" tab; `member_card` deals ("כרטיס חבר") are
standing discounts and never count as "on now". Opening hours are OSM syntax,
read by `lib/hours.ts` (anything it can't read is unknown, never closed).
Deals can also be read from screenshots by an AI chat ("ייבוא עם AI",
`lib/aiImport.ts`): the app gives the instructions and parses the pasted
answer, calling no model; an admin's import goes in approved through
`admin_add_deals`. The demo names no real business.

## Price data

`ingest/` uses il-supermarket-scraper (non-commercial license, Sefi Erlich,
https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers) to
download Stores/PriceFull files, parses them itself (`parse.py`, tolerant of
each chain's XML dialect), and replaces each store's prices in one COPY-based
transaction. Chain-internal item codes (produce etc.) are stored as
`<chain_id>:<code>` so they never match across chains. Some chain sites block
non-Israeli IPs; docs/setup.md explains running ingest from home for those.

Basket matching (`features/prices/lib/match.ts` + SQL `match_candidates`):
products get a normalized name and pack size (`norm_name`, `product_pack`,
generated columns). An item matches names that *start* with it before names
that merely contain it, `lib/staples.ts` says what common items mean
(terms, excluded words, standard pack, per kg), and each store contributes
its cheapest product of the chosen pack. Check real data with the
**Price probe** workflow (`scripts/price-probe.sql`; `dump` prints a CSV
slice to load into a local database) before changing these rules.
