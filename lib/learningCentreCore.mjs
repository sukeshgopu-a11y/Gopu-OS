import { DateTime } from "luxon";
import {
  DEFAULT_TENANT_ID,
  EXECUTIVE_ROLES,
  env,
  getActiveResearchRun,
  getLearningCentreTableStatuses,
  getSupabaseServiceClient,
  incrementRunCounters,
  nowIso,
  vectorLiteral,
  writeResearchAudit
} from "./learningCentreDb.mjs";
import { createWebSearchProvider } from "./learningCentreSearch.mjs";
import { enqueueResearchCycle } from "./learningCentreQueue.mjs";

const SEARCH_CONTEXT = "agri export business in India, founder-led, scaling stage";
const MAX_RETRIES = 3;
const DEFAULT_ROLE_BATCH = 5;
const SAFE_RESEARCH_TEST_SOURCES = [
  {
    topic: "APEDA export reference",
    platform: "Public Web",
    category: "Export reference",
    url: "https://apeda.gov.in/",
    title: "APEDA"
  },
  {
    topic: "Spice Board export reference",
    platform: "Public Web",
    category: "Spice export reference",
    url: "https://www.indianspices.com/",
    title: "Spices Board India"
  },
  {
    topic: "DGFT export policy reference",
    platform: "Public Web",
    category: "Trade policy reference",
    url: "https://www.dgft.gov.in/CP/",
    title: "Directorate General of Foreign Trade"
  }
];

function cycleMinutes() {
  return Math.max(1, Number(env("LEARNING_CENTRE_CYCLE_MINUTES", "15")));
}

function consolidationEveryN() {
  return Math.max(1, Number(env("LEARNING_CENTRE_CONSOLIDATION_EVERY_N", String(DEFAULT_ROLE_BATCH))));
}

function fetchTimeoutMs() {
  return Math.max(1000, Number(env("LEARNING_CENTRE_FETCH_TIMEOUT_MS", "10000")));
}

function fetchMaxBytes() {
  return Math.max(1024, Number(env("LEARNING_CENTRE_FETCH_MAX_BYTES", "1048576")));
}

function safeDomain(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractPublicSourceSummary(text = "", source = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const excerpt = clean.slice(0, 700);
  const firstSentence = excerpt.match(/[^.!?]+[.!?]/)?.[0]?.trim() || excerpt.slice(0, 240).trim();
  return {
    summary: `${source.title || safeDomain(source.url)} public source reviewed: ${firstSentence || "source page fetched successfully."}`,
    keyInsights: [
      `Fetched public source: ${source.title || safeDomain(source.url)}`,
      `Source domain: ${safeDomain(source.url) || "unknown"}`,
      `Category: ${source.category || "Export reference"}`
    ],
    confidence: 0.35,
    tokens: Math.ceil(clean.length / 4)
  };
}

function htmlToText(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function retryTransient(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`${label}: ${lastError?.message || "failed"}`);
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs());
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "GOPU-OS-ResearchIngestion/1.0 (+read-only public web summarization)"
      }
    });
    if (!response.ok) throw new Error(`Page fetch returned HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return htmlToText(text.slice(0, fetchMaxBytes()));
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > fetchMaxBytes()) break;
      chunks.push(value);
    }
    return htmlToText(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeFinding({ role, topic, pageText, source }) {
  const apiKey = env("OPENAI_API_KEY") || env("CTO_PROVIDER_OPENAI_API_KEY") || env("CTO_OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
  const model = env("OPENAI_SUMMARY_MODEL", "gpt-5.5");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "Return strict JSON only. Do not invent source facts. If the source is generic, low quality, or weakly connected to the executive role, set confidence low."
        },
        {
          role: "user",
          content: JSON.stringify({
            role,
            topic,
            source_title: source.title,
            source_url: source.url,
            source_snippet: source.snippet,
            page_text: pageText.slice(0, 24000),
            required_shape: {
              summary: "string",
              key_insights: ["string"],
              confidence: "0.0-1.0",
              applicable_to_agri_export: "boolean"
            }
          })
        }
      ],
      text: { format: { type: "json_object" } },
      temperature: 0.2,
      max_output_tokens: 900
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI summary failed with HTTP ${response.status}`);
  const raw = body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n") || "{}";
  const parsed = JSON.parse(raw);
  return {
    summary: String(parsed.summary || "").trim(),
    key_insights: Array.isArray(parsed.key_insights) ? parsed.key_insights.map(String).filter(Boolean).slice(0, 8) : [],
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
    applicable_to_agri_export: parsed.applicable_to_agri_export === true,
    tokens: body.usage?.total_tokens || 0,
    model
  };
}

async function embedText(text) {
  const apiKey = env("OPENAI_API_KEY") || env("CTO_PROVIDER_OPENAI_API_KEY") || env("CTO_OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
  const model = env("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input: text, dimensions: 1536 })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI embedding failed with HTTP ${response.status}`);
  return { embedding: body.data?.[0]?.embedding || [], tokens: body.usage?.total_tokens || 0, model };
}

async function selectNextTopic(client, role) {
  const { data, error } = await client
    .from("executive_topics")
    .select("*")
    .eq("role", role)
    .eq("active", true)
    .order("last_researched_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No active topics configured for ${role}.`);
  return data;
}

async function sourceAlreadyInRun(client, runId, sourceUrl) {
  const { data, error } = await client
    .from("research_findings")
    .select("id")
    .eq("run_id", runId)
    .eq("source_url", sourceUrl)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function insertFinding(client, { run, role, topic, source, summary, embedding }) {
  if (!source.url) throw new Error("source_url is required.");
  const { data, error } = await client.from("research_findings").insert({
    run_id: run.id,
    role,
    topic: topic.topic,
    learning_summary: summary.summary,
    key_insights: summary.key_insights,
    source_type: source.source_type || "web",
    source_url: source.url,
    source_domain: safeDomain(source.url),
    confidence_score: summary.confidence,
    status: summary.applicable_to_agri_export ? "stored" : "stored_not_applicable",
    memory_saved: summary.applicable_to_agri_export,
    tokens_processed: Number(summary.tokens || 0) + Number(embedding.tokens || 0),
    embedding: vectorLiteral(embedding.embedding),
    metadata: {
      source_title: source.title || "",
      source_snippet: source.snippet || "",
      summary_model: summary.model,
      embedding_model: embedding.model,
      applicable_to_agri_export: summary.applicable_to_agri_export
    }
  }).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

async function updateTopicAfterCycle(client, topicId) {
  const { data: topic, error: readError } = await client
    .from("executive_topics")
    .select("times_researched")
    .eq("id", topicId)
    .maybeSingle();
  if (readError) throw readError;
  const { error } = await client.from("executive_topics").update({
    last_researched_at: nowIso(),
    times_researched: Number(topic?.times_researched || 0) + 1
  }).eq("id", topicId);
  if (error) throw error;
}

export async function startResearchIngestionRun() {
  const client = getSupabaseServiceClient();
  const active = await getActiveResearchRun(client);
  if (active) {
    const error = new Error("A research ingestion run is already active.");
    error.statusCode = 409;
    error.activeRun = active;
    throw error;
  }
  const effectiveStart = DateTime.now().setZone("Asia/Kolkata");
  const endsAt = effectiveStart.plus({ hours: 12 });
  const { data, error } = await client.from("research_ingestion_runs").insert({
    started_at: effectiveStart.toUTC().toISO(),
    ends_at: endsAt.toUTC().toISO(),
    duration_hours: 12,
    status: "running",
    current_phase: "queued",
    current_role: "COO"
  }).select("*").maybeSingle();
  if (error) throw error;
  await writeResearchAudit(client, { runId: data.id, step: "run_started", message: "Research ingestion run started.", payload: { duration_hours: 12 } });
  await enqueueResearchCycle(data.id, 0);
  return data;
}

export async function stopResearchIngestionRun() {
  const client = getSupabaseServiceClient();
  const active = await getActiveResearchRun(client);
  if (!active) return { ok: true, status: "idle", message: "No active research ingestion run." };
  const { data, error } = await client.from("research_ingestion_runs").update({
    status: "stopped",
    current_phase: "stopped",
    updated_at: nowIso()
  }).eq("id", active.id).select("*").maybeSingle();
  if (error) throw error;
  await writeResearchAudit(client, { runId: active.id, step: "run_stopped", level: "warn", message: "Research ingestion run stopped by operator." });
  return { ok: true, status: "stopped", run: data };
}

function nextRole(currentRole) {
  const index = EXECUTIVE_ROLES.indexOf(currentRole);
  return EXECUTIVE_ROLES[(index + 1) % EXECUTIVE_ROLES.length];
}

export async function runResearchCycle(runId) {
  const client = getSupabaseServiceClient();
  const { data: run, error: runError } = await client.from("research_ingestion_runs").select("*").eq("id", runId).maybeSingle();
  if (runError) throw runError;
  if (!run || run.status !== "running") return { ok: false, status: "not_running" };
  if (env("STOP_LEARNING_CENTRE", "false").toLowerCase() === "true") {
    await stopResearchIngestionRun();
    return { ok: true, status: "stopped_by_env" };
  }
  if (DateTime.utc() > DateTime.fromISO(run.ends_at, { zone: "utc" })) {
    await completeRun(runId);
    return { ok: true, status: "completed" };
  }

  const role = run.current_role || "COO";
  await client.from("research_ingestion_runs").update({ current_phase: "searching", current_role: role, updated_at: nowIso() }).eq("id", runId);
  const topic = await selectNextTopic(client, role);
  const query = `${topic.topic} ${SEARCH_CONTEXT}`;
  const provider = createWebSearchProvider();

  try {
    const results = await retryTransient(() => provider.search(query, { maxResults: 3 }), "web search");
    await incrementRunCounters(client, runId, { sources: results.length });
    const source = results.find((result) => result.url);
    let selected = null;
    for (const result of results) {
      if (!(await sourceAlreadyInRun(client, runId, result.url))) {
        selected = result;
        break;
      }
    }
    if (!selected) {
      await writeResearchAudit(client, { runId, step: "dedupe_skip", message: "All candidate sources were already ingested for this run.", payload: { role, topic: topic.topic } });
      await scheduleNextCycle(client, runId, role);
      return { ok: true, status: "duplicates_skipped" };
    }
    if (!source?.url) throw new Error("Search provider returned no usable source URL.");

    const pageText = await retryTransient(() => fetchPageText(selected.url), "page fetch");
    if (!pageText) throw new Error("Fetched page had no readable text.");
    const summary = await retryTransient(() => summarizeFinding({ role, topic: topic.topic, pageText, source: selected }), "summarization");
    if (!summary.summary) throw new Error("Summarization returned an empty summary.");
    const embedding = await retryTransient(() => embedText(summary.summary), "embedding");
    if (!embedding.embedding.length) throw new Error("Embedding model returned no vector.");
    const finding = await insertFinding(client, { run, role, topic, source: selected, summary, embedding });
    await updateTopicAfterCycle(client, topic.id);
    await incrementRunCounters(client, runId, { items: 1, memory: summary.applicable_to_agri_export ? 1 : 0 });
    await writeResearchAudit(client, { runId, step: "finding_stored", message: "Research finding stored from public source.", payload: { role, topic: topic.topic, finding_id: finding.id, source_url: selected.url } });

    if (summary.applicable_to_agri_export) {
      const count = await countRoleFindings(client, runId, role);
      if (count > 0 && count % consolidationEveryN() === 0) {
        await consolidateRoleKnowledge(client, runId, role);
      }
    }
    await scheduleNextCycle(client, runId, role);
    return { ok: true, status: "finding_stored", finding };
  } catch (error) {
    await incrementRunCounters(client, runId, { errors: 1 });
    await writeResearchAudit(client, { runId, step: "cycle_error", level: "error", message: error.message, payload: { role, topic: topic.topic } });
    await scheduleNextCycle(client, runId, role);
    return { ok: false, status: "cycle_error", message: error.message };
  }
}

async function scheduleNextCycle(client, runId, role) {
  const next = nextRole(role);
  await client.from("research_ingestion_runs").update({
    current_role: next,
    current_phase: "waiting_next_cycle",
    updated_at: nowIso()
  }).eq("id", runId);
  await enqueueResearchCycle(runId, cycleMinutes() * 60 * 1000);
}

async function countRoleFindings(client, runId, role) {
  const { count, error } = await client
    .from("research_findings")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("role", role)
    .eq("memory_saved", true);
  if (error) throw error;
  return count || 0;
}

export async function consolidateRoleKnowledge(client, runId, role) {
  const { data: findings, error } = await client
    .from("research_findings")
    .select("id,topic,learning_summary,key_insights,confidence_score,embedding")
    .eq("run_id", runId)
    .eq("role", role)
    .eq("memory_saved", true)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  if (!findings?.length) return null;

  const clusters = new Map();
  findings.forEach((finding) => {
    const key = finding.topic || "General";
    const existing = clusters.get(key) || [];
    existing.push(finding);
    clusters.set(key, existing);
  });

  const writes = [];
  for (const [topicCluster, rows] of clusters.entries()) {
    const best = [...rows].sort((a, b) => Number(b.confidence_score || 0) - Number(a.confidence_score || 0))[0];
    writes.push({
      role,
      topic_cluster: topicCluster,
      knowledge_key: `${role}:${topicCluster}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      knowledge_value: rows.map((row) => row.learning_summary).join("\n\n"),
      source_finding_ids: rows.map((row) => row.id),
      confidence_score: Math.max(...rows.map((row) => Number(row.confidence_score || 0))),
      embedding: best.embedding,
      updated_at: nowIso()
    });
  }
  const { data, error: writeError } = await client.from("executive_knowledge").upsert(writes, {
    onConflict: "role,knowledge_key"
  }).select("id,role,topic_cluster");
  if (writeError) throw writeError;
  await writeResearchAudit(client, { runId, step: "knowledge_consolidated", message: "Executive knowledge entries consolidated from research findings.", payload: { role, count: data?.length || 0 } });
  return data;
}

export async function completeRun(runId) {
  const client = getSupabaseServiceClient();
  for (const role of EXECUTIVE_ROLES) {
    await consolidateRoleKnowledge(client, runId, role).catch((error) => writeResearchAudit(client, { runId, step: "final_consolidation_error", level: "error", message: error.message, payload: { role } }));
  }
  await generateFinalReport(client, runId);
  const { data, error } = await client.from("research_ingestion_runs").update({
    status: "completed",
    current_phase: "completed",
    updated_at: nowIso()
  }).eq("id", runId).select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function generateFinalReport(client, runId) {
  const { data: knowledge, error } = await client
    .from("executive_knowledge")
    .select("*")
    .order("confidence_score", { ascending: false });
  if (error) throw error;
  const apiKey = env("OPENAI_API_KEY") || env("CTO_PROVIDER_OPENAI_API_KEY") || env("CTO_OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
  const sections = [
    "COO findings", "CFO findings", "CTO findings", "CMO findings", "CIO findings",
    "Strongest insights", "Recurring patterns", "Recommended business systems",
    "Operational opportunities", "Scaling recommendations", "Infrastructure recommendations",
    "Marketing opportunities", "Risk warnings"
  ];
  const reportJson = {};
  const markdownParts = [];
  for (const section of sections) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env("OPENAI_SUMMARY_MODEL", "gpt-5.5"),
        input: `Write the "${section}" section from these executive_knowledge rows. Cite source_finding_ids inline for every claim. Return concise markdown only.\n${JSON.stringify(knowledge || []).slice(0, 60000)}`,
        max_output_tokens: 1200
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `Report section failed: ${section}`);
    const text = body.output_text || "";
    reportJson[section] = text;
    markdownParts.push(`## ${section}\n\n${text}`);
  }
  const { data, error: insertError } = await client.from("executive_intelligence_reports").insert({
    run_id: runId,
    report_markdown: markdownParts.join("\n\n"),
    report_json: reportJson
  }).select("*").maybeSingle();
  if (insertError) throw insertError;
  await writeResearchAudit(client, { runId, step: "final_report_generated", message: "Executive intelligence report generated." });
  return data;
}

export async function getLearningCentreStatus() {
  const client = getSupabaseServiceClient();
  const active = await getActiveResearchRun(client);
  const { data: lastRun } = active ? { data: active } : await client.from("research_ingestion_runs").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const debug = await getLearningCentreDebugStatus(client, lastRun);
  if (!lastRun) return { run: null, cards: null, debug };
  const since = DateTime.utc().minus({ minutes: 15 }).toISO();
  const { data: audits } = await client.from("audit_logs").select("level").eq("run_id", lastRun.id).gte("created_at", since);
  const health = audits?.some((row) => row.level === "error") ? "red" : audits?.some((row) => row.level === "warn") ? "amber" : "green";
  const tokens = await client.from("research_findings").select("tokens_processed").eq("run_id", lastRun.id);
  return {
    run: lastRun,
    debug,
    cards: {
      total_sources_scanned: lastRun.total_sources_scanned || 0,
      knowledge_items_stored: lastRun.total_items_learned || 0,
      memory_embedded: lastRun.total_memory_saved || 0,
      active_research_threads: lastRun.status === "running" ? EXECUTIVE_ROLES.length : 0,
      current_executive_focus: lastRun.current_role || "",
      runtime_remaining_seconds: Math.max(0, Math.floor((DateTime.fromISO(lastRun.ends_at).toMillis() - Date.now()) / 1000)),
      tokens_processed: (tokens.data || []).reduce((sum, row) => sum + Number(row.tokens_processed || 0), 0),
      system_health: health
    }
  };
}

export async function getLearningCentreDebugStatus(client = getSupabaseServiceClient(), knownLastRun = null) {
  const table_status = await getLearningCentreTableStatuses(client);
  const runsReady = table_status.find((item) => item.table === "research_ingestion_runs")?.exists;
  const findingsReady = table_status.find((item) => item.table === "research_findings")?.exists;
  const redisConfigured = Boolean(env("REDIS_URL"));
  const worker_status = redisConfigured && runsReady && findingsReady ? "configured_not_confirmed" : redisConfigured ? "schema_blocked" : "missing_redis_url";
  let lastRun = knownLastRun;
  let latestFinding = null;
  let ingestionErrors = [];

  if (runsReady && !lastRun) {
    const { data } = await client.from("research_ingestion_runs").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
    lastRun = data || null;
  }
  if (findingsReady) {
    const { data } = await client
      .from("research_findings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestFinding = data || null;
  }
  if (lastRun?.id) {
    const { data } = await client
      .from("audit_logs")
      .select("created_at,step,level,message")
      .eq("module", "Learning Centre")
      .eq("run_id", lastRun.id)
      .in("level", ["warn", "error"])
      .order("created_at", { ascending: false })
      .limit(5);
    ingestionErrors = data || [];
  }

  return {
    worker_status,
    redis_configured: redisConfigured,
    last_ingestion_run: lastRun || null,
    rows_recorded: Object.fromEntries(table_status.map((item) => [item.table, item.rows])),
    table_status,
    latest_source_url: latestFinding?.source_url || "",
    latest_platform: latestFinding?.platform || latestFinding?.metadata?.platform || latestFinding?.source_type || "",
    ingestion_errors: ingestionErrors,
    next_scheduled_run: lastRun?.metadata?.next_run_at || lastRun?.metadata?.next_scheduled_at || (lastRun?.status === "running" ? "Worker queue controlled" : "Not scheduled")
  };
}

export async function runSafeResearchTest() {
  const client = getSupabaseServiceClient();
  const setupTables = await getLearningCentreTableStatuses(client);
  const missing = setupTables.filter((item) => !item.exists).map((item) => item.table);
  if (missing.includes("research_ingestion_runs") || missing.includes("research_findings")) {
    const error = new Error(`Learning Centre schema missing: ${missing.join(", ")}`);
    error.statusCode = 424;
    error.missingTables = missing;
    throw error;
  }

  const startedAt = DateTime.utc();
  const { data: run, error: runError } = await client.from("research_ingestion_runs").insert({
    started_at: startedAt.toISO(),
    ends_at: startedAt.plus({ minutes: 5 }).toISO(),
    duration_hours: 0,
    status: "completed",
    current_phase: "safe_research_test_completed",
    current_role: "CMO"
  }).select("*").maybeSingle();
  if (runError) throw runError;

  const inserted = [];
  const errors = [];
  for (const source of SAFE_RESEARCH_TEST_SOURCES) {
    try {
      const pageText = await fetchPageText(source.url);
      if (!pageText) throw new Error("No readable public page text returned.");
      const summary = extractPublicSourceSummary(pageText, source);
      const { data, error } = await client.from("research_findings").insert({
        run_id: run.id,
        role: "CMO",
        topic: source.topic,
        learning_summary: summary.summary,
        key_insights: summary.keyInsights,
        source_type: "public_web_safe_test",
        source_url: source.url,
        source_domain: safeDomain(source.url),
        confidence_score: summary.confidence,
        status: "stored_safe_test",
        memory_saved: false,
        tokens_processed: summary.tokens,
        metadata: {
          platform: source.platform,
          category: source.category,
          source_title: source.title,
          safe_research_test: true,
          no_auto_post: true,
          generated_from_public_page_text: true
        }
      }).select("*").maybeSingle();
      if (error) throw error;
      inserted.push(data);
    } catch (error) {
      errors.push({ source_url: source.url, message: error.message });
    }
  }

  await client.from("research_ingestion_runs").update({
    total_sources_scanned: SAFE_RESEARCH_TEST_SOURCES.length,
    total_items_learned: inserted.length,
    total_memory_saved: 0,
    total_errors: errors.length
  }).eq("id", run.id);

  await writeResearchAudit(client, {
    runId: run.id,
    step: "safe_research_test_completed",
    message: "Safe public-source research test completed without posting or fake analytics.",
    payload: { inserted: inserted.length, errors }
  });

  return {
    ok: true,
    run: { ...run, total_sources_scanned: SAFE_RESEARCH_TEST_SOURCES.length, total_items_learned: inserted.length, total_errors: errors.length },
    inserted,
    errors,
    debug: await getLearningCentreDebugStatus(client)
  };
}
