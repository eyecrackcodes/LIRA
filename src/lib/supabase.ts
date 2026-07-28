import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { demoWarehouse } from "./demo-client";

/**
 * READ-ONLY server-side client for the dsb-analytics warehouse.
 * RLS is NOT enabled on the warehouse (as of July 2026), so the key must never
 * reach the browser — this module is guarded by `server-only` and the env vars
 * are deliberately NOT prefixed with NEXT_PUBLIC_.
 */
let client: SupabaseClient | null = null;

export function getWarehouse(): SupabaseClient {
  if (client) return client;
  // DEMO_MODE=1 → fake warehouse, no network, no key (see demo.ts).
  if (process.env.DEMO_MODE === "1") {
    client = demoWarehouse();
    return client;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_KEY in .env.local (server-only vars)."
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * PostgREST caps responses at 1,000 rows; page through with .range() so
 * tables like commission_ledger (~1,600 rows) come back complete.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
