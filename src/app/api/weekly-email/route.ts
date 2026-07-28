import { NextRequest } from "next/server";
import { buildStackRank, renderStackRankEmail } from "@/lib/stackrank";
import { getViewer, isManager } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Raw email-safe HTML for the weekly stack-rank. Access: a signed-in manager,
 *  or ?token=WEEKLY_EMAIL_TOKEN so n8n/cron can pull it headlessly. */
export async function GET(req: NextRequest) {
  const token = process.env.WEEKLY_EMAIL_TOKEN;
  const tokenOk = Boolean(token) && req.nextUrl.searchParams.get("token") === token;
  const managerOk = isManager(await getViewer());
  if (!tokenOk && !managerOk) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  const stack = await buildStackRank();
  const html = renderStackRankEmail(stack);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
