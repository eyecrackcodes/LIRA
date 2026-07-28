import { NextRequest, NextResponse } from "next/server";
import { createAuthClient } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Kicks off the Google OAuth dance via Supabase Auth. */
export async function GET(req: NextRequest) {
  const supabase = await createAuthClient();
  const origin = req.nextUrl.origin;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error || !data.url) {
    console.error("auth/google:", error);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  return NextResponse.redirect(data.url);
}
