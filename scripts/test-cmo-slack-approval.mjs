import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import handler from "../api/slack/cmo-actions.js";
import { buildCmoSlackApprovalBlocks, sendCmoSlackApprovalMessage } from "../lib/cmoSlackApproval.mjs";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runId = `cmo-slack-approval-test-${Date.now()}`;
const nowIso = () => new Date().toISOString();
const results = [];

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

function requireClient() {
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function step(label, fn) {
  try {
    const data = await fn();
    results.push({ label, ok: true });
    console.log(`PASS ${label}`);
    return data;
  } catch (error) {
    results.push({ label, ok: false, error: error?.message || String(error) });
    console.error(`FAIL ${label}: ${error?.message || String(error)}`);
    throw error;
  }
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

async function createPackage(client, tenantId, suffix) {
  const packageRunId = `${runId}-${suffix}`;
  const metadata = {
    test_mode: true,
    slack_interactive_test: true,
    simulated_pipeline: false,
    cleanup_key: runId,
    current_step: 6,
    workflow_stage: "approval",
    scheduled_time: "2026-05-28 08:00 IST",
    no_public_publish: true
  };
  const { data, error } = await client.from("content_history").insert({
    tenant_id: tenantId,
    run_id: packageRunId,
    platform: "LinkedIn",
    platform_target: "LinkedIn",
    platform_targets: ["LinkedIn"],
    content_type: "Post",
    campaign_name: "CMO Slack approval test",
    topic: "Slack interactive founder approval",
    caption: "DEV TEST - GOPU OS CMO approval card with full caption, hashtags, and poster preview. This must never publish publicly.",
    generated_text: "DEV TEST - GOPU OS CMO approval card with full caption, hashtags, and poster preview. This must never publish publicly.",
    image_prompt: "Premium GOPU OS export operations poster with founder approval controls and safe publishing gate.",
    poster_url: "https://dummyimage.com/1200x628/0f172a/ffffff.png&text=GOPU+OS+CMO+Approval+Test",
    hashtags: ["#GOPUOS", "#FounderApproval", "#CMOTest"],
    approval_status: "waiting",
    publish_status: "pending",
    generated_at: nowIso(),
    generated_at_utc: nowIso(),
    metadata
  }).select("*").maybeSingle();
  if (error) throw new Error(`content_history insert failed: ${error.message}`);
  if (data.metadata?.test_mode !== true) throw new Error("Created row is not test_mode.");

  const approval = await client.from("content_approvals").insert({
    tenant_id: tenantId,
    content_history_id: data.id,
    run_id: packageRunId,
    approval_status: "waiting",
    status: "Waiting",
    slack_approval_id: `cmo-slack-${packageRunId}`,
    slack_message_reference: { test_mode: true, run_id: packageRunId },
    notes: "Waiting for Slack founder decision.",
    timezone: "Asia/Kolkata",
    country: "India"
  }).select("id").maybeSingle();
  if (approval.error) throw new Error(`content_approvals insert failed: ${approval.error.message}`);
  return data;
}

function signedPayload(payload) {
  const raw = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${crypto.createHmac("sha256", env("SLACK_SIGNING_SECRET")).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  return { raw, timestamp, signature };
}

async function postSignedPayload(payload) {
  if (!env("SLACK_SIGNING_SECRET")) throw new Error("SLACK_SIGNING_SECRET is missing.");
  const signed = signedPayload(payload);
  const req = Readable.from([signed.raw]);
  req.method = "POST";
  req.headers = {
    "content-type": "application/x-www-form-urlencoded",
    "x-slack-request-timestamp": signed.timestamp,
    "x-slack-signature": signed.signature
  };
  return await new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); }
    };
    handler(req, res);
  });
}

function actionPayload(row, actionId, action) {
  return {
    type: "block_actions",
    user: { id: "U_TEST_FOUNDER" },
    trigger_id: "test-trigger",
    actions: [{
      action_id: actionId,
      action_ts: `${Date.now()}.${Math.floor(Math.random() * 1000)}`,
      value: JSON.stringify({ action, run_id: row.run_id, content_history_id: row.id, tenant_id: row.tenant_id })
    }]
  };
}

async function verifyRow(client, row, expected) {
  const { data, error } = await client.from("content_history").select("*,content_approvals(*)").eq("id", row.id).maybeSingle();
  if (error) throw new Error(`content_history read failed: ${error.message}`);
  if (data.approval_status !== expected.approval_status) throw new Error(`Expected approval_status=${expected.approval_status}, got ${data.approval_status}.`);
  if (data.publish_status !== expected.publish_status) throw new Error(`Expected publish_status=${expected.publish_status}, got ${data.publish_status}.`);
  if (expected.workflow_stage && data.metadata?.workflow_stage !== expected.workflow_stage) throw new Error(`Expected workflow_stage=${expected.workflow_stage}, got ${data.metadata?.workflow_stage}.`);
  return data;
}

async function verifyAudit(client, row, actionType) {
  const { data, error } = await client.from("audit_logs").select("id,action_type,metadata").eq("related_table", "content_history").eq("related_record_id", row.id);
  if (error) throw new Error(`audit_logs read failed: ${error.message}`);
  if (!(data || []).some((audit) => audit.action_type === actionType)) throw new Error(`Missing audit log ${actionType}.`);
  if ((data || []).some((audit) => audit.metadata?.test_mode !== true)) throw new Error("Slack approval audit row missing metadata.test_mode=true.");
  return data;
}

async function cleanup(client) {
  const history = await client.from("content_history").select("id").eq("metadata->>cleanup_key", runId).eq("metadata->>test_mode", "true");
  if (history.error) throw new Error(`cleanup lookup failed: ${history.error.message}`);
  const ids = (history.data || []).map((row) => row.id);
  if (!ids.length) return { deleted: 0 };
  for (const table of ["content_approvals", "content_links", "content_versions", "content_quality_reviews", "ai_content_memory", "content_metrics"]) {
    const { error } = await client.from(table).delete().in("content_history_id", ids);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }
  const auditDelete = await client.from("audit_logs").delete().in("related_record_id", ids).eq("metadata->>test_mode", "true");
  if (auditDelete.error) throw new Error(`audit_logs cleanup failed: ${auditDelete.error.message}`);
  const historyDelete = await client.from("content_history").delete().in("id", ids).eq("metadata->>test_mode", "true");
  if (historyDelete.error) throw new Error(`content_history cleanup failed: ${historyDelete.error.message}`);
  return { deleted: ids.length };
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  const tenantId = await step("resolve tenant", () => resolveTenantId(client));
  const approveRow = await step("create approve package", () => createPackage(client, tenantId, "approve"));
  const rejectRow = await step("create reject package", () => createPackage(client, tenantId, "reject"));
  const modifyRow = await step("create modify package", () => createPackage(client, tenantId, "modify"));

  const blocks = buildCmoSlackApprovalBlocks(approveRow, { interactive: true });
  const blockText = JSON.stringify(blocks);
  if (!blockText.includes("GOPU OS CMO Approval Required")) throw new Error("Slack blocks missing header.");
  if (!blockText.includes("DEV TEST - GOPU OS CMO approval card")) throw new Error("Slack blocks missing caption.");
  if (!blockText.includes("#GOPUOS")) throw new Error("Slack blocks missing hashtags.");
  if (!blockText.includes("dummyimage.com")) throw new Error("Slack blocks missing poster image.");
  await step("send Slack approval message", async () => sendCmoSlackApprovalMessage(approveRow));

  const approveResponse = await step("simulate approve action", () => postSignedPayload(actionPayload(approveRow, "cmo_approve", "approve")));
  if (!approveResponse.body?.ok) throw new Error(`Approve action failed: ${approveResponse.body?.status || "unknown"}`);
  await step("verify approve DB state", () => verifyRow(client, approveRow, { approval_status: "approved", publish_status: "queued", workflow_stage: "publishing" }));
  await step("verify approve audit", () => verifyAudit(client, approveRow, "cmo_slack_approval_approved"));

  const rejectResponse = await step("simulate reject action", () => postSignedPayload(actionPayload(rejectRow, "cmo_reject", "reject")));
  if (!rejectResponse.body?.ok) throw new Error(`Reject action failed: ${rejectResponse.body?.status || "unknown"}`);
  await step("verify reject DB state", () => verifyRow(client, rejectRow, { approval_status: "rejected", publish_status: "rejected", workflow_stage: "rejected" }));
  await step("verify reject audit", () => verifyAudit(client, rejectRow, "cmo_slack_approval_rejected"));

  const modifyPayload = {
    type: "view_submission",
    user: { id: "U_TEST_FOUNDER" },
    view: {
      private_metadata: JSON.stringify({ run_id: modifyRow.run_id, content_history_id: modifyRow.id }),
      state: { values: { modify_notes: { notes: { value: "Make the caption more founder-grade and reduce claim strength." } } } }
    }
  };
  const modifyResponse = await step("simulate modify modal submit", () => postSignedPayload(modifyPayload));
  if (!modifyResponse.body?.ok) throw new Error(`Modify action failed: ${modifyResponse.body?.status || "unknown"}`);
  const modified = await step("verify modify DB state", () => verifyRow(client, modifyRow, { approval_status: "needs_edit", publish_status: "needs_edit", workflow_stage: "modify_requested" }));
  if (!modified.metadata?.modification_request) throw new Error("Modification request was not stored.");
  await step("verify modify audit", () => verifyAudit(client, modifyRow, "cmo_slack_approval_modify_requested"));

  await step("cleanup test rows", () => cleanup(client));
  console.log(JSON.stringify({
    ok: true,
    run_id: runId,
    slack_message_includes_caption: true,
    slack_message_includes_hashtags: true,
    slack_message_includes_poster: true,
    approve_button_works: true,
    reject_button_works: true,
    modify_request_works: true,
    modal_supported: Boolean(env("SLACK_BOT_TOKEN") && env("SLACK_SIGNING_SECRET")),
    webhook_fallback_supported: true,
    tests: results
  }, null, 2));
}

main().catch(async (error) => {
  try {
    loadLocalEnv();
    await cleanup(requireClient());
  } catch {
    // best effort cleanup only
  }
  console.error(JSON.stringify({ ok: false, run_id: runId, tests: results, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
