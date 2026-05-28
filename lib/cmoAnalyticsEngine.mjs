import { createClient } from "@supabase/supabase-js";

function env(name) {
  return process.env[name]?.trim() || "";
}

function nowIso() {
  return new Date().toISOString();
}

function supabaseUrl() {
  return env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
}

function supabaseServiceRoleKey() {
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

function getSupabaseClient() {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function metadata(row = {}) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
}

function isTestMode(row = {}) {
  return row?.metadata?.test_mode === true || row?.metadata?.test_mode === "true";
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Unknown analytics error");
}

function linkedinAnalyticsConfig() {
  const token = env("LINKEDIN_ACCESS_TOKEN");
  const organizationId = env("LINKEDIN_ORGANIZATION_ID");
  return {
    configured: Boolean(token && organizationId),
    missing: [token ? "" : "LINKEDIN_ACCESS_TOKEN", organizationId ? "" : "LINKEDIN_ORGANIZATION_ID"].filter(Boolean),
    token,
    organizationId
  };
}

function buildSimulatedMetrics(row = {}) {
  const seed = String(row.run_id || row.id || "").split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  const impressions = 900 + (seed % 420);
  const clicks = 22 + (seed % 18);
  const likes = 45 + (seed % 35);
  const comments = 4 + (seed % 8);
  const shares = 6 + (seed % 10);
  const engagementRate = Number((((clicks + likes + comments + shares) / impressions) * 100).toFixed(2));
  return { impressions, clicks, likes, comments, shares, engagement_rate: engagementRate };
}

function buildLearningSummary(metrics = {}, row = {}) {
  const interactions = Number(metrics.clicks || 0) + Number(metrics.likes || 0) + Number(metrics.comments || 0) + Number(metrics.shares || 0);
  return {
    performance_summary: `${row.platform || "Content"} recorded ${metrics.impressions || 0} impressions and ${interactions} total engagement actions.`,
    ai_reasoning: `Engagement rate ${metrics.engagement_rate || 0}% indicates this content should inform future hook, CTA, and hashtag selection.`,
    quality_review: {
      engagement_rate: metrics.engagement_rate || 0,
      impressions: metrics.impressions || 0,
      interactions,
      test_mode: isTestMode(row)
    },
    campaign_impact: metrics.engagement_rate >= 8
      ? "Strong early signal. Reuse the angle in future importer authority content."
      : "Moderate signal. Improve hook strength and platform-specific CTA before scaling."
  };
}

async function writeAudit(client, row, eventType, description, extra = {}) {
  const { data, error } = await client
    .from("audit_logs")
    .insert({
      tenant_id: row.tenant_id,
      action_type: eventType,
      action: eventType,
      module: "CMO Analytics",
      related_table: "content_history",
      related_record_id: row.id,
      record_type: "content_history",
      record_id: row.id,
      actor: "CMO Analytics Engine",
      actor_role: "System",
      description,
      notes: description,
      risk_level: extra.risk_level || "Low",
      metadata: {
        run_id: row.run_id,
        platform: row.platform,
        test_mode: isTestMode(row),
        ...extra.metadata
      }
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id || null };
}

async function updateHistory(client, row, patch) {
  const { data, error } = await client
    .from("content_history")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", row.id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`content_history update failed: ${error.message}`);
  if (!data?.id) throw new Error("content_history update returned no row.");
  return data;
}

async function insertMetrics(client, row, metrics, source) {
  const collectedAt = nowIso();
  const payload = {
    tenant_id: row.tenant_id,
    content_history_id: row.id,
    run_id: row.run_id,
    platform: row.platform,
    metric_name: "engagement_rate",
    metric_value: metrics.engagement_rate,
    metric_unit: "%",
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    engagement_rate: metrics.engagement_rate,
    source,
    metadata: {
      test_mode: isTestMode(row),
      run_id: row.run_id,
      no_social_api_call: source === "simulated_test"
    },
    captured_at: collectedAt,
    collected_at_utc: collectedAt
  };

  const { data, error } = await client.from("content_metrics").insert(payload).select("*").maybeSingle();
  if (error) throw new Error(`content_metrics insert failed: ${error.message}`);
  return data;
}

async function insertLearning(client, row, metrics) {
  const learning = buildLearningSummary(metrics, row);
  const { data, error } = await client
    .from("ai_content_memory")
    .insert({
      tenant_id: row.tenant_id,
      content_history_id: row.id,
      platform: row.platform,
      prompt: row.topic || row.campaign_name || "Step 8 analytics learning",
      generated_version: row.caption || row.generated_text || "",
      approved_version: row.final_text || row.final_approved_content || row.caption || "",
      performance_summary: learning.performance_summary,
      ai_reasoning: learning.ai_reasoning,
      campaign_impact: learning.campaign_impact,
      quality_review: learning.quality_review
    })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`ai_content_memory insert failed: ${error.message}`);
  return data;
}

async function fetchLinkedInMetrics(row) {
  const config = linkedinAnalyticsConfig();
  if (!config.configured) {
    return { ok: false, status: "missing_credentials", error: `Missing LinkedIn analytics credentials: ${config.missing.join(", ")}.` };
  }
  return { ok: false, status: "not_implemented", error: "LinkedIn analytics fetch path is prepared but not enabled for this deployment." };
}

async function collectOne(client, row, { dryRun = false } = {}) {
  await writeAudit(client, row, "analytics_started", "Step 8 analytics collection started.", { metadata: { dry_run: dryRun } });
  const rowMetadata = metadata(row);
  const publishStatus = String(row.publish_status || "").toLowerCase();
  const dryRunPublishCompleted = rowMetadata.dry_run_publish_completed === true;

  if (publishStatus !== "published" && !dryRunPublishCompleted) {
    await writeAudit(client, row, "blocked_missing_publish", "Analytics blocked because publishing has not completed.", { risk_level: "Medium", metadata: { publish_status: row.publish_status, dry_run_publish_completed: dryRunPublishCompleted } });
    return { ok: false, status: "blocked_missing_publish", message: "Step 8 requires publish_status=published or metadata.dry_run_publish_completed=true.", content_history: row };
  }

  if (isTestMode(row)) {
    if (!dryRun) {
      await writeAudit(client, row, "analytics_failed", "Test-mode analytics blocked outside dry-run.", { risk_level: "High", metadata: { no_social_api_call: true } });
      return { ok: false, status: "blocked_test_mode", message: "Test-mode analytics requires dry-run simulation.", content_history: row };
    }
    const metrics = buildSimulatedMetrics(row);
    const metricsRow = await insertMetrics(client, row, metrics, "simulated_test");
    const learning = await insertLearning(client, row, metrics);
    const collectedAt = metricsRow.collected_at_utc || nowIso();
    const updated = await updateHistory(client, row, {
      metadata: {
        ...metadata(row),
        current_step: 8,
        workflow_stage: "analytics",
        analytics_status: "collected",
        latest_engagement_rate: metrics.engagement_rate,
        metrics_collected_at_utc: collectedAt,
        step8_source: "simulated_test",
        simulated_pipeline: true,
        no_social_api_call: true
      }
    });
    await writeAudit(client, updated, "analytics_test_simulated", "Step 8 test analytics simulated safely without calling social APIs.", { metadata: { metrics_id: metricsRow.id, ai_content_memory_id: learning.id, metrics } });
    await writeAudit(client, updated, "analytics_collected", "Step 8 analytics metrics collected and AI learning stored.", { metadata: { metrics_id: metricsRow.id, ai_content_memory_id: learning.id, metrics } });
    return { ok: true, status: "collected", source: "simulated_test", metrics, content_metrics: metricsRow, ai_content_memory: learning, content_history: updated };
  }

  const providerResult = await fetchLinkedInMetrics(row);
  if (!providerResult.ok) {
    const failed = await updateHistory(client, row, {
      metadata: {
        ...metadata(row),
        current_step: 8,
        workflow_stage: "analytics",
        analytics_status: "failed",
        analytics_error: providerResult.error
      }
    });
    await writeAudit(client, failed, "analytics_failed", providerResult.error, { risk_level: "High", metadata: { provider_status: providerResult.status } });
    return { ok: false, status: "failed", message: providerResult.error, content_history: failed };
  }

  return { ok: false, status: "not_implemented", message: "LinkedIn analytics path is prepared but not enabled.", content_history: row };
}

export async function runCmoAnalyticsEngine(options = {}) {
  const dryRun = options.dryRun === true;
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 10));
  const client = options.client || getSupabaseClient();
  let query = client
    .from("content_history")
    .select("*,content_metrics(*),ai_content_memory(*)")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (options.contentHistoryId) query = query.eq("id", options.contentHistoryId);
  if (options.runId) query = query.eq("run_id", options.runId);
  if (!options.contentHistoryId && !options.runId) {
    query = dryRun
      ? query.eq("approval_status", "approved")
      : query.eq("approval_status", "approved").eq("publish_status", "published");
  }

  const { data, error } = await query;
  if (error) throw new Error(`Analytics content lookup failed: ${error.message}`);

  const rows = (data || []).filter((row) => dryRun ? isTestMode(row) : !isTestMode(row));
  const blockedTestRows = (data || []).filter((row) => isTestMode(row) && !dryRun).length;
  const results = [];
  for (const row of rows) {
    results.push(await collectOne(client, row, { dryRun }));
  }

  return {
    ok: results.every((result) => result.ok),
    dry_run: dryRun,
    selected: (data || []).length,
    processed: results.length,
    blocked_test_rows: blockedTestRows,
    linkedin_credentials_present: linkedinAnalyticsConfig().configured,
    results
  };
}

export function getLinkedInAnalyticsCredentialStatus() {
  const config = linkedinAnalyticsConfig();
  return { present: config.configured, missing: config.missing };
}
