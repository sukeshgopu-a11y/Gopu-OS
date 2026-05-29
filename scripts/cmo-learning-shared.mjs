import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const defaultTenantId = "11111111-1111-1111-1111-111111111111";

export const growthPlan = {
  follower_goal: "100,000 followers in 1 month",
  goal_note: "Aggressive target only. Do not report progress without connected platform analytics.",
  strategy: [
    "High-quality daily posting after founder approval.",
    "Founder authority posts about export operations, buyer trust, and trade lessons.",
    "Export education posts that explain documentation, shipment readiness, and product quality.",
    "Trust-building posts using real warehouse, product, and process visuals.",
    "Buyer-focused content that answers importer objections and procurement doubts.",
    "Engagement replies that add useful export knowledge without spam behavior.",
    "Consistent brand voice across LinkedIn, Instagram, Facebook, and buyer-facing channels.",
    "Approval-before-posting for every public draft."
  ],
  warning_rules: [
    "No fake engagement.",
    "No bot followers.",
    "No spam hashtags.",
    "No copied competitor captions.",
    "No misleading claims.",
    "No auto-posting without founder approval."
  ]
};

export function loadLocalEnv() {
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

export function requireSupabaseClient() {
  loadLocalEnv();
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("VITE_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing Supabase service role or anon key.");
  const urlRef = projectRefFromUrl(url);
  const keyRef = projectRefFromJwt(key);
  if (urlRef && keyRef && urlRef !== keyRef) throw new Error(`Supabase env mismatch: URL ref ${urlRef} does not match key ref ${keyRef}.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function safeText(value, fallback = "Not recorded") {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function normalizeFinding(row = {}) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const keyInsights = Array.isArray(row.key_insights) ? row.key_insights : [];
  return {
    id: row.id,
    run_id: row.run_id,
    topic: row.topic || metadata.topic || "CMO research finding",
    source_url: row.source_url || "",
    platform: metadata.platform || metadata.source_platform || row.source_type || "Not tagged",
    company_name: metadata.company_name || metadata.company || metadata.brand_name || row.source_domain || "Not recorded",
    caption_style: safeText(metadata.caption_style || metadata.writing_style || metadata.copy_style),
    hashtags_used: safeArray(metadata.hashtags_used || metadata.hashtags || metadata.tags),
    visual_style: safeText(metadata.visual_style || metadata.creative_style || metadata.media_style),
    engagement_signals: safeText(metadata.engagement_signals || metadata.engagement || metadata.performance_signals || keyInsights),
    why_performed_well: safeText(metadata.why_performed_well || metadata.performance_reason || metadata.why_it_worked),
    gopu_learning: safeText(metadata.gopu_learning || metadata.what_gopu_can_learn || row.learning_summary),
    avoid: safeText(metadata.what_to_avoid || metadata.avoid || metadata.risks, "No avoid rule recorded"),
    confidence_score: Number(row.confidence_score || 0),
    recorded_at: row.created_at || "",
    status: row.status || "stored"
  };
}

export async function loadCmoLearningData() {
  const client = requireSupabaseClient();
  const [runsResult, findingsResult, historyResult, approvalsResult] = await Promise.all([
    client.from("research_ingestion_runs").select("*").order("created_at", { ascending: false }).limit(50),
    client.from("research_findings").select("*").eq("role", "CMO").order("created_at", { ascending: false }).limit(100),
    client.from("content_history").select("id,tenant_id,metadata,approval_status,publish_status,created_at").eq("tenant_id", defaultTenantId).order("created_at", { ascending: false }).limit(500),
    client.from("content_approvals").select("id,approval_status,created_at,content_history_id").order("created_at", { ascending: false }).limit(500)
  ]);
  const error = [runsResult.error, findingsResult.error, historyResult.error, approvalsResult.error].find(Boolean);
  if (error) {
    return {
      connected: false,
      schema_missing: /schema cache|Could not find the table|does not exist/i.test(error.message || ""),
      error: error.message || String(error),
      status_cards: {
        research_runs_completed: 0,
        sources_scanned: 0,
        findings_saved: 0,
        draft_posts_generated: 0,
        approval_queue_count: 0,
        blocked_failed_sources: 0,
        next_run_time: "Not scheduled"
      },
      findings: [],
      growth_plan: growthPlan
    };
  }

  const runs = runsResult.data || [];
  const rawFindings = findingsResult.data || [];
  const historyRows = historyResult.data || [];
  const approvals = approvalsResult.data || [];
  const cmoRuns = runs.filter((run) => !run.current_role || run.current_role === "CMO");
  const findings = rawFindings.map(normalizeFinding);
  const completedRuns = cmoRuns.filter((run) => run.status === "completed").length;
  const sourcesScanned = cmoRuns.reduce((sum, run) => sum + (Number(run.total_sources_scanned) || 0), 0);
  const failedSources = cmoRuns.reduce((sum, run) => sum + (Number(run.total_errors) || 0), 0) + rawFindings.filter((row) => ["blocked", "failed", "error"].includes(String(row.status || "").toLowerCase())).length;
  const draftPosts = historyRows.filter((row) => String(row.publish_status || "").toLowerCase() !== "published").length;
  const approvalQueueCount = approvals.filter((row) => ["waiting", "pending", "pending_approval"].includes(String(row.approval_status || "").toLowerCase())).length;

  return {
    connected: true,
    schema_missing: false,
    error: "",
    status_cards: {
      research_runs_completed: completedRuns,
      sources_scanned: sourcesScanned,
      findings_saved: findings.length,
      draft_posts_generated: draftPosts,
      approval_queue_count: approvalQueueCount,
      blocked_failed_sources: failedSources,
      next_run_time: "Not scheduled"
    },
    findings,
    growth_plan: growthPlan
  };
}
