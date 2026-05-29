import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runCmoPublishingEngine } from "../lib/cmoPublishingEngine.mjs";
import { runCmoAnalyticsEngine } from "../lib/cmoAnalyticsEngine.mjs";
import { runCmoOptimizationEngine } from "../lib/cmoOptimizationEngine.mjs";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runPrefix = `cmo-realtime-approval-${Date.now()}`;
const packageCount = 10;
const pollIntervalMs = Number(process.env.CMO_REALTIME_POLL_INTERVAL_MS || 10000);
const timeoutMs = Number(process.env.CMO_REALTIME_TIMEOUT_MS || 15 * 60 * 1000);
const shouldPoll = process.argv.includes("--poll") || process.env.CMO_REALTIME_POLL === "true";
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

function env(name) {
  return process.env[name]?.trim() || "";
}

function supabaseUrl() {
  return env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
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
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  const urlRef = projectRefFromUrl(url);
  const keyRef = projectRefFromJwt(key);
  if (urlRef && keyRef && urlRef !== keyRef) throw new Error(`Supabase env mismatch: URL ref ${urlRef} does not match service role ref ${keyRef}.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveTenantId(client) {
  const known = await client.from("tenants").select("id").eq("id", defaultTenantId).maybeSingle();
  if (known.error && known.error.code !== "PGRST116") throw new Error(`Tenant lookup failed: ${known.error.message}`);
  if (known.data?.id) return known.data.id;
  const fallback = await client.from("tenants").select("id").limit(1).maybeSingle();
  if (fallback.error) throw new Error(`Tenant fallback failed: ${fallback.error.message}`);
  if (!fallback.data?.id) throw new Error("No tenant row exists.");
  return fallback.data.id;
}

async function writeAudit(client, tenantId, contentHistoryId, actionType, description, metadata = {}) {
  const { error } = await client.from("audit_logs").insert({
    tenant_id: tenantId,
    action_type: actionType,
    action: actionType,
    module: "CMO Realtime Approval Test",
    related_table: "content_history",
    related_record_id: contentHistoryId || null,
    record_type: "content_history",
    record_id: contentHistoryId || "",
    actor: "CMO Realtime Test Runner",
    actor_role: "Developer Test Runner",
    description,
    notes: description,
    risk_level: "Low",
    metadata: {
      test_mode: true,
      realtime_approval_test: true,
      simulated_pipeline: false,
      no_public_publish: true,
      cleanup_key: runPrefix,
      ...metadata
    }
  });
  if (error) throw new Error(`audit_logs insert failed: ${error.message}`);
}

async function sendSlackApprovalMessage(runId, index) {
  const webhookUrl = env("SLACK_WEBHOOK_URL") || env("SLACK_APPROVAL_WEBHOOK_URL");
  const channelDisplay = env("SLACK_CHANNEL_NAME_FOR_DISPLAY") || "#all-gopu-os";
  if (!webhookUrl) return { ok: false, status: "not_configured" };
  if (!/^https:\/\/hooks\.slack(?:-gov)?\.com\/services\//i.test(webhookUrl)) return { ok: false, status: "invalid_webhook" };

  const text = [
    "DEV TEST - GOPU OS CMO realtime approval test",
    "",
    `Slack channel display: ${channelDisplay}`,
    `Run ID: ${runId}`,
    `Package: ${index + 1}/${packageCount}`,
    "Platform: LinkedIn",
    "Approval Status: WAITING",
    "",
    "Action Required:",
    `Approve from GOPU OS UI or run: npm run approve:cmo-test -- --run_id=${runId}`,
    "",
    "No public publishing will occur. Step 7 is dry-run only."
  ].join("\n");

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const body = await response.text().catch(() => "");
    return { ok: response.ok && body.trim() === "ok", status: response.ok ? "sent" : "failed", http_status: response.status, channel_display: channelDisplay };
  } catch {
    return { ok: false, status: "failed", channel_display: channelDisplay };
  }
}

async function createPackage(client, tenantId, index) {
  const runId = `${runPrefix}-${String(index + 1).padStart(2, "0")}`;
  const metadata = {
    test_mode: true,
    realtime_approval_test: true,
    simulated_pipeline: false,
    cleanup_key: runPrefix,
    no_public_publish: true,
    current_step: 6,
    workflow_stage: "approval"
  };
  const { data: history, error } = await client.from("content_history").insert({
    tenant_id: tenantId,
    run_id: runId,
    platform: "LinkedIn",
    platform_target: "LinkedIn",
    platform_targets: ["LinkedIn"],
    content_type: "Post",
    campaign_name: "CMO realtime approval test",
    topic: "Founder approval gated workflow validation",
    caption: `DEV TEST ${index + 1}: GOPU OS CMO approval-gated post. This must never publish publicly.`,
    generated_text: `DEV TEST ${index + 1}: GOPU OS CMO approval-gated post. This must never publish publicly.`,
    image_prompt: "Test-only CMO approval workflow poster prompt.",
    hashtags: ["#GOPUOS", "#RealtimeApproval", "#TestMode"],
    approval_status: "waiting",
    publish_status: "pending",
    generated_at: nowIso(),
    generated_at_utc: nowIso(),
    timezone: "Asia/Kolkata",
    country: "India",
    metadata
  }).select("id,tenant_id,run_id,approval_status,publish_status,metadata").maybeSingle();
  if (error) throw new Error(`content_history insert failed: ${error.message}`);
  if (history.metadata?.test_mode !== true || history.metadata?.simulated_pipeline !== false) throw new Error("Realtime package metadata safety flags are invalid.");

  const approval = await client.from("content_approvals").insert({
    tenant_id: tenantId,
    content_history_id: history.id,
    run_id: runId,
    approval_status: "waiting",
    status: "Waiting",
    slack_approval_id: `realtime-${runId}`,
    slack_message_reference: { test_mode: true, realtime_approval_test: true, run_id: runId },
    notes: "Realtime test approval request. No public publishing is allowed.",
    timezone: "Asia/Kolkata",
    country: "India"
  }).select("id").maybeSingle();
  if (approval.error) throw new Error(`content_approvals insert failed: ${approval.error.message}`);

  await writeAudit(client, tenantId, history.id, "cmo_realtime_test_created", "Realtime CMO test package created and waiting for approval.", { run_id: runId, step: 6 });
  const slack = await sendSlackApprovalMessage(runId, index);
  if (slack.ok) await writeAudit(client, tenantId, history.id, "cmo_realtime_slack_approval_sent", "Realtime Slack approval test message sent.", { run_id: runId, slack_status: slack.status, slack_channel_display: slack.channel_display || "#all-gopu-os" });
  return {
    run_id: runId,
    content_history_id: history.id,
    slack_sent: slack.ok,
    slack_status: slack.status,
    slack_channel_display: slack.channel_display || "#all-gopu-os",
    waiting_for_approval: history.approval_status === "waiting",
    approved: false,
    step7: "not_started",
    step8: "not_started",
    step9: "not_started",
    cleanup_status: "not_cleanup_requested"
  };
}

async function readPackage(client, row) {
  const { data, error } = await client.from("content_history").select("id,tenant_id,run_id,approval_status,publish_status,metadata").eq("id", row.content_history_id).maybeSingle();
  if (error) throw new Error(`content_history poll failed for ${row.run_id}: ${error.message}`);
  if (!data?.id) return null;
  if (data.metadata?.test_mode !== true) throw new Error(`Refusing non-test row ${data.id}.`);
  return data;
}

async function continueAfterApproval(client, row) {
  const current = await readPackage(client, row);
  if (!current || current.approval_status !== "approved") return row;

  const prepared = await client.from("content_history").update({
    publish_status: "queued",
    approved_at: current.approved_at || nowIso(),
    approved_at_utc: current.approved_at_utc || nowIso(),
    metadata: { ...current.metadata, simulated_pipeline: true, current_step: 7, workflow_stage: "publishing", no_public_publish: true }
  }).eq("id", current.id).eq("approval_status", "approved").select("id").maybeSingle();
  if (prepared.error) throw new Error(`approval preparation failed for ${row.run_id}: ${prepared.error.message}`);

  const publish = await runCmoPublishingEngine({ client, dryRun: true, contentHistoryId: current.id, limit: 1 });
  row.step7 = publish.ok && publish.results?.[0]?.status === "dry_run_passed" ? "pass" : "fail";
  if (row.step7 !== "pass") return row;

  const analytics = await runCmoAnalyticsEngine({ client, dryRun: true, contentHistoryId: current.id, limit: 1 });
  row.step8 = analytics.ok && analytics.results?.[0]?.status === "collected" ? "pass" : "fail";
  if (row.step8 !== "pass") return row;

  const optimization = await runCmoOptimizationEngine({ client, dryRun: true, contentHistoryId: current.id, limit: 1 });
  row.step9 = optimization.ok && optimization.results?.[0]?.status === "completed" ? "pass" : "fail";
  row.approved = true;
  return row;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForApprovals(client, rows) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const row of rows) {
      if (row.step9 === "pass") continue;
      const current = await readPackage(client, row);
      if (current?.approval_status === "approved") await continueAfterApproval(client, row);
    }
    if (rows.every((row) => row.step9 === "pass")) break;
    await sleep(pollIntervalMs);
  }
  for (const row of rows) {
    if (!row.approved) row.waiting_timeout = true;
  }
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  const tenantId = await resolveTenantId(client);
  const rows = [];
  for (let index = 0; index < packageCount; index += 1) {
    rows.push(await createPackage(client, tenantId, index));
  }

  if (shouldPoll) await pollForApprovals(client, rows);

  const summary = {
    ok: true,
    cleanup_key: runPrefix,
    created: rows.length,
    waiting_for_approval: rows.filter((row) => row.waiting_for_approval && !row.approved).length,
    slack_messages_sent: rows.filter((row) => row.slack_sent).length,
    slack_channel_display: env("SLACK_CHANNEL_NAME_FOR_DISPLAY") || "#all-gopu-os",
    approved: rows.filter((row) => row.approved).length,
    completed_step_1_9: rows.filter((row) => row.step7 === "pass" && row.step8 === "pass" && row.step9 === "pass").length,
    polling_enabled: shouldPoll,
    poll_interval_ms: shouldPoll ? pollIntervalMs : 0,
    timeout_ms: shouldPoll ? timeoutMs : 0,
    rows
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
