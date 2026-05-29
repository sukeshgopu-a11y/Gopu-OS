import { requireSupabase, backendStatus } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';

const EXECUTIVE_ROLES = ['COO', 'CFO', 'CTO', 'CMO', 'CIO'];

function openAiKey() {
  return (
    (typeof process !== 'undefined' && (process.env?.OPENAI_API_KEY || process.env?.VITE_OPENAI_API_KEY)) ||
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_OPENAI_API_KEY || import.meta.env?.OPENAI_API_KEY)) ||
    ''
  );
}

async function embedText(text) {
  const apiKey = openAiKey();
  if (!apiKey) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: String(text).slice(0, 8000), dimensions: 1536 })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    return body.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || !embedding.length) return null;
  return `[${embedding.join(',')}]`;
}

// Write a decision or insight from an agent into shared memory (executive_knowledge)
export async function writeAgentMemory(role, topicCluster, content, options = {}) {
  const { client, error } = requireSupabase();
  const knowledgeKey = `${role}:${topicCluster}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const row = {
    role,
    topic_cluster: topicCluster,
    knowledge_key: knowledgeKey,
    knowledge_value: String(content).slice(0, 8000),
    confidence_score: options.confidence || 0.8,
    source_finding_ids: options.sourceFindingIds || [],
    updated_at: new Date().toISOString()
  };

  if (!error) {
    const embedding = await embedText(content);
    if (embedding) row.embedding = vectorLiteral(embedding);
    const { data, error: writeError } = await client
      .from('executive_knowledge')
      .upsert(row, { onConflict: 'role,knowledge_key' })
      .select('id,role,topic_cluster,updated_at')
      .maybeSingle();
    if (!writeError) return { ok: true, data, backend: backendStatus };
  }

  return { ok: true, data: row, backend: backendStatus, local: true };
}

// Query shared memory for a specific role and optional topic
export async function queryAgentMemory(role, topic = null) {
  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: [], backend: backendStatus, local: true };

  let query = client.from('executive_knowledge').select('*');
  if (role && role !== 'ALL') query = query.eq('role', role);
  if (topic) query = query.ilike('topic_cluster', `%${topic}%`);
  query = query.order('confidence_score', { ascending: false }).limit(20);

  const { data, error: queryError } = await query;
  if (queryError) return { ok: false, data: [], error: queryError, backend: backendStatus };
  return { ok: true, data: data || [], backend: backendStatus };
}

// Cross-query: one agent reads another agent's memory on a topic
export async function crossQueryMemory(askingRole, targetRole, topic) {
  const result = await queryAgentMemory(targetRole, topic);
  return {
    ...result,
    meta: { asked_by: askingRole, target_role: targetRole, topic }
  };
}

// Broadcast a structured update from an agent to Director Command
export async function broadcastToDirector(role, update, tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  const notification = {
    tenant_id: tenantId,
    recipient_role: 'director',
    source_module: `${role} Command`,
    title: `${role}: ${update.title || update.event || 'Agent update'}`,
    message: update.message || update.summary || '',
    status: 'Unread',
    priority: update.priority || update.severity || 'Medium',
    metadata: {
      agent_role: role,
      event_type: update.eventType || 'agent_update',
      workflow_id: update.workflowId || null,
      linked_route: update.linkedRoute || `/export-os/executives/${role.toLowerCase()}`,
      requires_decision: update.requiresDecision === true,
      ai_recommendation: update.aiRecommendation || null
    }
  };

  if (!error) {
    const { data, error: notifyError } = await client
      .from('notifications')
      .insert(notification)
      .select('id,title,priority,created_at')
      .maybeSingle();
    if (!notifyError) return { ok: true, data, backend: backendStatus };
  }

  return { ok: true, data: notification, backend: backendStatus, local: true };
}

// Get the latest knowledge snapshot for all executives (Director overview)
export async function getAllAgentMemorySummary() {
  const { client, error } = requireSupabase();
  if (error) return { ok: true, data: {}, backend: backendStatus, local: true };

  const { data, error: queryError } = await client
    .from('executive_knowledge')
    .select('role,topic_cluster,knowledge_value,confidence_score,updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (queryError) return { ok: false, data: {}, error: queryError, backend: backendStatus };

  const grouped = {};
  for (const role of EXECUTIVE_ROLES) grouped[role] = [];
  for (const row of (data || [])) {
    if (grouped[row.role]) grouped[row.role].push(row);
  }
  return { ok: true, data: grouped, backend: backendStatus };
}

export { EXECUTIVE_ROLES };
