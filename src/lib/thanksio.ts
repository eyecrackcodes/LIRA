import "server-only";

/**
 * Live, read-only thanks.io client (server-only).
 *
 * WHY THIS EXISTS: the warehouse table `mailer_scan_snapshot` is populated by an
 * external nightly pipeline (the upstream ETL) that is currently writing zeros for `total_sends`.
 * Rather than trust the stale snapshot, the Mailer page reads live orders straight
 * from thanks.io. This module never writes — it only lists orders and reads
 * per-order delivery tracking.
 *
 * The API key is a server-only secret (THANKS_API_KEY) and must never be prefixed
 * with NEXT_PUBLIC_ or reach the browser. Normalized orders contain no PII
 * (recipient names/addresses are never fetched), so they are safe to pass to
 * client components on the manager-only Mailer page.
 */

const API_BASE = "https://api.thanks.io/api/v2";
const MAX_PAGES = 500; // safety cap so a bad `next` link can't loop forever
const TRACK_CONCURRENCY = 8;
const REVALIDATE_SECONDS = 900;

/** Raw order shape from GET /orders/list (only the fields we consume). */
interface ThanksioOrderRaw {
  id: number;
  type: string;
  display_type: string;
  size: string | null;
  status: string;
  method: string;
  style: number | null;
  front_image: string | null;
  grand_total: number | null;
  order_total: number | null;
  total_recipients: number | null;
  recipient_count: number | null;
  total_scans: number | null;
  created_at: string;
  updated_at: string;
}

interface OrdersListResponse {
  data: ThanksioOrderRaw[];
  links: { next: string | null };
  meta: { total: number };
}

interface TrackResponse {
  data: {
    stats: {
      delivered: number;
      processing: number;
      printed: number;
      in_transit: number;
      in_local_area: number;
      processed_for_delivery: number;
      re_routed: number;
      returned_to_sender: number;
      failed: number;
      scans: number;
      multi_scans: number;
    };
  };
}

/** Per-item delivery pipeline counts from GET /orders/{id}/track. */
export interface DeliveryStats {
  delivered: number;
  processedForDelivery: number;
  inLocalArea: number;
  inTransit: number;
  printed: number;
  processing: number;
  reRouted: number;
  returnedToSender: number;
  failed: number;
}

/** Normalized order — serializable, no PII, safe for the manager-only client UI. */
export interface ThanksioOrder {
  id: number;
  /** e.g. "Postcard-4x6" */
  displayType: string;
  status: string;
  /** "API" | "Campaign" | ... — how the order was placed */
  method: string;
  /** Creative front image URL; groups orders by design. */
  frontImage: string | null;
  /**
   * Image-template name for this creative. The account names each template
   * after the agent it belongs to (e.g. "eric-m", "john-si"), so this is the
   * per-agent attribution key. null when the front image matches no template.
   */
  templateName: string | null;
  cards: number;
  scans: number;
  /** Order cost in cents (thanks.io grand_total). */
  costCents: number;
  /** ISO timestamp the order was created (== send date). */
  createdAt: string;
  /** null when the track call failed for this order. */
  delivery: DeliveryStats | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function apiKey(): string {
  const key = process.env.THANKS_API_KEY;
  if (!key) {
    throw new Error("Missing THANKS_API_KEY (server-only var in .env / .env.local).");
  }
  return key;
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `thanks.io ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
    );
  }
  return (await res.json()) as T;
}

async function fetchAllOrders(): Promise<ThanksioOrderRaw[]> {
  const orders: ThanksioOrderRaw[] = [];
  let url: string | null = `${API_BASE}/orders/list?items_per_page=100`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const json: OrdersListResponse = await apiGet<OrdersListResponse>(url);
    if (Array.isArray(json.data)) orders.push(...json.data);
    url = json.links?.next ?? null;
  }
  return orders;
}

interface ImageTemplateRaw {
  name: string;
  image: string | null;
}

interface ImageTemplatesResponse {
  data: ImageTemplateRaw[];
  links: { next: string | null };
}

/** front-image URL -> template name (the account names templates per agent). */
async function fetchTemplateNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    let url: string | null = `${API_BASE}/image-templates?items_per_page=100`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const json: ImageTemplatesResponse = await apiGet<ImageTemplatesResponse>(url);
      for (const t of json.data ?? []) {
        if (t.image && t.name) map.set(t.image, t.name);
      }
      url = json.links?.next ?? null;
    }
  } catch {
    // Template names are enrichment only — orders still render without them.
  }
  return map;
}

/** Track calls are per-order; run them in small parallel chunks, tolerate failures. */
async function fetchDelivery(ids: number[]): Promise<Map<number, DeliveryStats>> {
  const out = new Map<number, DeliveryStats>();
  for (let i = 0; i < ids.length; i += TRACK_CONCURRENCY) {
    const chunk = ids.slice(i, i + TRACK_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((id) => apiGet<TrackResponse>(`${API_BASE}/orders/${id}/track`))
    );
    results.forEach((r, j) => {
      if (r.status !== "fulfilled") return;
      const s = r.value?.data?.stats;
      if (!s) return;
      out.set(chunk[j], {
        delivered: num(s.delivered),
        processedForDelivery: num(s.processed_for_delivery),
        inLocalArea: num(s.in_local_area),
        inTransit: num(s.in_transit),
        printed: num(s.printed),
        processing: num(s.processing),
        reRouted: num(s.re_routed),
        returnedToSender: num(s.returned_to_sender),
        failed: num(s.failed),
      });
    });
  }
  return out;
}

/**
 * Every order on the account, normalized and enriched with per-order delivery
 * tracking. Sorted ascending by created_at. All aggregation (filters, funnel,
 * spend, creative breakdown) happens downstream from this one dataset.
 */
export async function getThanksioOrders(): Promise<ThanksioOrder[]> {
  const [raw, templateNames] = await Promise.all([fetchAllOrders(), fetchTemplateNames()]);
  const delivery = await fetchDelivery(raw.map((o) => o.id));

  return raw
    .map((o) => ({
      id: o.id,
      displayType: o.display_type || o.type,
      status: o.status,
      method: o.method,
      frontImage: o.front_image || null,
      templateName: (o.front_image && templateNames.get(o.front_image)) || null,
      // "Reviewing" orders report total_recipients=0 until processed while
      // recipient_count already reflects the queued cards — take the max so
      // freshly-fired sends aren't undercounted vs the thanks.io dashboard.
      cards: Math.max(num(o.total_recipients), num(o.recipient_count)),
      scans: num(o.total_scans),
      costCents: num(o.grand_total ?? o.order_total),
      createdAt: o.created_at,
      delivery: delivery.get(o.id) ?? null,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
