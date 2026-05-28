import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getLinkedInPublishingCredentialStatus, runCmoPublishingEngine } from "../lib/cmoPublishingEngine.mjs";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runId = `cmo-publishing-test-${Date.now()}`;
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

async function createApprovedQueuedContent(client, tenantId) {
  const { data, error } = await client
    .from("content_history")
    .insert({
      tenant_id: tenantId,
      run_id: runId,
      platform: "LinkedIn",
      content_type: "Post",
      campaign_name: "DEV Step 7 publishing dry-run",
      topic: "Step 7 LinkedIn publishing dry-run guard",
      caption: "DEV TEST - GOPU OS Step 7 dry-run publishing validation. This must never publish publicly.",
      generated_text: "DEV TEST - GOPU OS Step 7 dry-run publishing validation. This must never publish publicly.",
      final_text: "DEV TEST - GOPU OS Step 7 dry-run publishing validation. This must never publish publicly.",
      hashtags: ["#GOPUOS", "#DryRun"],
      approval_status: "approved",
      publish_status: "queued",
      approved_at: nowIso(),
      approved_at_utc: nowIso(),
      publish_attempt_count: 0,
      metadata: {
        test_mode: true,
        run_id: runId,
        current_step: 7,
        workflow_stage: "publishing",
        no_public_publish: true
      }
    })
    .select("id,tenant_id,run_id,platform,approval_status,publish_status,publish_attempt_count,metadata")
    .maybeSingle();
  if (error) throw new Error(`content_history insert failed: ${error.message}`);
  if (data?.metadata?.test_mode !== true) throw new Error("Created content row is not marked metadata.test_mode=true.");
  return data;
}

async function verifyDryRunResult(client, contentId) {
  const { data, error } = await client
    .from("content_history")
    .select("id,run_id,approval_status,publish_status,publish_attempt_count,last_publish_attempt_at,last_publish_error,live_post_url,post_url,metadata")
    .eq("id", contentId)
    .maybeSingle();
  if (error) throw new Error(`content_history dry-run verification failed: ${error.message}`);
  if (!data?.id) throw new Error("Dry-run content row missing.");
  if (data.metadata?.test_mode !== true) throw new Error("Dry-run content row lost metadata.test_mode=true.");
  if (data.publish_status !== "queued") throw new Error(`Dry-run must leave publish_status queued, got ${data.publish_status}.`);
  if (Number(data.publish_attempt_count || 0) !== 1) throw new Error(`Dry-run should record exactly one attempt, got ${data.publish_attempt_count}.`);
  if (data.live_post_url || data.post_url) throw new Error("Dry-run must not store a live post URL.");
  if (data.metadata?.step7_status !== "dry_run_passed") throw new Error("Dry-run did not record metadata.step7_status=dry_run_passed.");

  const audit = await client
    .from("audit_logs")
    .select("id,action_type,metadata")
    .eq("related_table", "content_history")
    .eq("related_record_id", contentId);
  if (audit.error) throw new Error(`audit_logs read failed: ${audit.error.message}`);
  const actionTypes = (audit.data || []).map((row) => row.action_type);
  if (!actionTypes.includes("cmo_publish_dry_run_started")) throw new Error("Missing cmo_publish_dry_run_started audit log.");
  if (!actionTypes.includes("cmo_publish_dry_run_succeeded")) throw new Error("Missing cmo_publish_dry_run_succeeded audit log.");
  if ((audit.data || []).some((row) => row.metadata?.test_mode !== true)) throw new Error("A Step 7 test audit row is missing metadata.test_mode=true.");
  return { row: data, audit_events: actionTypes };
}

async function verifyProductionBlock(client, contentId) {
  const result = await runCmoPublishingEngine({ client, dryRun: false, contentHistoryId: contentId, limit: 1 });
  if (result.blocked_test_rows !== 1) throw new Error("Production run did not block test-mode content.");
  if (result.processed !== 0) throw new Error("Production run processed a test-mode row.");
  const { data, error } = await client.from("content_history").select("id,publish_status,live_post_url,post_url,metadata").eq("id", contentId).maybeSingle();
  if (error) throw new Error(`production block row read failed: ${error.message}`);
  if (data.publish_status !== "queued") throw new Error("Production block changed publish_status unexpectedly.");
  if (data.live_post_url || data.post_url) throw new Error("Production block wrote a post URL unexpectedly.");
  if (data.metadata?.test_mode !== true) throw new Error("Production block row lost metadata.test_mode=true.");
  return result;
}

async function cleanup(client, contentId) {
  for (const table of ["content_approvals", "content_links", "content_versions", "content_quality_reviews", "ai_content_memory", "content_metrics"]) {
    const { error } = await client.from(table).delete().eq("content_history_id", contentId);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
  }
  const auditDelete = await client
    .from("audit_logs")
    .delete()
    .eq("related_table", "content_history")
    .eq("related_record_id", contentId);
  if (auditDelete.error) throw new Error(`audit_logs cleanup failed: ${auditDelete.error.message}`);
  const historyDelete = await client.from("content_history").delete().eq("id", contentId);
  if (historyDelete.error) throw new Error(`content_history cleanup failed: ${historyDelete.error.message}`);
  const remaining = await client.from("content_history").select("id").eq("run_id", runId);
  if (remaining.error) throw new Error(`cleanup verification failed: ${remaining.error.message}`);
  if ((remaining.data || []).length) throw new Error("Cleanup left Step 7 test content rows behind.");
  return { content_history: 0 };
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  let contentId = null;
  const credentialStatus = getLinkedInPublishingCredentialStatus();
  try {
    const tenantId = await step("resolve tenant", () => resolveTenantId(client));
    const content = await step("create approved queued test content", () => createApprovedQueuedContent(client, tenantId));
    contentId = content.id;
    const dryRun = await step("run dry-run LinkedIn publishing", () => runCmoPublishingEngine({ client, dryRun: true, contentHistoryId: contentId, limit: 1 }));
    if (!dryRun.ok || dryRun.processed !== 1 || dryRun.results?.[0]?.status !== "dry_run_passed") {
      throw new Error("Dry-run publishing engine did not return dry_run_passed.");
    }
    await step("verify dry-run row and audit logs", () => verifyDryRunResult(client, contentId));
    await step("verify production publish blocks test rows", () => verifyProductionBlock(client, contentId));
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
