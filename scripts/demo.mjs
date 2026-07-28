// Launches the app in DEMO mode (fake warehouse, fictional people).
//   node scripts/demo.mjs [dev|start] [port]
//
// Why a launcher instead of `.env.demo` alone: Next always loads `.env.local`
// too, and that file holds the REAL Supabase/vendor keys. @next/env never
// overrides a variable that is already present in process.env, so setting them
// here (to "") wins over the file and guarantees the demo cannot reach a real
// service. Empty string — not delete — is what makes them stick.
import { spawn } from "node:child_process";

// dev = hot reload; build = compile with fixtures (so nothing real can be
// baked into prerendered output); start = serve that build (best for recording).
const arg = process.argv[2];
const mode = arg === "start" || arg === "build" ? arg : "dev";
const port = process.argv[3] ?? "3010";

const env = {
  ...process.env,
  DEMO_MODE: "1",
  AUTH_DISABLED: "1",
  // Hard-block every outbound vendor call. Ask Coach renders its
  // "not configured" state; Film Room playback returns a disabled notice.
  ATTENTION_API_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  ...(process.env.DEMO_COACH === "1" ? {} : { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" }),
};

console.log(
  `\n  Franchise Mode — DEMO (${mode})\n` +
    `  http://localhost:${port}\n\n` +
    `  Fictional roster, fictional clients, fictional pay. No real data, no network calls.\n` +
    (env.DEV_VIEWER_AGENT
      ? `  Viewing as AGENT: ${env.DEV_VIEWER_AGENT}\n`
      : `  Viewing as MANAGER. Set DEV_VIEWER_AGENT="Bianca Ortiz" to record the agent view.\n`) +
    (process.env.DEMO_COACH === "1"
      ? `  Ask Coach: LIVE (uses your real LLM key against fake data).\n`
      : `  Ask Coach: off. Set DEMO_COACH=1 to demo it live.\n`)
);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  mode === "build" ? ["next", "build"] : ["next", mode, "-p", port],
  { stdio: "inherit", env, shell: process.platform === "win32" }
);
child.on("exit", (code) => process.exit(code ?? 0));
