import {
  LEARNING_CENTRE_MIGRATION_FILE,
  getLearningCentreSetupStatus,
  getSupabaseServiceClient,
  loadLocalEnv
} from "./learningCentreDb.mjs";
import { getLearningCentreStatus, runSafeResearchTest, startResearchIngestionRun, stopResearchIngestionRun } from "./learningCentreCore.mjs";

loadLocalEnv();

async function safeLearningCentreError(error) {
  const message = error?.message || String(error || "Learning Centre request failed.");
  if (message.includes("research_ingestion_runs") || message.includes("research_findings") || message.includes("schema cache")) {
    const setup = await getLearningCentreSetupStatus().catch(() => ({
      migration_applied: false,
      missing_tables: ["research_ingestion_runs", "research_findings", "executive_knowledge", "executive_topics"],
      redis_configured: false,
      worker_ready: false,
      migration: LEARNING_CENTRE_MIGRATION_FILE
    }));
    return {
      statusCode: 424,
      body: {
        ok: false,
        status: "database_setup_required",
        message: "Learning Centre tables missing. Apply Supabase SQL migration.",
        ...setup
      }
    };
  }
  return {
    statusCode: error?.statusCode || 500,
    body: { ok: false, message }
  };
}

export async function handleLearningCentreStart(_request, sendJson) {
  try {
    const run = await startResearchIngestionRun();
    sendJson(200, { ok: true, run });
  } catch (error) {
    const safe = await safeLearningCentreError(error);
    sendJson(safe.statusCode, { ...safe.body, activeRun: error.activeRun || null });
  }
}

export async function handleLearningCentreSafeTest(_request, sendJson) {
  try {
    sendJson(200, await runSafeResearchTest());
  } catch (error) {
    const safe = await safeLearningCentreError(error);
    sendJson(safe.statusCode, {
      ...safe.body,
      missing_tables: error.missingTables || safe.body.missing_tables || [],
      inserted: [],
      errors: [{ message: error.message || "Safe research test failed." }]
    });
  }
}

export async function handleLearningCentreStop(_request, sendJson) {
  try {
    sendJson(200, await stopResearchIngestionRun());
  } catch (error) {
    const safe = await safeLearningCentreError(error);
    sendJson(safe.statusCode, safe.body);
  }
}

export async function handleLearningCentreSetup(_request, sendJson) {
  try {
    sendJson(200, { ok: true, ...(await getLearningCentreSetupStatus()) });
  } catch (error) {
    sendJson(500, { ok: false, message: error.message || "Learning Centre setup check failed." });
  }
}

export async function handleLearningCentreStatus(_request, sendJson) {
  try {
    sendJson(200, { ok: true, ...(await getLearningCentreStatus()) });
  } catch (error) {
    const safe = await safeLearningCentreError(error);
    sendJson(safe.statusCode, { ...safe.body, run: null, cards: null });
  }
}

export async function handleLearningCentreFindings(request, sendJson) {
  try {
    const client = getSupabaseServiceClient();
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));
    let query = client.from("research_findings").select("*").order("created_at", { ascending: false }).limit(limit);
    if (url.searchParams.get("role")) query = query.eq("role", url.searchParams.get("role"));
    if (url.searchParams.get("since")) query = query.gte("created_at", url.searchParams.get("since"));
    const { data, error } = await query;
    if (error) throw error;
    sendJson(200, { ok: true, findings: data || [] });
  } catch (error) {
    const safe = await safeLearningCentreError(error);
    sendJson(safe.statusCode, { ...safe.body, findings: [] });
  }
}

export async function handleLearningCentreReport(request, sendJson) {
  try {
    const client = getSupabaseServiceClient();
    const runId = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname.split("/").pop() || "");
    const { data, error } = await client
      .from("executive_intelligence_reports")
      .select("*")
      .eq("run_id", runId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    sendJson(200, { ok: true, report: data || null });
  } catch (error) {
    const safe = await safeLearningCentreError(error);
    sendJson(safe.statusCode, { ...safe.body, report: null });
  }
}
