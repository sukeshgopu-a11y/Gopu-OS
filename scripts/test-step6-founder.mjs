import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";
const runId = `step6-founder-cli-${Date.now()}`;
const nowIso = () => new Date().toISOString();

const results = [];
let rlsBlocked = false;

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

function getProjectRefs() {
  const serverUrl = env("SUPABASE_URL");
  const resolvedUrl = supabaseUrl();
  const frontendUrl = env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  return {
    server_url_ref: projectRefFromUrl(serverUrl),
    resolved_url_ref: projectRefFromUrl(resolvedUrl),
    frontend_url_ref: projectRefFromUrl(frontendUrl),
    service_role_ref: projectRefFromJwt(serviceKey),
    using_server_url: Boolean(serverUrl),
    frontend_server_match: !frontendUrl || !resolvedUrl || projectRefFromUrl(frontendUrl) === projectRefFromUrl(resolvedUrl)
  };
}

function requireClient() {
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing SUPABASE_URL, VITE_SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. Step 6 CLI test requires server-side Supabase access.");
  const refs = getProjectRefs();
  console.log(`Active Supabase project refs: ${JSON.stringify(refs)}`);
  if (!refs.using_server_url) {
    console.warn("WARN SUPABASE_URL is missing; falling back to frontend Supabase URL for this CLI test.");
  }
  if (refs.frontend_url_ref && refs.resolved_url_ref && refs.frontend_url_ref !== refs.resolved_url_ref) {
    console.warn(`WARN frontend/server Supabase refs differ: frontend=${refs.frontend_url_ref}, server=${refs.resolved_url_ref}`);
  }
  if (refs.service_role_ref && refs.resolved_url_ref && refs.service_role_ref !== refs.resolved_url_ref) {
    throw new Error(`Supabase env mismatch: resolved URL project ref is ${refs.resolved_url_ref}, but SUPABASE_SERVICE_ROLE_KEY belongs to ${refs.service_role_ref}.`);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function safeError(error) {
  const message = error?.message || String(error || "Unknown error");
  if (/row-level security|permission denied|not authorized|JWT/i.test(message)) rlsBlocked = true;
  return message;
}

async function step(label, fn) {
  try {
    const data = await fn();
    results.push({ label, ok: true, data });
    console.log(`PASS ${label}`);
    return data;
  } catch (error) {
    const message = safeError(error);
    results.push({ label, ok: false, error: message });
    console.error(`FAIL ${label}: ${message}`);
    throw error;
  }
}

async function resolveTenantId(client) {
  const defaultResult = await client.from("tenants").select("id").eq("id", defaultTenantId).maybeSingle();
  if (defaultResult.error && defaultResult.error.code !== "PGRST116") {
    throw new Error(`Tenant lookup failed: ${defaultResult.error.message}`);
  }
  if (defaultResult.data?.id) return defaultResult.data.id;

  const firstResult = await client.from("tenants").select("id").limit(1).maybeSingle();
  if (firstResult.error) throw new Error(`Tenant fallback lookup failed: ${firstResult.error.message}`);
  if (!firstResult.data?.id) throw new Error("No tenant row exists. Cannot create Step 6 test content safely.");
  return firstResult.data.id;
}

async function assertRequiredTables(client) {
  const requiredTables = [
    "content_history",
    "content_versions",
    "content_links",
    "content_approvals",
    "content_quality_reviews",
    "ai_content_memory",
    "audit_logs"
  ];
  const missingTables = [];
  for (const table of requiredTables) {
    const restUrl = `${supabaseUrl().replace(/\/$/, "")}/rest/v1/${table}?select=id&limit=1`;
    console.log(`Checking Step 6 REST table URL: ${restUrl}`);
    const { error } = await client.from(table).select("id").limit(1);
    if (error?.code === "42P01" || /schema cache|does not exist|Could not find the table/i.test(error?.message || "")) {
      missingTables.push(table);
    } else if (error && !/permission denied|row-level security/i.test(error.message || "")) {
      throw new Error(`${table} availability check failed: ${error.message}`);
    }
  }
  if (missingTables.length > 0) {
    throw new Error(`Required Step 6 tables missing or not exposed in Supabase schema cache: ${missingTables.join(", ")}.`);
  }
  return { required_tables: requiredTables, missing_tables: [] };
}

async function writeAudit(client, tenantId, contentHistoryId, actionType, description, metadata = {}) {
  const { data, error } = await client
    .from("audit_logs")
    .insert({
      tenant_id: tenantId,
      action_type: actionType,
      action: actionType,
      module: "AI CMO Workflow",
      related_table: "content_history",
      related_record_id: contentHistoryId,
      record_type: "content_history",
      record_id: contentHistoryId,
      actor: "Step 6 CLI Test",
      actor_role: "Developer Test Runner",
      description,
      notes: description,
      risk_level: "Low",
      metadata: {
        run_id: runId,
        test_mode: true,
        no_public_publish: true,
        ...metadata
      }
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`audit_logs insert failed: ${error.message}`);
  return data?.id || null;
}

function assertTestRow(row) {
  if (!row?.id) throw new Error("Content row was not found.");
  if (row.metadata?.test_mode !== true) {
    throw new Error(`Refusing to mutate non-test content_history row ${row.id}.`);
  }
}

async function readContent(client, id) {
  const { data, error } = await client
    .from("content_history")
    .select("id,tenant_id,run_id,platform,approval_status,publish_status,approved_at,rejected_at,metadata")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`content_history read failed: ${error.message}`);
  assertTestRow(data);
  return data;
}

async function updateLatestApproval(client, row, patch) {
  const { data: approvals, error: readError } = await client
    .from("content_approvals")
    .select("id")
    .eq("content_history_id", row.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (readError) throw new Error(`content_approvals read failed: ${readError.message}`);

  const approvalId = approvals?.[0]?.id;
  const write = approvalId
    ? client.from("content_approvals").update(patch).eq("id", approvalId).select("id,approval_status,status").maybeSingle()
    : client.from("content_approvals").insert({
        tenant_id: row.tenant_id,
        content_history_id: row.id,
        run_id: row.run_id,
        ...patch
      }).select("id,approval_status,status").maybeSingle();
  const { data, error } = await write;
  if (error) throw new Error(`content_approvals write failed: ${error.message}`);
  return data;
}

async function applyDecision(client, id, decision) {
  const row = await readContent(client, id);
  const decidedAt = nowIso();
  const decisionMap = {
    approve: {
      approval_status: "approved",
      publish_status: "queued",
      approvalLabel: "Approved",
      history: { approved_at: decidedAt, approved_at_utc: decidedAt, rejected_at: null, rejected_at_utc: null },
      approval: { approved_at: decidedAt, approved_at_utc: decidedAt, rejected_at: null, rejected_at_utc: null }
    },
    needs_edit: {
      approval_status: "needs_edit",
      publish_status: "needs_edit",
      approvalLabel: "Needs Edit",
      history: { rejected_at: decidedAt, rejected_at_utc: decidedAt },
      approval: { rejected_at: decidedAt, rejected_at_utc: decidedAt }
    },
    hold: {
      approval_status: "hold",
      publish_status: "hold",
      approvalLabel: "Hold",
      history: {},
      approval: {}
    },
    waiting: {
      approval_status: "waiting",
      publish_status: "pending",
      approvalLabel: "Waiting",
      history: { approved_at: null, approved_at_utc: null, rejected_at: null, rejected_at_utc: null },
      approval: { approved_at: null, approved_at_utc: null, rejected_at: null, rejected_at_utc: null }
    }
  };
  const state = decisionMap[decision];
  if (!state) throw new Error(`Unknown decision ${decision}.`);

  const nextMetadata = {
    ...row.metadata,
    test_mode: true,
    founder_decision: decision,
    founder_decision_at: decidedAt,
    no_public_publish_from_step_6_cli: true
  };
  const { data: updated, error } = await client
    .from("content_history")
    .update({
      approval_status: state.approval_status,
      publish_status: state.publish_status,
      metadata: nextMetadata,
      ...state.history
    })
    .eq("id", row.id)
    .select("id,tenant_id,run_id,platform,approval_status,publish_status,approved_at,rejected_at,metadata")
    .maybeSingle();
  if (error) throw new Error(`content_history ${decision} update failed: ${error.message}`);
  assertTestRow(updated);

  const approval = await updateLatestApproval(client, updated, {
    approval_status: state.approval_status,
    status: state.approvalLabel,
    notes: `Step 6 CLI test decision: ${decision}`,
    timezone: "Asia/Kolkata",
    country: "India",
    ...state.approval
  });
  const auditId = await writeAudit(client, updated.tenant_id, updated.id, `CMO founder decision ${decision}`, `Step 6 CLI test applied ${decision}.`, {
    content_history_id: updated.id,
    approval_status: state.approval_status,
    publish_status: state.publish_status
  });

  if (updated.approval_status !== state.approval_status || updated.publish_status !== state.publish_status) {
    throw new Error(`Decision ${decision} verification failed.`);
  }
  return { content_history: updated, content_approval: approval, audit_id: auditId };
}

async function createTestPackage(client, tenantId) {
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const metadata = {
    test_mode: true,
    is_test: true,
    dev_only: true,
    step: 6,
    cli_test: true,
    cleanup_key: runId,
    production_publish_blocked: true
  };
  const caption = "Indian agri exporters build buyer trust when quality documentation, shipment readiness, and founder approval gates work together. This is a developer-only Step 6 test package and must never publish publicly.";
  const hashtags = ["#AgriExport", "#FounderApproval", "#GOPUOS", "#GlobalTrade"];
  const imagePrompt = "Premium dark export-tech poster showing founder approval, global trade routes, shipment readiness, and agri export documentation.";
  const posterUrl = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='675'%3E%3Crect width='1200' height='675' fill='%23071015'/%3E%3Ctext x='80' y='150' fill='%232ef2ff' font-size='42' font-family='Arial'%3EDEV STEP 6 TEST%3C/text%3E%3Ctext x='80' y='260' fill='white' font-size='64' font-family='Arial'%3EFounder Decision Review%3C/text%3E%3C/svg%3E";

  const { data: history, error: historyError } = await client
    .from("content_history")
    .insert({
      tenant_id: tenantId,
      run_id: runId,
      platform: "LinkedIn",
      platform_target: "LinkedIn",
      content_type: "Post",
      campaign_name: "DEV Step 6 founder action test",
      region_country: "India",
      topic: "Founder-led export trust systems",
      caption,
      hashtags,
      image_prompt: imagePrompt,
      poster_url: posterUrl,
      image_url: posterUrl,
      generated_text: caption,
      final_text: null,
      final_approved_content: null,
      approval_status: "waiting",
      publish_status: "pending",
      platform_targets: ["LinkedIn", "Instagram", "Facebook"],
      live_post_url: null,
      post_url: null,
      audit_references: [],
      ai_quality_review: { confidence_score: 0.91, risk_flags: [], test_mode: true },
      scheduled_at_utc: scheduledAt,
      timezone: "Asia/Kolkata",
      country: "India",
      platform_integration_connected: false,
      publish_attempt_count: 0,
      metadata
    })
    .select("id,tenant_id,run_id,platform,approval_status,publish_status,metadata")
    .maybeSingle();
  if (historyError) throw new Error(`content_history insert failed: ${historyError.message}`);
  assertTestRow(history);

  const relatedRows = [
    client.from("content_versions").insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      version_number: 1,
      version_type: "generated",
      caption,
      hashtags,
      image_prompt: imagePrompt,
      poster_url: posterUrl,
      draft_text: caption,
      approval_status: "waiting",
      audit_references: [],
      notes: "Developer-only Step 6 CLI test generated version."
    }),
    client.from("content_links").insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      platform: "LinkedIn",
      platform_target: "LinkedIn",
      link_type: "poster",
      label: "Developer-only test poster",
      url: posterUrl,
      poster_url: posterUrl,
      publish_status: "pending",
      timezone: "Asia/Kolkata",
      country: "India",
      audit_references: []
    }),
    client.from("content_approvals").insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      approval_status: "waiting",
      status: "Waiting",
      audit_references: [],
      notes: "Developer-only Step 6 CLI test approval row.",
      timezone: "Asia/Kolkata",
      country: "India"
    }),
    client.from("content_quality_reviews").insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      review_status: "passed",
      quality_score: 91,
      brand_safety_score: 96,
      compliance_score: 98,
      risk_flags: [],
      recommendations: ["Ready for founder decision testing."],
      reviewer: "Step 6 CLI Test",
      audit_references: []
    })
  ];

  for (const write of relatedRows) {
    const { error } = await write;
    if (error) throw new Error(`Related test row insert failed: ${error.message}`);
  }
  const auditId = await writeAudit(client, tenantId, history.id, "step6_cli_test_content_created", "Created developer-only Step 6 test content package.", {
    content_history_id: history.id
  });
  return { ...history, audit_id: auditId };
}

async function cleanup(client, id) {
  const row = await readContent(client, id);
  const tables = ["content_approvals", "content_links", "content_versions", "content_quality_reviews", "ai_content_memory"];
  const deleted = {};
  for (const table of tables) {
    const { error } = await client.from(table).delete().eq("content_history_id", row.id);
    if (error) throw new Error(`${table} cleanup failed: ${error.message}`);
    deleted[table] = true;
  }
  const auditDelete = await client
    .from("audit_logs")
    .delete()
    .eq("related_table", "content_history")
    .eq("related_record_id", row.id);
  if (auditDelete.error) throw new Error(`audit_logs cleanup failed: ${auditDelete.error.message}`);
  deleted.audit_logs = true;

  const historyDelete = await client.from("content_history").delete().eq("id", row.id);
  if (historyDelete.error) throw new Error(`content_history cleanup failed: ${historyDelete.error.message}`);
  deleted.content_history = true;
  return deleted;
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  await step("verify Step 6 schema", () => assertRequiredTables(client));
  const tenantId = await step("resolve tenant", () => resolveTenantId(client));
  let contentId = "";

  try {
    const created = await step("create test content package", () => createTestPackage(client, tenantId));
    contentId = created.id;
    await step("approve sets APPROVED and queued", () => applyDecision(client, contentId, "approve"));
    await step("reset to waiting", () => applyDecision(client, contentId, "waiting"));
    await step("send back for edit sets NEEDS_EDIT", () => applyDecision(client, contentId, "needs_edit"));
    await step("reset to waiting again", () => applyDecision(client, contentId, "waiting"));
    await step("hold queue sets HOLD", () => applyDecision(client, contentId, "hold"));
  } finally {
    if (contentId) {
      await step("cleanup test rows", () => cleanup(client, contentId));
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    run_id: runId,
    tests: results.map(({ label, ok, error }) => ({ label, ok, error })),
    rls_blocked: rlsBlocked,
    browser_ui_changed: false
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    run_id: runId,
    error: safeError(error),
    tests: results.map(({ label, ok, error }) => ({ label, ok, error })),
    rls_blocked: rlsBlocked,
    browser_ui_changed: false
  }, null, 2));
  process.exit(1);
});
