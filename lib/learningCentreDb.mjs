import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const EXECUTIVE_ROLES = ["COO", "CFO", "CTO", "CMO", "CIO"];
export const RUNNING_STATUSES = ["running"];
export const DEFAULT_TENANT_ID = "11111111-1111-1111-1111-111111111111";
export const LEARNING_CENTRE_MIGRATION_FILE = "supabase/migrations/20260528131644_cmo_learning_centre_research_schema.sql";
export const LEARNING_CENTRE_REQUIRED_TABLES = [
  "research_ingestion_runs",
  "research_findings",
  "content_research_findings",
  "content_pattern_library",
  "ai_content_memory",
  "cmo_strategy_memory",
  "executive_knowledge",
  "executive_topics",
  "executive_intelligence_reports",
  "audit_logs"
];

export function loadLocalEnv() {
  for (const file of [".env", ".env.local"]) {
    const target = path.resolve(process.cwd(), file);
    if (!fs.existsSync(target)) continue;
    const rows = fs.readFileSync(target, "utf8").split(/\r?\n/);
    for (const row of rows) {
      const match = row.match(/^\ufeff?([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, "").trim();
      if (!value) continue;
      if (file === ".env.local" || !process.env[match[1]]) {
        process.env[match[1]] = value;
      }
    }
  }
}

export function env(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function getSupabaseUrl() {
  return env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL") || env("VITE_SUPABASE_URL");
}

export function getSupabaseServiceClient() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server env is missing.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function vectorLiteral(values = []) {
  if (!Array.isArray(values) || !values.length) return null;
  return `[${values.map((value) => Number(value) || 0).join(",")}]`;
}

export function nowIso() {
  return new Date().toISOString();
}

async function tableExists(client, tableName) {
  const { error } = await client
    .from(tableName)
    .select("id")
    .limit(1);
  if (!error) return { table: tableName, exists: true };
  const message = error.message || "";
  if (error.code === "PGRST205" || message.includes("schema cache") || message.includes("Could not find the table")) {
    return { table: tableName, exists: false, error };
  }
  return { table: tableName, exists: true, warning: error };
}

export const LEARNING_CENTRE_DEBUG_TABLES = [
  "research_ingestion_runs",
  "research_findings",
  "content_research_findings",
  "content_pattern_library",
  "ai_content_memory",
  "cmo_strategy_memory"
];

export async function getTableStatus(client, tableName) {
  const result = await client
    .from(tableName)
    .select("*", { count: "exact" })
    .limit(1);
  if (result.error) {
    return {
      table: tableName,
      exists: false,
      rows: 0,
      error: result.error.message,
      code: result.error.code || null
    };
  }
  return {
    table: tableName,
    exists: true,
    rows: result.count ?? result.data?.length ?? 0,
    error: "",
    code: null
  };
}

export async function getLearningCentreTableStatuses(client = getSupabaseServiceClient()) {
  return Promise.all(LEARNING_CENTRE_DEBUG_TABLES.map((table) => getTableStatus(client, table)));
}

export async function getLearningCentreSetupStatus() {
  const client = getSupabaseServiceClient();
  const checks = await Promise.all(LEARNING_CENTRE_REQUIRED_TABLES.map((table) => tableExists(client, table)));
  const missingTables = checks.filter((check) => !check.exists).map((check) => check.table);
  const tableWarnings = checks
    .filter((check) => check.warning)
    .map((check) => ({ table: check.table, message: check.warning.message, code: check.warning.code || null }));
  const redisConfigured = Boolean(env("REDIS_URL"));
  const migrationApplied = missingTables.length === 0;
  return {
    migration_applied: migrationApplied,
    missing_tables: missingTables,
    redis_configured: redisConfigured,
    worker_ready: migrationApplied && redisConfigured,
    migration: LEARNING_CENTRE_MIGRATION_FILE,
    setup_message: migrationApplied
      ? "Learning Centre SQL migration is applied."
      : "Learning Centre tables missing. Apply Supabase SQL migration.",
    table_warnings: tableWarnings
  };
}

export async function writeResearchAudit(client, { runId = null, step, level = "info", message, payload = {} }) {
  const { data, error } = await client.from("audit_logs").insert({
    tenant_id: DEFAULT_TENANT_ID,
    action_type: step,
    module: "Learning Centre",
    actor: "Research Ingestion Worker",
    description: message,
    risk_level: level === "error" ? "High" : level === "warn" ? "Medium" : "Low",
    run_id: runId,
    step,
    level,
    message,
    payload_json: payload,
    metadata: {
      ...(payload || {}),
      run_id: runId,
      step,
      level
    }
  }).select("id,step,level,created_at").maybeSingle();
  if (error) {
    console.error("[learning-centre] audit write failed", { step, message: error.message });
    return null;
  }
  return data;
}

export async function getActiveResearchRun(client) {
  const { data, error } = await client
    .from("research_ingestion_runs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

export async function incrementRunCounters(client, runId, counters = {}) {
  const { data: current, error: readError } = await client
    .from("research_ingestion_runs")
    .select("total_items_learned,total_sources_scanned,total_memory_saved,total_errors")
    .eq("id", runId)
    .maybeSingle();
  if (readError) throw readError;
  const payload = {
    total_items_learned: Number(current?.total_items_learned || 0) + Number(counters.items || 0),
    total_sources_scanned: Number(current?.total_sources_scanned || 0) + Number(counters.sources || 0),
    total_memory_saved: Number(current?.total_memory_saved || 0) + Number(counters.memory || 0),
    total_errors: Number(current?.total_errors || 0) + Number(counters.errors || 0),
    updated_at: nowIso()
  };
  const { error } = await client.from("research_ingestion_runs").update(payload).eq("id", runId);
  if (error) throw error;
}
