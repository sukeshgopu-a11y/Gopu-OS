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

function getSupabaseClient() {
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
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

function latestMetric(row = {}) {
  const metrics = Array.isArray(row.content_metrics) ? row.content_metrics : [];
  return [...metrics].sort((a, b) => Date.parse(b.collected_at_utc || b.created_at || 0) - Date.parse(a.collected_at_utc || a.created_at || 0))[0] || null;
}

function latestMemory(row = {}) {
  const memories = Array.isArray(row.ai_content_memory) ? row.ai_content_memory : [];
  return [...memories].sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0] || null;
}

function buildOptimization(row = {}) {
  const metric = latestMetric(row) || {};
  const memory = latestMemory(row) || {};
  const engagementRate = Number(metric.engagement_rate || row.metadata?.latest_engagement_rate || 0);
  const strong = engagementRate >= 8;
  const platform = row.platform || "LinkedIn";
  const baseHashtags = platform === "LinkedIn"
    ? ["#AgriExports", "#ImporterTrust", "#GlobalTrade", "#GOPUExports"]
    : ["#GOPUExports", "#ExportBusiness", "#AgriTrade"];

  return {
    performance_summary: `${platform} optimization used ${metric.impressions || 0} impressions, ${metric.clicks || 0} clicks, and ${engagementRate}% engagement rate.`,
    campaign_impact: strong
      ? "High-confidence content angle. Reuse founder-led authority framing and scale similar importer trust posts."
      : "Moderate performance. Tighten the first line, reduce generic wording, and use stronger importer problem framing.",
    ai_reasoning: `${memory.ai_reasoning || "Analytics learning"} Step 9 recommends adapting hook style, hashtags, and timing from the latest Step 8 metric row.`,
    recommended_next_caption_style: strong
      ? "Founder-led authority post with a direct importer trust proof point in the first two lines."
      : "Sharper problem-solution caption with a specific export operations pain point and one clear buyer action.",
    recommended_hashtags: strong ? baseHashtags : [...baseHashtags.slice(0, 2), "#ExportDocumentation", "#B2BTrade"],
    recommended_posting_time: row.timezone === "Asia/Kolkata" || !row.timezone ? "08:00 AM IST" : "Next configured local morning slot",
    audience_learning: strong
      ? "Audience is responding to operational proof and export authority positioning."
      : "Audience needs clearer value, stronger proof, and less generic educational framing.",
    platform_learning: `${platform} should prioritize concise authority posts backed by shipment, documentation, or compliance proof.`
  };
}

async function writeAudit(client, row, eventType, description, extra = {}) {
  const { data, error } = await client
    .from("audit_logs")
    .insert({
      tenant_id: row.tenant_id,
      action_type: eventType,
      action: eventType,
      module: "CMO Optimization",
      related_table: "content_history",
      related_record_id: row.id,
      record_type: "content_history",
      record_id: row.id,
      actor: "CMO Optimization Engine",
      actor_role: "System",
      description,
      notes: description,
      risk_level: extra.risk_level || "Low",
      metadata: {
        run_id: row.run_id,
        platform: row.platform,
        test_mode: isTestMode(row),
        no_external_ai_call: true,
        no_social_api_call: true,
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

async function insertOptimizationMemory(client, row, optimization) {
  const { data, error } = await client
    .from("ai_content_memory")
    .insert({
      tenant_id: row.tenant_id,
      content_history_id: row.id,
      platform: row.platform,
      prompt: row.topic || row.campaign_name || "Step 9 optimization learning",
      generated_version: row.caption || row.generated_text || "",
      approved_version: row.final_text || row.final_approved_content || row.caption || "",
      performance_summary: optimization.performance_summary,
      campaign_impact: optimization.campaign_impact,
      ai_reasoning: optimization.ai_reasoning,
      quality_review: {
        optimization_status: "completed",
        test_mode: isTestMode(row),
        engagement_rate: latestMetric(row)?.engagement_rate ?? row.metadata?.latest_engagement_rate ?? null
      },
      recommended_next_caption_style: optimization.recommended_next_caption_style,
      recommended_hashtags: optimization.recommended_hashtags,
      recommended_posting_time: optimization.recommended_posting_time,
      audience_learning: optimization.audience_learning,
      platform_learning: optimization.platform_learning
    })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`ai_content_memory optimization insert failed: ${error.message}`);
  return data;
}

async function optimizeOne(client, row, { dryRun = false } = {}) {
  await writeAudit(client, row, "optimization_started", "Step 9 optimization started.", { metadata: { dry_run: dryRun } });

  if (isTestMode(row) && !dryRun) {
    await writeAudit(client, row, "optimization_failed", "Test-mode optimization blocked outside dry-run.", { risk_level: "High" });
    return { ok: false, status: "blocked_test_mode", message: "Test-mode optimization requires dry-run.", content_history: row };
  }

  if (String(row.metadata?.analytics_status || "").toLowerCase() !== "collected") {
    const failed = await updateHistory(client, row, {
      metadata: {
        ...metadata(row),
        optimization_status: "failed",
        optimization_error: "Analytics must be collected before optimization."
      }
    });
    await writeAudit(client, failed, "blocked_missing_analytics", "Optimization blocked because analytics has not been collected.", { risk_level: "Medium" });
    await writeAudit(client, failed, "optimization_failed", "Analytics must be collected before optimization.", { risk_level: "Medium" });
    return { ok: false, status: "failed", message: "Analytics must be collected before optimization.", content_history: failed };
  }

  const metric = latestMetric(row);
  if (!metric) {
    const failed = await updateHistory(client, row, {
      metadata: {
        ...metadata(row),
        current_step: 9,
        workflow_stage: "optimization",
        optimization_status: "failed",
        optimization_error: "No content_metrics row found for optimization."
      }
    });
    await writeAudit(client, failed, "optimization_failed", "No content_metrics row found for optimization.", { risk_level: "Medium" });
    return { ok: false, status: "failed", message: "No content_metrics row found for optimization.", content_history: failed };
  }

  const optimization = buildOptimization(row);
  const memory = await insertOptimizationMemory(client, row, optimization);
  const completedAt = nowIso();
  const updated = await updateHistory(client, row, {
    metadata: {
      ...metadata(row),
      current_step: 9,
      workflow_stage: "optimization",
      optimization_status: "completed",
      optimization_completed_at_utc: completedAt,
      simulated_pipeline: isTestMode(row) ? true : metadata(row).simulated_pipeline === true,
      learned_insight: optimization.campaign_impact,
      recommended_next_caption_style: optimization.recommended_next_caption_style,
      recommended_hashtags: optimization.recommended_hashtags,
      recommended_posting_time: optimization.recommended_posting_time,
      audience_learning: optimization.audience_learning,
      platform_learning: optimization.platform_learning,
      no_external_ai_call: true,
      no_social_api_call: true
    }
  });

  if (isTestMode(row)) {
    await writeAudit(client, updated, "optimization_test_generated", "Step 9 test optimization generated safe recommendations without external AI/social calls.", { metadata: { ai_content_memory_id: memory.id, optimization } });
  }
  await writeAudit(client, updated, "optimization_completed", "Step 9 optimization completed and AI learning was stored.", { metadata: { ai_content_memory_id: memory.id, optimization } });

  return { ok: true, status: "completed", optimization, ai_content_memory: memory, content_history: updated };
}

export async function runCmoOptimizationEngine(options = {}) {
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
      : query.eq("approval_status", "approved");
  }

  const { data, error } = await query;
  if (error) throw new Error(`Optimization content lookup failed: ${error.message}`);

  const rows = (data || []).filter((row) => dryRun ? isTestMode(row) : !isTestMode(row));
  const blockedTestRows = (data || []).filter((row) => isTestMode(row) && !dryRun).length;
  const results = [];
  for (const row of rows) {
    results.push(await optimizeOne(client, row, { dryRun }));
  }

  return {
    ok: results.every((result) => result.ok),
    dry_run: dryRun,
    selected: (data || []).length,
    processed: results.length,
    blocked_test_rows: blockedTestRows,
    results
  };
}
