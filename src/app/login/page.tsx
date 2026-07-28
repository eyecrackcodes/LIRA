import ThemeToggle from "@/components/ThemeToggle";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-4">
      <div className="w-full max-w-sm rounded-md border border-edge bg-panel p-8 text-center">
        <div className="mb-1 flex items-center justify-center gap-2">
          <span className="display text-2xl font-bold uppercase tracking-widest text-gold">
            {BRAND.mark}
          </span>
          <span className="display text-2xl font-semibold uppercase tracking-widest text-ink">
            {BRAND.name}
          </span>
        </div>
        <p className="mb-8 text-[11px] uppercase tracking-wider text-faint">
          {BRAND.tagline}
        </p>

        {error && (
          <div className="mb-4 rounded-sm border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
            {error === "auth"
              ? "Sign-in didn't complete — try again."
              : "Something went wrong — try again."}
          </div>
        )}

        <a
          href="/auth/google"
          className="display block w-full rounded-sm border border-gold-dim bg-navy px-4 py-3 text-sm font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold-dim/20"
        >
          Sign in with Google
        </a>

        <p className="mt-6 text-[11px] leading-relaxed text-faint">
          Use your work Google account. Access is limited to the active roster and management —
          no self-service signup.
        </p>
      </div>
      <div className="w-full max-w-sm">
        <ThemeToggle compact />
      </div>
    </div>
  );
}
