import { NextRequest, NextResponse } from "next/server";
import { createAuthClient } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${req.nextUrl.origin}/login`, { status: 303 });
}
