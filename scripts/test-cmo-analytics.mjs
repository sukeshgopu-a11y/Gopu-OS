import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getLinkedInAnalyticsCredentialStatus, runCmoAnalyticsEngine } from "../lib/cmoAnalyticsEngine.mjs";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runId = `cmo-analytics-test-${Date.now()}`;
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
  if (urlRef && keyRef && urlRef !== keyRef) throw new Error(`Supabase env mismatch: URL ref ${urlRef} does not match service role ref ${keyRef}.`);
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

async function verifyContentMetricsSchema(client, tenantId) {
  const probeRunId = `${runId}-schema-probe`;
  const history = await client.from("content_history").insert({
    tenant_id: tenantId,
    run_id: probeRunId,
    platform: "LinkedIn",
    content_type: "Post",
    caption: "DEV TEST schema probe",
    approval_status: "approved",
    publish_status: "queued",
    metadata: { test_mode: true, simulated_pipeline: true, run_id: probeRunId, dry_run_publish_completed: true, no_public_publish: true }
  }).select("id").maybeSingle();
  if (history.error) throw new Error(`schema probe content_history insert failed: ${history.error.message}`);
  try {
    const metrics = await client.from("content_metrics").insert({
      tenant_id: tenantId,
      content_history_id: history.data.id,
      run_id: probeRunId,
      platform: "LinkedIn",
      metric_name: "engagement_rate",
      metric_value: 1,
      metric_unit: "%",
      impressions: 1,
      clicks: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement_rate: 0,
      source: "schema_probe",
      metadata: { test_mode: true, simulated_pipeline: true, schema_probe: true },
      collected_at_utc: nowIso()
    }).select("id").maybeSingle();
    if (metrics.error) throw new Error(`content_metrics schema is not ready: ${metrics.error.message}`);
    await client.from("content_metrics").delete().eq("id", metrics.data.id);
    return { ready: true };
  } finally {
    await client.from("content_history").delete().eq("id", history.data.id);
  }
}

async function createAnalyticsTestContent(client, tenantId) {
  const { data, error } = await client.from("content_history").insert({
    tenant_id: tenantId,
    run_id: runId,
    platform: "LinkedIn",
    content_type: "Post",
    campaign_name: "DEV Step 8 analytics simulation",
    topic: "Step 8 analytics learning loop",
    caption: "DEV TEST - Step 8 analytics simulation. No social API call.",
    generated_text: "DEV TEST - Step 8 analytics simulation. No social API call.",
    final_text: "DEV TEST - Step 8 analytics simulation. No social API call.",
    approval_status: "approved",
    publish_status: "queued",
    approved_at: nowIso(),
    approved_at_utc: nowIso(),
    metadata: { test_mode: true, simulated_pipeline: true, run_id: runId, current_step: 8, workflow_stage: "analytics", dry_run_publish_completed: true, no_public_publish: true }
  }).select("id,tenant_id,run_id,platform,approval_status,publish_status,metadata").maybeSingle();
  if (error) throw new Error(`content_history insert failed: ${error.message}`);
  if (data.metadata?.test_mode !== true) throw new Error("Created content row is not metadata.test_mode=true.");
  return data;
}

async function verifyAnalyticsResult(client, contentId) {
  const history = await client.from("content_history").select("id,run_id,metadata").eq("id", contentId).maybeSingle();
  if (history.error) throw new Error(`content_history read failed: ${history.error.message}`);
  if (history.data.metadata?.test_mode !== true) throw new Error("Analytics test row lost metadata.test_mode=true.");
  if (history.data.metadata?.simulated_pipeline !== true) throw new Error("Analytics test row is not metadata.simulated_pipeline=true.");
  if (history.data.metadata?.analytics_status !== "collected") throw new Error("content_history metadata.analytics_status was not collected.");
  if (history.data.metadata?.workflow_stage !== "analytics") throw new Error("content_history workflow_stage was not analytics.");
  if (Number(history.data.metadata?.current_step) !== 8) throw new Error("content_history current_step was not 8.");

  const metrics = await client.from("content_metrics").select("*").eq("content_history_id", contentId);
  if (metrics.error) throw new Error(`content_metrics read failed: ${metrics.error.message}`);
  if ((metrics.data || []).length !== 1) throw new Error(`Expected one metrics row, found ${(metrics.data || []).length}.`);
  const metric = metrics.data[0];
  if (metric.source !== "simulated_test") throw new Error(`Expected source simulated_test, got ${metric.source}.`);
  if (metric.metadata?.test_mode !== true) throw new Error("content_metrics row missing metadata.test_mode=true.");
  if (!Number.isFinite(Number(metric.engagement_rate))) throw new Error("content_metrics engagement_rate is missing.");

  const memory = await client.from("ai_content_memory").select("*").eq("content_history_id", contentId);
  if (memory.error) throw new Error(`ai_content_memory read failed: ${memory.error.message}`);
  if ((memory.data || []).length !== 1) throw new Error(`Expected one ai_content_memory row, found ${(memory.data || []).length}.`);
  if (!memory.data[0].performance_summary || !memory.data[0].ai_reasoning || !memory.data[0].campaign_impact) {
    throw new Error("ai_content_memory learning summary is incomplete.");
  }

  const audit = await client.from("audit_logs").select("id,action_type,metadata").eq("related_table", "content_history").eq("related_record_id", contentId);
  if (audit.error) throw new Error(`audit_logs read failed: ${audit.error.message}`);
  const actions = (audit.data || []).map((row) => row.action_type);
  for (const required of ["analytics_started", "analytics_test_simulated", "analytics_collected"]) {
    if (!actions.includes(required)) throw new Error(`Missing audit log ${required}.`);
  }
  if ((audit.data || []).some((row) => row.metadata?.test_mode !== true)) throw new Error("A Step 8 audit row is missing metadata.test_mode=true.");
  return { metrics: metric, memory: memory.data[0], audit_events: actions };
}

async function verifyProductionBlock(client, contentId) {
  const result = await runCmoAnalyticsEngine({ client, dryRun: false, contentHistoryId: contentId, limit: 1 });
  if (result.blocked_test_rows !== 1) throw new Error("Production analytics did not block test-mode content.");
  if (result.processed !== 0) throw new Error("Production analytics processed a test-mode row.");
  return result;
}

async function cleanup(client, contentId) {
  for (const table of ["content_metrics", "content_approvals", "content_links", "content_versions", "content_quality_reviews", "ai_content_memory"]) {
    const { error } = await client.from(table).delete().eq("content_history_id", contentId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }
  const auditDelete = await client.from("audit_logs").delete().eq("related_table", "content_history").eq("related_record_id", contentId);
  if (auditDelete.error) throw new Error(`audit_logs cleanup failed: ${auditDelete.error.message}`);
  const historyDelete = await client.from("content_history").delete().eq("id", contentId);
  if (historyDelete.error) throw new Error(`content_history cleanup failed: ${historyDelete.error.message}`);
  const remaining = await client.from("content_history").select("id").eq("run_id", runId);
  if (remaining.error) throw new Error(`cleanup verification failed: ${remaining.error.message}`);
  if ((remaining.data || []).length) throw new Error("Cleanup left Step 8 test content rows behind.");
  return { content_history: 0 };
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  const credentialStatus = getLinkedInAnalyticsCredentialStatus();
  let contentId = null;
  try {
    const tenantId = await step("resolve tenant", () => resolveTenantId(client));
    await step("verify content_metrics Step 8 schema", () => verifyContentMetricsSchema(client, tenantId));
    const content = await step("create approved Step 8 test content", () => createAnalyticsTestContent(client, tenantId));
    contentId = content.id;
    const analytics = await step("run simulated Step 8 analytics", () => runCmoAnalyticsEngine({ client, dryRun: true, contentHistoryId: contentId, limit: 1 }));
    if (!analytics.ok || analytics.processed !== 1 || analytics.results?.[0]?.status !== "collected") throw new Error("Analytics engine did not collect simulated metrics.");
    await step("verify metrics, learning, and audit logs", () => verifyAnalyticsResult(client, contentId));
    await step("verify production analytics blocks test rows", () => verifyProductionBlock(client, contentId));
    await step("cleanup test rows", () => cleanup(client, contentId));
    console.log(JSON.stringify({ ok: true, run_id: runId, linkedin_credentials_present: credentialStatus.present, tests: results }, null, 2));
  } catch (error) {
    if (contentId) {
      try {
        await cleanup(client, contentId);
      } catch (cleanupError) {
        console.error(`cleanup failed after error: ${cleanupError?.message || String(cleanupError)}`);
      }
    }
    console.error(JSON.stringify({ ok: false, run_id: runId, linkedin_credentials_present: credentialStatus.present, tests: results, error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

main();
