/** Row types mirroring DATA-CONTRACT.md — the v_* views are the API. */

export interface WeeklyTeamRow {
  week_start: string;
  leads: number | null;
  sales: number | null;
  premium: number | null;
  sdp: number | null;
  active_agents: number | null;
  ams_submissions: number | null;
  ams_placed: number | null;
  close_rate_pct: number | null;
  premium_per_sale: number | null;
  premium_per_agent: number | null;
  wow_sales: number | null;
  wow_leads: number | null;
  wow_premium: number | null;
  wow_close_rate_pts: number | null;
}

export interface WeeklyAgentRow {
  week_start: string;
  agent: string;
  agent_email: string | null;
  agent_status: "active" | "departed";
  leads: number | null;
  sales: number | null;
  premium: number | null;
  sdp: number | null;
  hp: number | null;
  attendance_pct: number | null;
  tenure_mo: number | null;
  outage_days: number | null;
  ams_submissions: number | null;
  ams_placed: number | null;
  ams_pending: number | null;
  close_rate_pct: number | null;
  premium_per_sale: number | null;
  ams_place_rate_pct: number | null;
  wow_sales: number | null;
  wow_leads: number | null;
  wow_premium: number | null;
  wow_close_rate_pts: number | null;
}

/**
 * Day-grain counterpart to WeeklyTeamRow (view v_daily_team). Small-N and noisy
 * per day — use only for "today / this week so far" live reads, never trend
 * analysis. dod_* are day-over-day (previous activity_date) via lag.
 */
export interface DailyTeamRow {
  activity_date: string;
  week_start: string;
  leads: number | null;
  sales: number | null;
  premium: number | null;
  sdp: number | null;
  close_rate_pct: number | null;
  premium_per_sale: number | null;
  dod_sales: number | null;
  dod_leads: number | null;
  dod_premium: number | null;
}

export interface DailyAgentRow extends DailyTeamRow {
  agent: string;
  agent_email: string | null;
  agent_status: "active" | "departed";
}

/**
 * Film Room duration-based trigger (view v_agent_day_trigger). One row per agent
 * per graded-call day. duration_percentile is percent_rank of that day's avg
 * call duration within the agent's OWN history (0 = shortest ever, 1 = longest).
 * Only is_cold_streak (two consecutive cold-candidate days) should ever be shown
 * as a "Cold Day" — cold_candidate alone is noise. See FILM-ROOM-PROMPT.md.
 */
export interface AgentDayTriggerRow {
  agent: string;
  call_date: string;
  avg_duration_sec: number | null;
  call_count: number | null;
  sales: number | null;
  premium: number | null;
  duration_percentile: number | null;
  cold_candidate: boolean | null;
  is_hot: boolean | null;
  is_cold_streak: boolean | null;
}

export interface PlacementCohortRow {
  agent: string;
  agent_status: "active" | "departed";
  cohort_month: string;
  submissions: number | null;
  placed: number | null;
  declined: number | null;
  pending: number | null;
  place_rate_pct: number | null;
  resolved_rate_pct: number | null;
  maturity_pct: number | null;
}

export interface PlacementCohortTeamRow {
  cohort_month: string;
  submissions: number | null;
  placed: number | null;
  declined: number | null;
  pending: number | null;
  place_rate_pct: number | null;
  resolved_rate_pct: number | null;
  mom_place_rate_pts: number | null;
}

/**
 * Client-level capped placement (v_client_placement_agent / _team). A CLIENT is
 * "placed" if ANY of their policies has ever been inforce, capped at 100% per
 * client (so a 3-policy household can't count as 3 placements). Distinct from
 * the per-policy submission-cohort place rate above.
 *  - capped_place_rate_pct:          pending clients counted as miss-so-far
 *  - capped_place_rate_resolved_pct: pending clients excluded from denominator
 *  - maturity_pct:                   % of the book that's resolved (confidence)
 */
export interface ClientPlacementAgentRow {
  agent: string;
  agent_status: "active" | "departed";
  clients: number | null;
  multi_policy_clients: number | null;
  ever_inforce_policies: number | null;
  total_policies: number | null;
  clients_capped_placed: number | null;
  capped_place_rate_pct: number | null;
  uncapped_place_rate_pct: number | null;
  pending_clients: number | null;
  resolved_clients: number | null;
  maturity_pct: number | null;
  capped_place_rate_resolved_pct: number | null;
}

export interface ClientPlacementTeamRow {
  clients: number | null;
  multi_policy_clients: number | null;
  ever_inforce_policies: number | null;
  total_policies: number | null;
  clients_capped_placed: number | null;
  capped_place_rate_pct: number | null;
  uncapped_place_rate_pct: number | null;
  pending_clients: number | null;
  resolved_clients: number | null;
  maturity_pct: number | null;
  capped_place_rate_resolved_pct: number | null;
}

export interface CloseEffortRow {
  week_start: string;
  agent: string;
  leads: number | null;
  sales: number | null;
  premium: number | null;
  close_rate_pct: number | null;
  dials: number | null;
  crm_talk_min: number | null;
  rpa_min: number | null;
  active_days: number | null;
  script_adherence: number | null;
  talk_min_per_dial: number | null;
  leads_per_day: number | null;
}

export interface LeadSourceEnrichedRow {
  period_start: string;
  grain: "week" | "month";
  agent: string;
  source: string;
  source_group: string | null;
  is_ctv: boolean | null;
  dim_cost_per_lead: number | null;
  billed_on_total: boolean | null;
  leads: number | null;
  accepted: number | null;
  sales_icd: number | null;
  lead_cost: number | null;
  icd_close_pct: number | null;
}

export interface DailyActivityRow {
  activity_date: string;
  week: string | null;
  agent: string;
  billable_leads: number | null;
  total_dials: number | null;
  crm_talk_min: number | null;
  rpa_min: number | null;
  rpa_hrs: number | null;
  idle_hrs: number | null;
  present: string | null;
  script_adherence: number | null;
  script_calls: number | null;
  hp: number | null;
  synced_at: string;
}

export interface CommissionLedgerRow {
  policy_number: string;
  policy_key: string;
  agent: string;
  agent_email: string | null;
  carrier: string | null;
  product: string | null;
  uw_type: string | null;
  commissionable_premium: number | null;
  rate: string | null;
  commission: number | null;
  statement_month: string | null; // YYYY-MM (production month) — null on a few stray rows
  pay_date: string | null; // display only — format varies, parse defensively
  status: "Paid" | "Charged Back";
  chargeback: number | null; // <= 0
  chargeback_month: string | null;
  chargeback_date: string | null;
  net: number | null;
  origin: string | null; // SEED | CAPTURE | JUNE-CORRECTION | JUNE-CORR-MOVED
  synced_at: string;
}

/**
 * comm_summary — agent × pay period (DATA-CONTRACT § comm_summary). pay_date
 * formats vary (display only). net_after_draw is signed; commission_payable is
 * floored at 0. 'Current Period'/'Future' rows are live-accruing, past = ''.
 */
export interface CommSummaryRow {
  agent: string;
  agent_email: string | null;
  pay_date: string | null;
  pay_date_label: string | null;
  period_type: string | null;
  inforce_premium: number | null;
  gross_commissions: number | null;
  chargebacks: number | null;
  net_this_period: number | null;
  commission_payable: number | null;
  pay_status: string | null;
  effective_rate: number | null;
  policies: number | null;
  placed: number | null;
  charged_back: number | null;
  net_after_draw: number | null;
  synced_at: string;
}

export interface PnlStackRankRow {
  week_start: string;
  agent: string;
  billable_leads: number | null;
  lead_cost: number | null;
  sales_crm: number | null;
  avg_premium: number | null;
  place_rate_pct: number | null;
  exp_company_rev: number | null;
  exp_agent_cost: number | null;
  exp_net_pnl: number | null;
  act_company_rev: number | null;
  act_agent_cost: number | null;
  act_net_pnl: number | null;
  chargebacks: number | null;
  act_net_after_cb: number | null;
  synced_at: string;
}

/** Nightly snapshot (overwritten) — the official efficiency scorecard.
 *  true_hp = HP × place rate; rates are 0–1 fractions, not percents. */
export interface AgentEfficiencyRow {
  rank: number | null;
  agent: string;
  efficiency_score: number | null;
  tier: string | null;
  place_gated: string | null;
  adj_net_pnl: number | null;
  cleared_draw: string | null;
  bonus_5th: number | null;
  place_rate: number | null;
  raw_place_rate: number | null;
  baked_place_rate: number | null;
  true_hp: number | null;
  rpa_utilization: number | null;
  present_days: number | null;
  validifi_rate: number | null;
  coverage_pct: number | null;
  month: string | null;
  tenure_days: number | null;
  on_probation: string | null;
  synced_at: string;
}

export interface MailerSnapshotRow {
  snap_date: string;
  total_scans: number | null;
  unique_scans: number | null;
  total_sends: number | null;
  taken_at: string;
}

export interface DimAgentRow {
  agent: string;
  agent_email: string | null;
  status: "active" | "departed";
  synced_at: string;
}

export interface DataQualityRow {
  issue: string;
  subject: string | null;
  detail: string | null;
  evidence: string | null;
}

/**
 * Full Attention AI transcript, captured only on outlier agent-days.
 * day_sales/day_premium/day_dials/trigger are day-level context repeated on
 * every call captured that day; overall_score/duration_sec are per-call.
 * Contains client names/health/bank details — manager-only, never surface
 * agent-side (see DATA-CONTRACT § call_transcripts and .cursorrules).
 */
export interface CallTranscriptRow {
  conversation_uuid: string;
  agent: string;
  call_date: string;
  started_at: string;
  title: string | null;
  trigger: "hot" | "cold";
  day_sales: number | null;
  day_premium: number | null;
  day_dials: number | null;
  overall_score: number | null;
  duration_sec: number | null;
  captured_at: string;
}

export interface CallTranscriptFullRow extends CallTranscriptRow {
  transcript: string;
}
