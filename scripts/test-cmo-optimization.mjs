import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runCmoOptimizationEngine } from "../lib/cmoOptimizationEngine.mjs";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runId = `cmo-optimization-test-${Date.now()}`;
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

async function verifyOptimizationSchema(client, tenantId) {
  const probeRunId = `${runId}-schema-probe`;
  const history = await client.from("content_history").insert({
    tenant_id: tenantId,
    run_id: probeRunId,
    platform: "LinkedIn",
    content_type: "Post",
    caption: "DEV TEST optimization schema probe",
    approval_status: "approved",
    publish_status: "queued",
    metadata: { test_mode: true, run_id: probeRunId, no_public_publish: true }
  }).select("id").maybeSingle();
  if (history.error) throw new Error(`schema probe content_history insert failed: ${history.error.message}`);
  try {
    const memory = await client.from("ai_content_memory").insert({
      tenant_id: tenantId,
      content_history_id: history.data.id,
      platform: "LinkedIn",
      performance_summary: "schema probe",
      campaign_impact: "schema probe",
      ai_reasoning: "schema probe",
      recommended_next_caption_style: "schema probe",
      recommended_hashtags: ["#SchemaProbe"],
      recommended_posting_time: "08:00 AM IST",
      audience_learning: "schema probe",
      platform_learning: "schema probe",
      quality_review: { test_mode: true, schema_probe: true }
    }).select("id").maybeSingle();
    if (memory.error) throw new Error(`ai_content_memory Step 9 schema is not ready: ${memory.error.message}`);
    await client.from("ai_content_memory").delete().eq("id", memory.data.id);
    return { ready: true };
  } finally {
    await client.from("content_history").delete().eq("id", history.data.id);
  }
}

async function createOptimizableContent(client, tenantId) {
  const history = await client.from("content_history").insert({
    tenant_id: tenantId,
    run_id: runId,
    platform: "LinkedIn",
    content_type: "Post",
    campaign_name: "DEV Step 9 optimization simulation",
    topic: "Step 9 optimization learning loop",
    caption: "DEV TEST - Step 9 optimization simulation. No external AI or social API call.",
    generated_text: "DEV TEST - Step 9 optimization simulation. No external AI or social API call.",
    final_text: "DEV TEST - Step 9 optimization simulation. No external AI or social API call.",
    approval_status: "approved",
    publish_status: "queued",
    approved_at: nowIso(),
    approved_at_utc: nowIso(),
    metadata: {
      test_mode: true,
      run_id: runId,
      current_step: 8,
      workflow_stage: "analytics",
      analytics_status: "collected",
      latest_engagement_rate: 8.75,
      metrics_collected_at_utc: nowIso(),
      no_public_publish: true
    }
  }).select("id,tenant_id,run_id,platform,metadata").maybeSingle();
  if (history.error) throw new Error(`content_history insert failed: ${history.error.message}`);

  const metrics = await client.from("content_metrics").insert({
    tenant_id: tenantId,
    content_history_id: history.data.id,
    run_id: runId,
    platform: "LinkedIn",
    metric_name: "engagement_rate",
    metric_value: 8.75,
    metric_unit: "%",
    impressions: 1200,
    clicks: 38,
    likes: 52,
    comments: 7,
    shares: 8,
    engagement_rate: 8.75,
    source: "simulated_test",
    metadata: { test_mode: true, run_id: runId, no_social_api_call: true },
    collected_at_utc: nowIso()
  }).select("id").maybeSingle();
  if (metrics.error) throw new Error(`content_metrics insert failed: ${metrics.error.message}`);

  const memory = await client.from("ai_content_memory").insert({
    tenant_id: tenantId,
    content_history_id: history.data.id,
    platform: "LinkedIn",
    performance_summary: "Step 8 simulated performance summary.",
    campaign_impact: "Step 8 campaign impact.",
    ai_reasoning: "Step 8 learning should feed Step 9 optimization.",
    quality_review: { test_mode: true, run_id: runId }
  }).select("id").maybeSingle();
  if (memory.error) throw new Error(`ai_content_memory seed insert failed: ${memory.error.message}`);

  return history.data;
}

async function verifyOptimizationResult(client, contentId) {
  const history = await client.from("content_history").select("id,run_id,metadata").eq("id", contentId).maybeSingle();
  if (history.error) throw new Error(`content_history read failed: ${history.error.message}`);
  const meta = history.data.metadata || {};
  if (meta.test_mode !== true) throw new Error("Optimization test row lost metadata.test_mode=true.");
  if (Number(meta.current_step) !== 9) throw new Error("content_history current_step was not 9.");
  if (meta.workflow_stage !== "optimization") throw new Error("content_history workflow_stage was not optimization.");
  if (meta.optimization_status !== "completed") throw new Error("content_history optimization_status was not completed.");
  if (!meta.optimization_completed_at_utc) throw new Error("optimization_completed_at_utc missing.");

  const memory = await client.from("ai_content_memory").select("*").eq("content_history_id", contentId);
  if (memory.error) throw new Error(`ai_content_memory read failed: ${memory.error.message}`);
  const optimized = (memory.data || []).find((row) => row.recommended_next_caption_style && row.recommended_posting_time);
  if (!optimized) throw new Error("No optimization ai_content_memory row found.");
  for (const key of ["performance_summary", "campaign_impact", "ai_reasoning", "recommended_next_caption_style", "recommended_posting_time", "audience_learning", "platform_learning"]) {
    if (!optimized[key]) throw new Error(`Optimization memory missing ${key}.`);
  }
  if (!Array.isArray(optimized.recommended_hashtags) || !optimized.recommended_hashtags.length) throw new Error("Optimization memory missing recommended_hashtags.");

  const audit = await client.from("audit_logs").select("id,action_type,metadata").eq("related_table", "content_history").eq("related_record_id", contentId);
  if (audit.error) throw new Error(`audit_logs read failed: ${audit.error.message}`);
  const actions = (audit.data || []).map((row) => row.action_type);
  for (const required of ["optimization_started", "optimization_test_generated", "optimization_completed"]) {
    if (!actions.includes(required)) throw new Error(`Missing audit log ${required}.`);
  }
  if ((audit.data || []).some((row) => row.metadata?.test_mode !== true)) throw new Error("A Step 9 audit row is missing metadata.test_mode=true.");
  return { memory: optimized, audit_events: actions };
}

async function verifyProductionBlock(client, contentId) {
  const result = await runCmoOptimizationEngine({ client, dryRun: false, contentHistoryId: contentId, limit: 1 });
  if (result.blocked_test_rows !== 1) throw new Error("Production optimization did not block test-mode content.");
  if (result.processed !== 0) throw new Error("Production optimization processed a test-mode row.");
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
  if ((remaining.data || []).length) throw new Error("Cleanup left Step 9 test content rows behind.");
  return { content_history: 0 };
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  let contentId = null;
  try {
    const tenantId = await step("resolve tenant", () => resolveTenantId(client));
    await step("verify ai_content_memory Step 9 schema", () => verifyOptimizationSchema(client, tenantId));
    const content = await step("create Step 9 test content with metrics", () => createOptimizableContent(client, tenantId));
    contentId = content.id;
    const optimization = await step("run Step 9 optimization", () => runCmoOptimizationEngine({ client, dryRun: true, contentHistoryId: contentId, limit: 1 }));
    if (!optimization.ok || optimization.processed !== 1 || optimization.results?.[0]?.status !== "completed") throw new Error("Optimization engine did not complete.");
    await step("verify optimization memory and audit logs", () => verifyOptimizationResult(client, contentId));
    await step("verify production optimization blocks test rows", () => verifyProductionBlock(client, contentId));
    await step("cleanup test rows", () => cleanup(client, contentId));
    console.log(JSON.stringify({ ok: true, run_id: runId, tests: results }, null, 2));
  } catch (error) {
    if (contentId) {
      try {
        await cleanup(client, contentId);
      } catch (cleanupError) {
        console.error(`cleanup failed after error: ${cleanupError?.message || String(cleanupError)}`);
      }
    }
    console.error(JSON.stringify({ ok: false, run_id: runId, tests: results, error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

main();
