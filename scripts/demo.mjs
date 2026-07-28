// Launches the app in DEMO mode (fake warehouse, fictional people).
//   node scripts/demo.mjs [dev|start|build] [port] [--live]
//
// --live keeps your real LLM key so "Ask Coach" answers for real against the
// fake data (DEMO_COACH=1 does the same). Everything else stays blocked.
//
// Why a launcher instead of `.env.demo` alone: Next always loads `.env.local`
// too, and that file holds the REAL Supabase/vendor keys. @next/env never
// overrides a variable that is already present in process.env, so setting them
// here (to "") wins over the file and guarantees the demo cannot reach a real
// service. Empty string — not delete — is what makes them stick.
import { spawn } from "node:child_process";

// dev = hot reload; build = compile with fixtures (so nothing real can be
// baked into prerendered output); start = serve that build (best for recording).
// Flags are filtered out of the positional args so `start 3010 --live` and
// `start --live` both parse the port correctly.
const argv = process.argv.slice(2);
const live = argv.includes("--live") || process.env.DEMO_COACH === "1";
const positional = argv.filter((a) => !a.startsWith("-"));
const mode = positional[0] === "start" || positional[0] === "build" ? positional[0] : "dev";
const port = positional[1] ?? "3010";

const env = {
  ...process.env,
  DEMO_MODE: "1",
  AUTH_DISABLED: "1",
  // Hard-block every outbound vendor call. Film Room playback returns a
  // disabled notice; Coach is blocked too unless --live was passed.
  ATTENTION_API_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  ...(live ? { DEMO_COACH: "1" } : { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }),
};

if (live && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
  console.warn(
    "\n  ⚠  --live was passed but no ANTHROPIC_API_KEY / OPENAI_API_KEY is set in\n" +
      "     your environment or .env.local, so Coach will still show as not\n" +
      "     configured. Add one and re-run.\n"
  );
}

console.log(
  `\n  Franchise Mode — DEMO (${mode})\n` +
    `  http://localhost:${port}\n\n` +
    `  Fictional roster, fictional clients, fictional pay. No real data, no network calls.\n` +
    (env.DEV_VIEWER_AGENT
      ? `  Viewing as AGENT: ${env.DEV_VIEWER_AGENT}\n`
      : `  Viewing as MANAGER. Set DEV_VIEWER_AGENT="Bianca Ortiz" to record the agent view.\n`) +
    (live
      ? `  Ask Coach: LIVE — real model, fake data. Floating dock is on every page.\n`
      : `  Ask Coach: off. Run \`npm run demo:live\` to demo it for real.\n`)
);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  mode === "build" ? ["next", "build"] : ["next", mode, "-p", port],
  { stdio: "inherit", env, shell: process.platform === "win32" }
);
child.on("exit", (code) => process.exit(code ?? 0));
