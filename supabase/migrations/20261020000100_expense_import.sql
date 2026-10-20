-- Importing history from Splitwise (web/src/features/expenses/lib/splitwise.ts).
-- Each imported row carries an external_id, so importing the same file again
-- adds nothing.

alter table public.expenses add column external_id text;
alter table public.settlements add column external_id text;

create unique index expenses_external_id_idx
  on public.expenses (household_id, external_id) where external_id is not null;
create unique index settlements_external_id_idx
  on public.settlements (household_id, external_id) where external_id is not null;

alter table public.expenses drop constraint expenses_source_check;
alter table public.expenses add constraint expenses_source_check
  check (source in ('manual', 'trip', 'bill', 'import'));

-- p_expenses: [{external_id, date, description, amount, paid_by, shares, split_type, category}]
-- p_settlements: [{external_id, date, note, amount, from_user, to_user}]
-- All or nothing; rows already imported are skipped and counted.
create or replace function public.import_expenses(
  p_household_id uuid,
  p_expenses jsonb,
  p_settlements jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  e jsonb;
  s jsonb;
  v_id uuid;
  n int;
  added_expenses int := 0;
  added_settlements int := 0;
  skipped int := 0;
begin
  if not public.is_member(p_household_id) then
    raise exception 'not a member';
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb)) loop
    if exists (
      select 1 from public.expenses
      where household_id = p_household_id and external_id = e ->> 'external_id'
    ) then
      skipped := skipped + 1;
      continue;
    end if;
    -- save_expense validates payer, members and that shares add up.
    v_id := public.save_expense(
      p_household_id, e ->> 'description', (e ->> 'amount')::numeric, (e ->> 'paid_by')::uuid,
      e -> 'shares', coalesce(e ->> 'category', 'other'), (e ->> 'date')::date,
      coalesce(e ->> 'split_type', 'exact'), null, 'import', null, null
    );
    update public.expenses set external_id = e ->> 'external_id' where id = v_id;
    added_expenses := added_expenses + 1;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) loop
    if (
      select count(*) from public.household_members
      where household_id = p_household_id
        and user_id in ((s ->> 'from_user')::uuid, (s ->> 'to_user')::uuid)
    ) <> 2 then
      raise exception 'transfer between non-members';
    end if;
    insert into public.settlements (household_id, from_user, to_user, amount, settled_on, note, external_id)
    values (
      p_household_id, (s ->> 'from_user')::uuid, (s ->> 'to_user')::uuid, (s ->> 'amount')::numeric,
      (s ->> 'date')::date, nullif(trim(s ->> 'note'), ''), s ->> 'external_id'
    )
    on conflict (household_id, external_id) where external_id is not null do nothing;
    get diagnostics n = row_count;
    if n = 1 then added_settlements := added_settlements + 1; else skipped := skipped + 1; end if;
  end loop;

  return jsonb_build_object('expenses', added_expenses, 'settlements', added_settlements, 'skipped', skipped);
end;
$$;

grant execute on function public.import_expenses(uuid, jsonb, jsonb) to authenticated;
