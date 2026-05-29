import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runId = `cmo-workflow-test-${Date.now()}`;
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
  if (urlRef && keyRef && urlRef !== keyRef) {
    throw new Error(`Supabase env mismatch: URL ref ${urlRef} does not match service role ref ${keyRef}.`);
  }
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

async function writeAudit(client, tenantId, contentHistoryId, actionType, description, metadata = {}) {
  const { data, error } = await client
    .from("audit_logs")
    .insert({
      tenant_id: tenantId,
      action_type: actionType,
      action: actionType,
      module: "CMO Workflow Integration Test",
      related_table: "content_history",
      related_record_id: contentHistoryId || null,
      record_type: "content_history",
      record_id: contentHistoryId || "",
      actor: "CMO Workflow Test",
      actor_role: "Developer Test Runner",
      description,
      notes: description,
      risk_level: "Low",
      metadata: {
        run_id: runId,
        test_mode: true,
        simulated_pipeline: true,
        no_public_publish: true,
        ...metadata
      }
    })
    .select("id,metadata")
    .maybeSingle();
  if (error) throw new Error(`audit_logs insert failed: ${error.message}`);
  if (data?.metadata?.test_mode !== true) throw new Error("Audit row missing metadata.test_mode=true.");
  return data.id;
}

function assertTestHistory(row) {
  if (!row?.id) throw new Error("Missing content_history row.");
  if (row.run_id !== runId) throw new Error(`Unexpected run_id ${row.run_id}.`);
  if (row.metadata?.test_mode !== true) throw new Error(`Refusing non-test content_history row ${row.id}.`);
}

async function readHistory(client, id) {
  const { data, error } = await client
    .from("content_history")
    .select("id,tenant_id,run_id,caption,generated_text,image_prompt,poster_url,image_url,approval_status,publish_status,metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`content_history read failed: ${error.message}`);
  assertTestHistory(data);
  return data;
}

async function assertRelatedRows(client, contentHistoryId, table, expected = 1) {
  const { data, error } = await client.from(table).select("id,run_id,content_history_id").eq("content_history_id", contentHistoryId);
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  if ((data || []).length < expected) throw new Error(`${table} expected at least ${expected} row(s), found ${data?.length || 0}.`);
  for (const row of data || []) {
    if (row.run_id && row.run_id !== runId) throw new Error(`${table} row ${row.id} has unexpected run_id ${row.run_id}.`);
    if (row.content_history_id !== contentHistoryId) throw new Error(`${table} row ${row.id} is not linked to content_history.`);
  }
  return data;
}

async function verifyNoProductionMix(client, contentHistoryId) {
  const history = await readHistory(client, contentHistoryId);
  const audit = await client.from("audit_logs").select("id,metadata").eq("metadata->>run_id", runId);
  if (audit.error) throw new Error(`audit_logs test-mode read failed: ${audit.error.message}`);
  for (const row of audit.data || []) {
    if (row.metadata?.test_mode !== true) throw new Error(`Audit row ${row.id} missing metadata.test_mode=true.`);
  }
  return { content_history_test_mode: history.metadata.test_mode === true, audit_rows: audit.data?.length || 0 };
}

async function step1CreateContentHistory(client, tenantId) {
  const metadata = {
    test_mode: true,
    simulated_pipeline: true,
    is_test: true,
    step: "cmo_workflow_1_6",
    cleanup_key: runId,
    no_public_publish: true
  };
  const { data, error } = await client
    .from("content_history")
    .insert({
      tenant_id: tenantId,
      run_id: runId,
      platform: "LinkedIn",
      platform_target: "LinkedIn",
      platform_targets: ["LinkedIn"],
      content_type: "Post",
      campaign_name: "CMO workflow integration test",
      topic: "Test-only founder approval workflow",
      approval_status: "waiting",
      publish_status: "pending",
      generated_at: nowIso(),
      generated_at_utc: nowIso(),
      timezone: "Asia/Kolkata",
      country: "India",
      metadata
    })
    .select("id,tenant_id,run_id,approval_status,publish_status,metadata")
    .maybeSingle();
  if (error) throw new Error(`content_history insert failed: ${error.message}`);
  assertTestHistory(data);
  await writeAudit(client, tenantId, data.id, "cmo_workflow_step1_content_history_created", "Step 1 created test content_history row.", { step: 1 });
  return data;
}

async function step2UpdateCaption(client, history) {
  const caption = "Test-only CMO workflow caption. This validates content memory linkage and must never be published.";
  const hashtags = ["#GOPUOS", "#CMOWorkflow", "#TestMode"];
  const imagePrompt = "Test-only export operations poster prompt with founder approval and content memory.";
  const { data, error } = await client
    .from("content_history")
    .update({
      caption,
      generated_text: caption,
      hashtags,
      image_prompt: imagePrompt,
      metadata: { ...history.metadata, test_mode: true, simulated_pipeline: true, step2_caption_saved: true }
    })
    .eq("id", history.id)
    .select("id,tenant_id,run_id,caption,generated_text,image_prompt,metadata")
    .maybeSingle();
  if (error) throw new Error(`content_history caption update failed: ${error.message}`);
  assertTestHistory(data);
  if (!data.caption || data.run_id !== runId) throw new Error("Step 2 caption was not linked to the same run_id.");

  const version = await client.from("content_versions").insert({
    tenant_id: history.tenant_id,
    content_history_id: history.id,
    run_id: runId,
    version_number: 1,
    version_type: "generated",
    caption,
    hashtags,
    image_prompt: imagePrompt,
    draft_text: caption,
    approval_status: "waiting",
    notes: "Test-only Step 2 generated content."
  });
  if (version.error) throw new Error(`content_versions insert failed: ${version.error.message}`);
  await writeAudit(client, history.tenant_id, history.id, "cmo_workflow_step2_caption_saved", "Step 2 saved generated caption using same run_id.", { step: 2 });
  return data;
}

async function step3LinkPoster(client, history) {
  const posterUrl = "https://example.invalid/gopu-os/test-only-cmo-workflow-poster.png";
  const { data, error } = await client
    .from("content_history")
    .update({
      poster_url: posterUrl,
      image_url: posterUrl,
      metadata: { ...history.metadata, test_mode: true, simulated_pipeline: true, step3_poster_saved: true }
    })
    .eq("id", history.id)
    .select("id,tenant_id,run_id,poster_url,image_url,metadata")
    .maybeSingle();
  if (error) throw new Error(`content_history poster update failed: ${error.message}`);
  assertTestHistory(data);

  const link = await client.from("content_links").insert({
    tenant_id: history.tenant_id,
    content_history_id: history.id,
    run_id: runId,
    platform: "LinkedIn",
    platform_target: "LinkedIn",
    link_type: "poster",
    label: "Test-only poster output",
    url: posterUrl,
    poster_url: posterUrl,
    publish_status: "pending",
    timezone: "Asia/Kolkata",
    country: "India"
  });
  if (link.error) throw new Error(`content_links insert failed: ${link.error.message}`);
  await assertRelatedRows(client, history.id, "content_links");
  await writeAudit(client, history.tenant_id, history.id, "cmo_workflow_step3_poster_linked", "Step 3 linked poster output to content_history.", { step: 3 });
  return data;
}

async function step4CreateApproval(client, history) {
  const { data, error } = await client
    .from("content_approvals")
    .insert({
      tenant_id: history.tenant_id,
      content_history_id: history.id,
      run_id: runId,
      approval_status: "waiting",
      status: "Waiting",
      slack_approval_id: `test-${runId}`,
      slack_message_reference: { test_mode: true, simulated_pipeline: true, run_id: runId, channel: "test-only" },
      notes: "Test-only Slack approval row.",
      timezone: "Asia/Kolkata",
      country: "India"
    })
    .select("id,run_id,content_history_id,approval_status,status")
    .maybeSingle();
  if (error) throw new Error(`content_approvals insert failed: ${error.message}`);
  if (data.run_id !== runId || data.content_history_id !== history.id) throw new Error("Step 4 approval row is not linked to the same run_id/content_history.");
  await writeAudit(client, history.tenant_id, history.id, "cmo_workflow_step4_approval_created", "Step 4 created Slack approval test row.", { step: 4, content_approval_id: data.id });
  return data;
}

async function step5VerifyBlockedQueue(client, history) {
  const row = await readHistory(client, history.id);
  if (row.approval_status === "approved" || row.publish_status === "queued") {
    throw new Error("Step 5 failed: unapproved test content reached queued state.");
  }
  await writeAudit(client, history.tenant_id, history.id, "cmo_workflow_step5_publish_blocked", "Step 5 confirmed queue remains blocked before approval.", { step: 5, approval_status: row.approval_status, publish_status: row.publish_status });
  return row;
}

async function step6ApproveQueues(client, history) {
  const approvedAt = nowIso();
  const row = await readHistory(client, history.id);
  const { data, error } = await client
    .from("content_history")
    .update({
      approval_status: "approved",
      publish_status: "queued",
      approved_at: approvedAt,
      approved_at_utc: approvedAt,
      metadata: { ...row.metadata, test_mode: true, simulated_pipeline: true, step6_approved: true, no_public_publish: true }
    })
    .eq("id", history.id)
    .select("id,tenant_id,run_id,approval_status,publish_status,metadata")
    .maybeSingle();
  if (error) throw new Error(`content_history approval update failed: ${error.message}`);
  assertTestHistory(data);
  if (data.approval_status !== "approved" || data.publish_status !== "queued") throw new Error("Step 6 did not change publish_status to queued.");

  const approvalUpdate = await client
    .from("content_approvals")
    .update({ approval_status: "approved", status: "Approved", approved_at: approvedAt, approved_at_utc: approvedAt, notes: "Test-only Step 6 approval." })
    .eq("content_history_id", history.id)
    .eq("run_id", runId);
  if (approvalUpdate.error) throw new Error(`content_approvals approval update failed: ${approvalUpdate.error.message}`);
  await writeAudit(client, history.tenant_id, history.id, "cmo_workflow_step6_approved_queued", "Step 6 approved test content and queued publish status.", { step: 6, approval_status: "approved", publish_status: "queued" });
  return data;
}

async function cleanup(client, contentHistoryId) {
  if (!contentHistoryId) return { skipped: true };
  await readHistory(client, contentHistoryId);
  for (const table of ["content_approvals", "content_links", "content_versions", "content_quality_reviews", "ai_content_memory", "content_metrics"]) {
    const { error } = await client.from(table).delete().eq("content_history_id", contentHistoryId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }
  const auditDelete = await client.from("audit_logs").delete().eq("metadata->>run_id", runId);
  if (auditDelete.error) throw new Error(`audit_logs cleanup failed: ${auditDelete.error.message}`);
  const historyDelete = await client.from("content_history").delete().eq("id", contentHistoryId);
  if (historyDelete.error) throw new Error(`content_history cleanup failed: ${historyDelete.error.message}`);

  const remainingHistory = await client.from("content_history").select("id").eq("run_id", runId);
  if (remainingHistory.error) throw new Error(`content_history cleanup verification failed: ${remainingHistory.error.message}`);
  const remainingAudit = await client.from("audit_logs").select("id").eq("metadata->>run_id", runId);
  if (remainingAudit.error) throw new Error(`audit_logs cleanup verification failed: ${remainingAudit.error.message}`);
  if ((remainingHistory.data || []).length || (remainingAudit.data || []).length) {
    throw new Error("Cleanup verification failed: test rows remain.");
  }
  return { content_history: 0, audit_logs: 0 };
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  let contentHistoryId = "";

  try {
    const tenantId = await step("resolve tenant", () => resolveTenantId(client));
    const history = await step("Step 1 creates content_history", () => step1CreateContentHistory(client, tenantId));
    contentHistoryId = history.id;
    const step2 = await step("Step 2 updates caption with same run_id", () => step2UpdateCaption(client, history));
    await step("Step 3 links poster to same content_history", () => step3LinkPoster(client, { ...history, metadata: step2.metadata }));
    await step("Step 4 creates content_approvals", () => step4CreateApproval(client, history));
    await step("Step 5 blocks queue before approval", () => step5VerifyBlockedQueue(client, history));
    await step("Step 6 approval changes publish_status to queued", () => step6ApproveQueues(client, history));
    await step("Audit logs written and test rows isolated", () => verifyNoProductionMix(client, history.id));
  } finally {
    if (contentHistoryId) await step("cleanup test rows", () => cleanup(client, contentHistoryId));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, run_id: runId, tests: results }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  if (!results.some((result) => result.ok === false)) {
    results.push({ label: "cmo workflow integration", ok: false, error: error?.message || String(error) });
  }
  console.log(JSON.stringify({ ok: false, run_id: runId, tests: results }, null, 2));
  process.exitCode = 1;
});
