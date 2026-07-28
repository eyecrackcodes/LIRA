# Franchise Mode — a sales performance suite that feels like a video game

Most sales dashboards are a wall of numbers nobody opens twice. This one treats
every rep as a **player**: a card with an overall rating, attribute bars, trend
arrows, weekly badges, and a trophy case — backed by real production data, with
the raw stat always shown next to the rating so nobody coaches off a vibe.

Built for a small, remote, high-velocity sales team (10–20 reps) where one
manager runs daily coaching, weekly 1:1s, and a Monday all-hands off the same
numbers.

> **Try it in 30 seconds — no database, no API keys, no signup:**
> ```bash
> npm install
> npm run demo:build && npm run demo:start   # → http://localhost:3010
> ```
> Runs on a generated fake warehouse: fictional roster, fictional clients,
> fictional pay. Every page works. Nothing leaves your machine.

---

## What's in it

| Page | The question it answers |
|---|---|
| **Team Pulse** | "What changed this week?" WoW tiles with deltas, 12-week trend, live week-to-date pace vs the same weekdays last week |
| **Roster + Agent Cards** | 1:1 prep. Six attributes (Closing, Placement, Production, Hustle, Discipline, Consistency) percentile-ranked 40–99, form sparkline, badges, goal pace |
| **Stack Rank** | The weekly board, ranked by overall rating — plus an email-safe HTML render for sending it out |
| **Close Diagnostics** | "Why did close rate move?" Effort vs outcome scatter, lead-source mix, CTV-share early warning |
| **Placement** | Cohort quality by submission month with maturity shading, company-level rate, per-household capped rate |
| **Commission** | Payable per statement month = max(0, net − draw), waterfall, chargeback log. Reps see only their own rows |
| **Film Room** | Call transcripts from outlier days (a rep's own best day next to a slump day), talk-share, objection compare, audio playback |
| **Ask Coach** | LLM chat grounded in the rep's own numbers — refuses anything outside the provided context |
| **Data Health** | Freshness per table, quality issues, and ingestion-gap detection for trigger-based pipelines |

Stack: **Next.js 16** (App Router, server components for all data) · **Tailwind v4** ·
**Recharts** · **Supabase** (Postgres + Auth).

---

## The design rules that make the numbers trustworthy

These are baked into the code, not just documented. If you fork this, keep them —
they're the difference between a dashboard people trust and one they argue with.

1. **Never average per-rep percentages into a team number.** Team rates are
   aggregate numerator ÷ aggregate denominator. Averaging rates produces a
   number that disagrees with every other report you have.
2. **Every rate shows its sample size.** `24.2% on 91 leads` — because 3/11 also
   reads as 27% and means nothing.
3. **Rate-normalize before comparing people.** Never rank raw dollars or raw
   counts as "skill"; high producers always have bigger absolutes.
4. **Ratings are for feel; raw stats are for decisions.** The card always shows
   both (`CLS 87 · 24.2%`), and ratings sit in a 40–99 band so nobody reads as a 12.
5. **Show data freshness everywhere.** Nightly batch ≠ live. Stale data gets a
   banner, not silence.
6. **Judge new hires on leading indicators.** Low-tenure reps look terrible on
   trailing revenue for structural reasons; the UI tags them instead of letting
   them rank bottom unexplained.
7. **Leaderboards are for coaching, not shaming.** Every "bottom of board" view
   is paired with the effort/context stats that explain it.

---

## Make it yours

**Branding** — three env vars, no code edits ([`src/lib/brand.ts`](src/lib/brand.ts)):

```bash
NEXT_PUBLIC_BRAND_MARK=ACME          # short mark, accent color
NEXT_PUBLIC_BRAND_NAME=Franchise     # wordmark
NEXT_PUBLIC_BRAND_TAGLINE=Sales Performance
```

**Comp plan** — [`src/lib/config.ts`](src/lib/config.ts): monthly draw and
production goal. Set the draw to `0` if you don't have one; the payable math
collapses to plain net with no other change.

**Rating weights** — [`src/lib/ratings.ts`](src/lib/ratings.ts): `OVR_WEIGHTS` is
one object. Reweight it for what your team actually gets paid for.

**Rep photos** — drop `public/agents/<slug>.png` (or `.jpg`), slug =
lowercase-hyphenated name (`marcus-webb.png`). Missing photos fall back to an
initials avatar automatically, so this is optional.

**Theme** — [`src/app/globals.css`](src/app/globals.css): one accent color,
light/dark, plus a colorblind-safe palette.

---

## Connecting your own data

The app reads a **read-only warehouse** — it never writes production tables. All
queries live in [`src/lib/queries.ts`](src/lib/queries.ts) and run server-side.

There are two honest paths:

**A. Match the expected shape.** Point `SUPABASE_URL`/`SUPABASE_KEY` at a
Postgres with the tables and views in [DATA-MODEL.md](DATA-MODEL.md). Fastest if
you're starting fresh — the doc gives you the columns and the derived views.

**B. Adapt the query layer.** Keep your own schema and rewrite the ~25 functions
in `queries.ts` to return the same row shapes ([`src/lib/types.ts`](src/lib/types.ts)).
Everything downstream — ratings, badges, charts, Coach — is pure functions over
those types, so nothing else changes. This is usually the shorter road.

Either way, `npm run demo` keeps working as a reference for what "good" output
looks like: [`src/lib/demo.ts`](src/lib/demo.ts) generates a complete, internally
consistent warehouse, and [`src/lib/demo-client.ts`](src/lib/demo-client.ts) is a
mock PostgREST client, so **you can build and demo every page before you have a
single row of real data.**

---

## Security — read before you ship

This app displays individual pay. Two layers protect it, and you need both:

1. **App layer** ([`src/lib/auth.ts`](src/lib/auth.ts)) — Supabase Auth with three
   roles. `manager` (in `MANAGER_EMAILS`) sees everything; `agent` (matched to
   `dim_agent.agent_email`) sees only their own commission, own film, and no
   cost/margin pages; anyone else gets a no-access screen. Every restriction is
   enforced server-side in the page, not just hidden in the nav.
2. **Database layer** ([`supabase/rls-pay-tables.sql`](supabase/rls-pay-tables.sql))
   — apply this before any rep logs in. Without RLS, your anon key serves every
   rep's pay to anyone who has it.

Call transcripts contain customer PII (names, health, banking). A rep may see
**only their own**; the code enforces this via `canViewAgentFilm()`. Keep it.

`AUTH_DISABLED=1` is a local convenience that turns off all access control.
Never set it in a deployed environment.

---

## Scripts

```bash
npm run dev           # your real data (needs .env.local)
npm run demo          # fake warehouse, hot reload      → :3010
npm run demo:build    # compile with fixtures
npm run demo:start    # serve the demo build            → :3010  (best for recording)
npm run build         # production build
```

Record the rep-side experience with `DEV_VIEWER_AGENT="Bianca Ortiz" npm run demo:start`.

---

## License

MIT — see [LICENSE](LICENSE). No warranty; the comp-plan math encodes one team's
plan and you are responsible for validating it against yours before anyone gets
paid off a number this app displays.
