import { NextRequest, NextResponse } from "next/server";
import { createAuthClient } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Completes the OAuth flow: exchanges the code for a session cookie. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login?error=auth`);

  const supabase = await createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("auth/callback:", error);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  return NextResponse.redirect(`${origin}/`);
}
