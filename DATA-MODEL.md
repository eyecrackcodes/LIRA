# Data model

What the app reads. Base tables hold facts; `v_*` views pre-compute the rates and
week-over-week math so every surface agrees on one number.

**The views are the API.** Rates, WoW deltas, and cohort maturity live in SQL, not
in the app — so a chart, an email, and the Coach bot can never disagree about the
team's close rate.

> Adapting this to your own schema? You don't have to match these names. Rewrite
> the ~25 functions in [`src/lib/queries.ts`](src/lib/queries.ts) to return the row
> shapes in [`src/lib/types.ts`](src/lib/types.ts) and everything downstream works
> unchanged. [`src/lib/demo.ts`](src/lib/demo.ts) is a complete worked example of
> generating every shape below.

---

## Grain conventions

- **Weeks are Monday-anchored.** `week_start` is the Monday. A week is incomplete
  until its final nightly run, so a Monday meeting presents the week that ended
  the previous Saturday.
- **Placement is judged by submission-month cohort, not by week.** A deal
  submitted in March that goes active in May belongs to March. Cohorts take
  30–90 days to resolve, so a fresh cohort's rate is meaningless — always carry
  `maturity_pct` and gate on it.
- **Calendar months are fuzzy at the edges** (Monday weeks vs month boundaries).
  Weekly and all-time numbers are exact; monthly totals won't tie to a
  calendar-month report from another system, and that's expected.
- Every row carries a freshness stamp: `synced_at` (mirrors) or
  `captured_at`/`taken_at` (natively written tables).

---

## Base tables

### `dim_agent` — the roster
`agent` (PK) · `agent_email` · `status` ('active' | 'departed') · `synced_at`

Every rep name that appears in any fact table needs a row here (departed reps
keep their history). Soft foreign keys only — join facts to this and filter
`status = 'active'` for current-roster pages.

### `weekly_data` — rep × week production
`week_start` · `agent` · `agent_email` · `leads` · `sales` · `premium` · `sdp` ·
`hp` · `attendance_pct` · `tenure_mo` · `outage_days` · `ams_submissions` ·
`ams_placed` · `ams_pending` · `synced_at`

Raw counts only. Read rates from `v_weekly_agent` / `v_weekly_team`.

### `daily_activity` — rep × day effort
`activity_date` · `week` · `agent` · `billable_leads` · `total_dials` ·
`crm_talk_min` · `rpa_min` · `rpa_hrs` · `idle_hrs` · `present` ·
`script_adherence` (1–5, AI-graded) · `script_calls` · `hp` · `synced_at`

`rpa_min` = "revenue-producing activity" minutes — productive floor time. Expect
`script_adherence` to be **sparse**; the UI shows "n graded calls" beside any
score so a coverage gap never reads as bad behavior.

### `placement_cohort` — submission-month cohorts
`agent` · `cohort_month` · `submissions` · `placed` · `declined` · `pending` ·
`synced_at`

"Placed" means **ever reached active/inforce**. A later cancellation is a
chargeback (a financial reversal), *not* an un-placement.

### `commission_ledger` — one row per deal ever paid or charged back
`policy_number` · `policy_key` · `agent` · `agent_email` · `rls_emails` ·
`carrier` · `product` · `uw_type` · `commissionable_premium` · `rate` ·
`commission` · `statement_month` (YYYY-MM) · `pay_date` · `status`
('Paid' | 'Charged Back') · `chargeback` (≤ 0) · `chargeback_month` · `net` ·
`origin` · `synced_at`

Payable per rep-month = `max(0, Σnet − MONTHLY_DRAW)`. Net is signed and can go
negative on a heavy chargeback month; payable is floored at 0. `rls_emails` is a
comma-separated list (owner + managers) used by the RLS policy. `policy_key`
strips leading zeros — join on it, since upstream systems pad inconsistently.

### `comm_summary` — rep × pay period
`agent` · `agent_email` · `pay_date` · `period_type` · `inforce_premium` ·
`gross_commissions` · `chargebacks` · `net_this_period` · `commission_payable` ·
`effective_rate` · `policies` · `placed` · `charged_back` · `net_after_draw` ·
`synced_at`

Settled periods are frozen; `'Current Period'` rows are still accruing and are
marked as such in the UI. Parse `pay_date` defensively — upstream formats vary.

### `pnl_stack_rank` — rep × week unit economics
`week_start` · `agent` · `billable_leads` · `lead_cost` · `sales_crm` ·
`avg_premium` · `place_rate_pct` · `exp_*` (expected) · `act_*` (actual) ·
`chargebacks` · `synced_at`

Expected and actual **diverge by design**: expected is this week's sales
potential, actual is cash from deals closed 2–3 months ago. Never present the gap
as an error. Rep cost is `max(draw, commission)` — never draw + commission.

### `agent_efficiency` — nightly snapshot, overwritten
`rank` · `agent` · `efficiency_score` · `tier` · `place_rate` ·
`baked_place_rate` · `true_hp` · `rpa_utilization` · `present_days` ·
`validifi_rate` · `coverage_pct` · `month` · `tenure_days` · `synced_at`

The official scorecard behind bonuses. `true_hp` = hourly production × place rate
— output speed discounted by quality. **A snapshot, not a time series.**

### `lead_source_week` — lead performance by source
`period_start` · `grain` ('week' | 'month') · `agent` · `source` · `leads` ·
`accepted` · `sales_icd` · `lead_cost` · `cost_per_lead` · `captured_at`

**Never mix grains in one aggregation** — filter `grain` first.

### `dim_lead_source` — cost rules per source
`source` (PK) · `cost_per_lead` · `billed_on_total` · `is_ctv` · `source_group`

### `call_transcripts` — outlier-day call capture
`conversation_uuid` (PK) · `agent` · `call_date` · `started_at` · `title` ·
`trigger` ('hot' | 'cold') · `day_sales` · `day_premium` · `day_dials` ·
`overall_score` · `duration_sec` · `transcript` · `captured_at`

Deliberately **not** every call — only outlier days, so a rep can compare their
own best day to a slump day. `hot` = an outlier good day against that rep's own
30-day baseline; `cold` = zero conversions despite normal effort.

⚠️ **Contains customer PII.** Reps may see only their own; the app enforces this
server-side. Diarization caveat: the first speaker label is often unreliable —
don't attribute opening lines with confidence.

### `mailer_scan_snapshot` — daily marketing counters
`snap_date` (PK) · `total_scans` · `unique_scans` · `total_sends` · `taken_at`

Cumulative — diff two dates to get engagement for a period.

### `app_roster_override` — app-owned, writable
`agent` · `status` · `departed_on` · `note`

The one table the app writes. Because `dim_agent` is refreshed from upstream,
marking someone departed there would be erased on the next sync; this table is
layered over it at read time so departures stick immediately.

---

## Views (the API)

| View | Grain | Gives you |
|---|---|---|
| `v_weekly_team` | week | Team totals + `close_rate_pct`, `premium_per_sale`, `wow_*` deltas. **Aggregate-then-rate.** |
| `v_weekly_agent` | rep × week | Same per rep, plus `agent_status`; WoW is per-rep timeline |
| `v_daily_team` / `v_daily_agent` | day | Day-grain counterpart for "this week so far". Noisy — pace reads only, never trends |
| `v_weekly_close_effort` | rep × week | Close joined to effort: `dials`, `talk_min_per_dial`, `leads_per_day`, `active_days`, `script_adherence`. Explains *why* close moved |
| `v_placement_cohort` / `_team` | rep × cohort month | `place_rate_pct`, `resolved_rate_pct` (placed ÷ decided), `maturity_pct` (decided ÷ submitted) |
| `v_client_placement_agent` / `_team` | rep, lifetime | Per-**customer** capped rate: a household counts once no matter how many policies |
| `v_lead_source_enriched` | source × rep × period | Source performance + cost columns and `is_ctv` for mix monitoring |
| `v_uw_mix_week_agent` | rep × week × type | Product/underwriting mix and effective rate |
| `v_agent_day_trigger` | rep × day | Film Room trigger: `duration_percentile`, `is_hot`, `is_cold_streak` |
| `v_data_quality` | — | Orphan/violation report: `issue`, `subject`, `detail`, `evidence`. Non-empty = action needed |

### Two rate definitions, both correct

The distinction that causes the most confusion, so the UI shows both:

- **Place rate** = `placed ÷ submitted`. Pendings count as misses-so-far, so it
  can only rise as they resolve.
- **Resolved rate** = `placed ÷ (placed + declined)`. Pendings excluded until
  decided, so it's readable immediately but can fall when a new decline lands.

Declines count **against** both. Only "ever active" counts as placed.

---

## Hardening notes

- Group by rep-week in `v_weekly_agent` so duplicate upstream rows can't
  double-count; build the team and effort views on top of it rather than on the
  raw table.
- Anchor weeks with `date_trunc('week', ...)` defensively — a timezone rollover
  bug that writes a Tuesday anchor is easy to introduce and annoying to find.
- Surface `v_data_quality` on an admin page. A green wall is what earns trust in
  everything else.
