import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { processCmoModifyRequest } from "../lib/cmoSlackApproval.mjs";

const root = process.cwd();

function loadLocalEnv() {
  for (const file of [".env", ".env.development", ".env.local"]) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) continue;
    for (const row of fs.readFileSync(target, "utf8").split(/\r?\n/)) {
      const match = row.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function env(name) {
  return process.env[name]?.trim() || "";
}

function requireClient() {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  loadLocalEnv();
  const runId = argValue("run_id");
  const notes = argValue("notes");
  if (!runId) throw new Error("Missing --run_id=<run_id>.");
  if (!notes) throw new Error("Missing --notes=\"...\".");
  const client = requireClient();
  const result = await processCmoModifyRequest({ client, runId, notes, slackUserId: "cli_fallback" });
  console.log(JSON.stringify({ ok: result.ok, run_id: runId, status: result.status, notes_saved: Boolean(notes) }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
