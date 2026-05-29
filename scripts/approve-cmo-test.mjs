import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const nowIso = () => new Date().toISOString();

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

function projectRefFromUrl(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

function projectRefFromJwt(value) {
  if (!value || value.split(".").length !== 3) return "";
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return payload.ref || "";
  } catch {
    return "";
  }
}

function requireClient() {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  const urlRef = projectRefFromUrl(url);
  const keyRef = projectRefFromJwt(key);
  if (urlRef && keyRef && urlRef !== keyRef) throw new Error(`Supabase env mismatch: URL ref ${urlRef} does not match service role ref ${keyRef}.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function writeAudit(client, row) {
  const { error } = await client.from("audit_logs").insert({
    tenant_id: row.tenant_id,
    action_type: "cmo_realtime_test_cli_approved",
    action: "cmo_realtime_test_cli_approved",
    module: "CMO Realtime Approval Test",
    related_table: "content_history",
    related_record_id: row.id,
    record_type: "content_history",
    record_id: row.id,
    actor: "CMO Test CLI",
    actor_role: "Developer Test Runner",
    description: "Realtime CMO test package approved from CLI helper.",
    notes: "CLI test approval only. No public publishing is triggered by this command.",
    risk_level: "Low",
    metadata: {
      run_id: row.run_id,
      test_mode: true,
      realtime_approval_test: true,
      simulated_pipeline: false,
      no_public_publish: true,
      cleanup_key: row.metadata?.cleanup_key || ""
    }
  });
  if (error) throw new Error(`audit_logs insert failed: ${error.message}`);
}

async function main() {
  loadLocalEnv();
  const runId = argValue("run_id");
  if (!runId) throw new Error("Missing --run_id=<run_id>.");
  const client = requireClient();
  const { data: row, error } = await client.from("content_history").select("id,tenant_id,run_id,approval_status,publish_status,metadata").eq("run_id", runId).maybeSingle();
  if (error) throw new Error(`content_history lookup failed: ${error.message}`);
  if (!row?.id) throw new Error(`No test row found for run_id=${runId}.`);
  if (row.metadata?.test_mode !== true || row.metadata?.realtime_approval_test !== true) throw new Error("Refusing to approve non-realtime test row.");
  if (row.metadata?.simulated_pipeline !== false) throw new Error("Refusing row that is already in simulated pipeline mode.");

  const approvedAt = nowIso();
  const update = await client.from("content_history").update({
    approval_status: "approved",
    publish_status: "queued",
    approved_at: approvedAt,
    approved_at_utc: approvedAt,
    metadata: {
      ...row.metadata,
      current_step: 7,
      workflow_stage: "publishing",
      approved_by_cli: true,
      no_public_publish: true
    }
  }).eq("id", row.id).eq("metadata->>test_mode", "true").select("id,tenant_id,run_id,approval_status,publish_status,metadata").maybeSingle();
  if (update.error) throw new Error(`content_history approval update failed: ${update.error.message}`);
  if (!update.data?.id) throw new Error("Approval update returned no row.");

  const approval = await client.from("content_approvals").update({
    approval_status: "approved",
    status: "Approved",
    approved_at: approvedAt,
    approved_at_utc: approvedAt,
    notes: "Approved by CMO test CLI helper."
  }).eq("content_history_id", row.id);
  if (approval.error) throw new Error(`content_approvals update failed: ${approval.error.message}`);

  await writeAudit(client, update.data);
  console.log(JSON.stringify({ ok: true, run_id: runId, approval_status: "approved", publish_status: "queued", next: "Run npm run test:cmo-realtime-approval-10 -- --poll to continue Step 7-9, or approve while the poller is running." }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
