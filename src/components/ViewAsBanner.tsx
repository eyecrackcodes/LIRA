"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { stopViewAs } from "@/app/(app)/view-as/actions";

/** The unmissable strip shown while a manager is previewing an agent's view. */
export default function ViewAsBanner({ agent }: { agent: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/50 bg-warn/15 px-4 py-1.5 text-xs text-warn">
      <span>
        <span className="display font-bold uppercase tracking-widest">Viewing as</span>{" "}
        <strong className="font-semibold">{agent}</strong> — this is exactly what they see.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await stopViewAs();
            router.refresh();
          })
        }
        className="display rounded-sm border border-warn/60 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider transition-colors motion-reduce:transition-none hover:bg-warn/20 disabled:opacity-60"
      >
        {pending ? "Exiting…" : "Exit view"}
      </button>
    </div>
  );
}
