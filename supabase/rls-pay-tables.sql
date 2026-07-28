-- ============================================================================
-- Row-Level Security for pay / pay-adjacent tables.
--
-- WHY: without RLS, your Supabase anon key exposes every row of every table
-- through the Data API — including every rep's pay. App-layer role checks are
-- not enough on their own; this makes the DATABASE refuse to serve pay rows to
-- the wrong person, so a leaked anon key or a future coding mistake can't turn
-- into a pay-data breach.
--
-- BEFORE YOU APPLY THIS: set SUPABASE_SERVICE_ROLE_KEY in the app env. The app
-- reads as service_role (which bypasses RLS and does its own role gating in
-- src/lib/auth.ts). If the app is still falling back to the anon key when you
-- enable RLS, every commission page will silently return zero rows.
--
-- 1. Replace the emails in app_is_manager() with your managers.
-- 2. Apply with the Supabase SQL editor, `supabase db push`, or psql.
-- ============================================================================

-- Managers who may read ALL pay rows.
create or replace function public.app_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.email(), '') in (
    -- ▼▼ REPLACE THESE ▼▼
    'manager@example.com',
    'owner@example.com'
    -- ▲▲ REPLACE THESE ▲▲
  );
$$;

-- ---------------------------------------------------------------------------
-- commission_ledger — one row per policy/deal ever paid or charged back.
-- A rep sees their own rows; managers see all.
--
-- `rls_emails` is a comma-separated column containing the owning rep's email
-- plus any manager emails. If your warehouse doesn't have it, swap the second
-- clause for a direct compare against your own owner-email column, e.g.
--   or lower(coalesce(agent_email, '')) = lower(coalesce(auth.email(), ''))
-- ---------------------------------------------------------------------------
alter table public.commission_ledger enable row level security;

drop policy if exists commission_ledger_read on public.commission_ledger;
create policy commission_ledger_read on public.commission_ledger
  for select to authenticated
  using (
    public.app_is_manager()
    or coalesce(auth.email(), '') = any (string_to_array(coalesce(rls_emails, ''), ','))
  );

-- ---------------------------------------------------------------------------
-- comm_summary — pay periods per rep. Own rows + managers.
-- ---------------------------------------------------------------------------
alter table public.comm_summary enable row level security;

drop policy if exists comm_summary_read on public.comm_summary;
create policy comm_summary_read on public.comm_summary
  for select to authenticated
  using (
    public.app_is_manager()
    or lower(coalesce(agent_email, '')) = lower(coalesce(auth.email(), ''))
  );

-- ---------------------------------------------------------------------------
-- pnl_stack_rank — company P&L per rep-week. Managers only: this is margin
-- data, not the rep's own pay.
-- ---------------------------------------------------------------------------
alter table public.pnl_stack_rank enable row level security;

drop policy if exists pnl_stack_rank_read on public.pnl_stack_rank;
create policy pnl_stack_rank_read on public.pnl_stack_rank
  for select to authenticated
  using (public.app_is_manager());

-- ---------------------------------------------------------------------------
-- agent_efficiency — contains bonus/P&L fields. Managers only through the
-- Data API; the app surfaces the rep-safe fields server-side via service_role.
-- ---------------------------------------------------------------------------
alter table public.agent_efficiency enable row level security;

drop policy if exists agent_efficiency_read on public.agent_efficiency;
create policy agent_efficiency_read on public.agent_efficiency
  for select to authenticated
  using (public.app_is_manager());

-- With RLS enabled and no policy for `anon`, the anon key returns zero rows
-- from these tables — which is exactly the point. Verify:
--   curl "$SUPABASE_URL/rest/v1/commission_ledger?select=agent&limit=1" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--   # expect: []
