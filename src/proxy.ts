import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Session guard (Next 16 proxy). Refreshes the Supabase session cookie and
 * bounces signed-out visitors to /login. Role checks (manager vs agent) live
 * in the server layouts/pages — this layer only answers "signed in at all?".
 */

// /api/weekly-email validates its own access (manager session OR feed token)
// so a future n8n/cron sender can pull it without a browser session.
const PUBLIC_PATHS = [/^\/login$/, /^\/auth\//, /^\/api\/weekly-email$/];

export async function proxy(request: NextRequest) {
  // Local escape hatch while Google OAuth isn't configured yet — remove the
  // env var (never set it in production) and the gate snaps back on.
  if (process.env.AUTH_DISABLED === "1") return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and auth.getUser() —
  // it can cause random logouts (Supabase SSR docs).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((re) => re.test(path));

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Everything except static assets and the agent headshots.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|agents/).*)"],
};
