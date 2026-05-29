import { loadLocalEnv, requireSupabaseClient } from "./cmo-learning-shared.mjs";

const TABLES = [
  "research_ingestion_runs",
  "research_findings",
  "content_research_findings",
  "content_pattern_library",
  "ai_content_memory",
  "cmo_strategy_memory"
];

async function tableStatus(client, table) {
  const result = await client.from(table).select("*", { count: "exact" }).limit(1);
  if (result.error) {
    return {
      table,
      exists: false,
      rows: 0,
      error: result.error.message,
      code: result.error.code || null
    };
  }
  return {
    table,
    exists: true,
    rows: result.count ?? result.data?.length ?? 0,
    error: "",
    code: null
  };
}

async function safeLatest(client, table, columns = "*") {
  const result = await client.from(table).select(columns).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) return { data: null, error: result.error.message };
  return { data: result.data || null, error: "" };
}

async function main() {
  loadLocalEnv();
  const client = requireSupabaseClient();
  const tables = await Promise.all(TABLES.map((table) => tableStatus(client, table)));
  const latestRun = tables.find((item) => item.table === "research_ingestion_runs")?.exists
    ? await safeLatest(client, "research_ingestion_runs")
    : { data: null, error: "research_ingestion_runs missing" };
  const latestFinding = tables.find((item) => item.table === "research_findings")?.exists
    ? await safeLatest(client, "research_findings", "id,role,topic,source_url,source_domain,status,memory_saved,created_at,metadata")
    : { data: null, error: "research_findings missing" };

  console.log(JSON.stringify({
    ok: true,
    tables,
    worker: {
      redis_configured: Boolean(process.env.REDIS_URL),
      status: process.env.REDIS_URL ? "configured_not_confirmed" : "missing_redis_url",
      scheduler_runtime: process.env.SCHEDULER_RUNTIME || "not configured"
    },
    ingestion: {
      has_executed: Boolean(latestRun.data),
      latest_run: latestRun.data,
      latest_run_error: latestRun.error,
      latest_finding: latestFinding.data,
      latest_finding_error: latestFinding.error
    },
    safety: {
      auto_posting: false,
      fake_analytics: false,
      approval_gating_required: true
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
