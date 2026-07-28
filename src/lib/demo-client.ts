import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { demoDb } from "./demo";

/**
 * A minimal stand-in for the Supabase PostgREST client, backed by demo.ts.
 * getWarehouse() returns this when DEMO_MODE=1, so every query function in
 * queries.ts / roster.ts / coach.ts works untouched — including ones added
 * later — without a network call or a real key.
 *
 * Supports exactly the builder surface this app uses: select / eq / gte / in /
 * order / limit / range / maybeSingle, plus upsert + delete (so the manager
 * roster-override UI stays clickable in a demo). Anything else throws loudly
 * rather than silently returning wrong data.
 */

type Row = Record<string, unknown>;
type Result = { data: Row[] | Row | null; error: { message: string } | null };

class DemoQuery implements PromiseLike<Result> {
  private rows: Row[];
  private single = false;

  constructor(private table: string) {
    const db = demoDb();
    if (!(table in db)) {
      // Unknown table: empty rather than crash, but say so in the server log —
      // a page rendering blank in demo mode should be traceable.
      console.warn(`[demo] no fixture for table "${table}" — returning []`);
      this.rows = [];
    } else {
      this.rows = db[table].map((r) => ({ ...r }));
    }
  }

  /** PostgREST column lists are ignored — fixtures already carry every column. */
  select(_cols?: string) {
    return this;
  }

  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => String(r[col] ?? "") === String(val));
    return this;
  }

  neq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => String(r[col] ?? "") !== String(val));
    return this;
  }

  in(col: string, vals: unknown[]) {
    const set = new Set(vals.map(String));
    this.rows = this.rows.filter((r) => set.has(String(r[col] ?? "")));
    return this;
  }

  gte(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => String(r[col] ?? "") >= String(val));
    return this;
  }

  lte(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => String(r[col] ?? "") <= String(val));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    const dir = opts?.ascending === false ? -1 : 1;
    // Stable, and string-compares ISO dates correctly; numbers compare numerically.
    this.rows = [...this.rows].sort((a, b) => {
      const x = a[col], y = b[col];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
    return this;
  }

  limit(n: number) {
    this.rows = this.rows.slice(0, n);
    return this;
  }

  range(from: number, to: number) {
    this.rows = this.rows.slice(from, to + 1);
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  /** Writes mutate the in-memory fixture so demo interactions actually stick. */
  upsert(payload: Row | Row[]) {
    const incoming = Array.isArray(payload) ? payload : [payload];
    const db = demoDb();
    const target = db[this.table] ?? (db[this.table] = []);
    for (const row of incoming) {
      const i = target.findIndex((r) => r.agent === row.agent);
      if (i >= 0) target[i] = { ...target[i], ...row };
      else target.push({ ...row });
    }
    this.rows = incoming;
    return this;
  }

  delete() {
    // Filters applied after .delete() decide what goes; capture the table now
    // and remove on resolve so `.delete().eq(...)` behaves like PostgREST.
    this.pendingDelete = true;
    return this;
  }

  private pendingDelete = false;

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    let result: Result;
    try {
      if (this.pendingDelete) {
        const db = demoDb();
        const doomed = new Set(this.rows.map((r) => r.agent));
        db[this.table] = (db[this.table] ?? []).filter((r) => !doomed.has(r.agent));
        result = { data: null, error: null };
      } else {
        result = {
          data: this.single ? (this.rows[0] ?? null) : this.rows,
          error: null,
        };
      }
    } catch (e) {
      result = { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

export function demoWarehouse(): SupabaseClient {
  return {
    from: (table: string) => new DemoQuery(table),
  } as unknown as SupabaseClient;
}
