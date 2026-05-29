/**
 * Inter-agent workflow orchestrator.
 *
 * Agents (CMO, COO, CFO, CTO, CIO) send peer messages, resolve them,
 * and report significant decisions to Director Command.
 *
 * DB table required: agent_messages
 *   id uuid, from_role text, to_role text, subject text, body text,
 *   context jsonb, status text (pending|resolved|dismissed), reply text,
 *   tenant_id uuid, created_at timestamptz, resolved_at timestamptz
 *
 * Gracefully degrades to in-memory when Supabase is unavailable.
 */

import { requireSupabase, backendStatus } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';
import { writeAgentMemory, broadcastToDirector, crossQueryMemory } from './agentMemoryService.js';
import { createTaskFromWorkflow } from './taskService.js';

const EXECUTIVE_ROLES = ['COO', 'CFO', 'CTO', 'CMO', 'CIO'];

// In-memory fallback when DB is unavailable
const localMessages = [];

function nowIso() {
  return new Date().toISOString();
}

// ─── Core Messaging ─────────────────────────────────────────────────────────

export async function sendAgentMessage(fromRole, toRole, subject, body, context = {}, tenantId = demoTenantId) {
  const message = {
    id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    from_role: fromRole,
    to_role: toRole,
    subject,
    body,
    context,
    status: 'pending',
    tenant_id: tenantId,
    created_at: nowIso(),
    resolved_at: null,
    reply: null
  };

  const { client, error } = requireSupabase();
  if (!error) {
    const { data, error: writeError } = await client
      .from('agent_messages')
      .insert(message)
      .select('id,from_role,to_role,subject,status,created_at')
      .maybeSingle();
    if (!writeError) return { ok: true, data, backend: backendStatus };
  }

  localMessages.unshift(message);
  return { ok: true, data: message, backend: backendStatus, local: true };
}

export async function resolveAgentMessage(messageId, reply, tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  const patch = { status: 'resolved', reply, resolved_at: nowIso() };

  if (!error) {
    const { data, error: updateError } = await client
      .from('agent_messages')
      .update(patch)
      .eq('id', messageId)
      .eq('tenant_id', tenantId)
      .select('id,from_role,to_role,subject,status,reply')
      .maybeSingle();
    if (!updateError) return { ok: true, data, backend: backendStatus };
  }

  const local = localMessages.find((m) => m.id === messageId);
  if (local) Object.assign(local, patch);
  return { ok: true, data: local || { id: messageId, ...patch }, backend: backendStatus, local: true };
}

export async function getAgentMessages(role, status = null, tenantId = demoTenantId) {
  const { client, error } = requireSupabase();
  if (!error) {
    let query = client
      .from('agent_messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`to_role.eq.${role},from_role.eq.${role}`)
      .order('created_at', { ascending: false })
      .limit(30);
    if (status) query = query.eq('status', status);
    const { data, error: queryError } = await query;
    if (!queryError) return { ok: true, data: data || [], backend: backendStatus };
  }

  const filtered = localMessages.filter((m) =>
    (m.to_role === role || m.from_role === role) &&
    (m.tenant_id === tenantId) &&
    (!status || m.status === status)
  );
  return { ok: true, data: filtered, backend: backendStatus, local: true };
}

// ─── Standard Inter-Agent Workflows ─────────────────────────────────────────

// CMO requests CTO confirm that publishing API/integration is ready
export async function cmoRequestCtoApiReady(context = {}, tenantId = demoTenantId) {
  return sendAgentMessage(
    'CMO', 'CTO',
    'Publishing API readiness check',
    'CMO is preparing to publish LinkedIn content. Please confirm: (1) LinkedIn API credentials are live, (2) no integration errors in the last hour, (3) automation queue is healthy.',
    { workflow_type: 'content_publishing', ...context },
    tenantId
  );
}

// CFO blocks a workflow and notifies relevant agents + Director
export async function cfoBlockWorkflow(workflowId, reason, notifyRoles = ['COO', 'CMO'], tenantId = demoTenantId) {
  const results = [];

  for (const role of notifyRoles) {
    results.push(await sendAgentMessage(
      'CFO', role,
      'Workflow blocked by CFO — commercial risk',
      `CFO has placed a hold on workflow ${workflowId}. Reason: ${reason}. Do not proceed with downstream actions until CFO releases the hold.`,
      { workflow_id: workflowId, block_reason: reason },
      tenantId
    ));
  }

  await broadcastToDirector('CFO', {
    title: 'CFO workflow block',
    message: `CFO blocked workflow ${workflowId}: ${reason}`,
    eventType: 'workflow_blocked',
    workflowId,
    priority: 'High',
    requiresDecision: true,
    aiRecommendation: 'Review margin/pricing parameters before releasing this workflow.',
    linkedRoute: '/export-os/executives/cfo'
  }, tenantId);

  await writeAgentMemory('CFO', 'workflow-blocks', `Blocked ${workflowId}: ${reason}`, { confidence: 0.9 });

  return { ok: true, data: { workflow_id: workflowId, blocked: true, notified: notifyRoles, messages: results }, backend: backendStatus };
}

// COO confirms operational readiness and notifies CFO + CMO
export async function cooConfirmOperationalReadiness(workflowId, details = {}, tenantId = demoTenantId) {
  await sendAgentMessage(
    'COO', 'CFO',
    'Operational readiness confirmed — safe to release invoice',
    `COO confirms: supplier confirmed, warehouse batch reserved, packing ready, documents prepared. Workflow ${workflowId} is operationally clear. CFO may proceed with invoice release.`,
    { workflow_id: workflowId, ...details },
    tenantId
  );

  await sendAgentMessage(
    'COO', 'CMO',
    'Operational readiness confirmed — buyer communication may proceed to draft stage',
    `COO confirms operational readiness for workflow ${workflowId}. CMO may prepare buyer-facing communication drafts. Final release still requires CFO + Founder approval.`,
    { workflow_id: workflowId, ...details },
    tenantId
  );

  await broadcastToDirector('COO', {
    title: 'Operational readiness confirmed',
    message: `COO cleared workflow ${workflowId}. CFO invoice release and CMO communication drafts may proceed.`,
    eventType: 'operational_ready',
    workflowId,
    priority: 'Medium',
    requiresDecision: false,
    linkedRoute: '/export-os/executives/coo'
  }, tenantId);

  await writeAgentMemory('COO', 'operational-readiness', `Cleared ${workflowId}: ${JSON.stringify(details)}`, { confidence: 0.85 });

  return { ok: true, data: { workflow_id: workflowId, cleared: true }, backend: backendStatus };
}

// CIO detects a market opportunity and notifies CMO + CFO
export async function cioDetectOpportunity(opportunity = {}, tenantId = demoTenantId) {
  await sendAgentMessage(
    'CIO', 'CMO',
    `Market opportunity: ${opportunity.title || 'new buyer signal'}`,
    `CIO has identified a market opportunity: ${opportunity.description || opportunity.title}. Target: ${opportunity.target || 'unknown buyer'}. CMO may prepare a tailored outreach draft. Pricing viability needs CFO review first.`,
    { opportunity_id: opportunity.id, ...opportunity },
    tenantId
  );

  await sendAgentMessage(
    'CIO', 'CFO',
    `Pricing viability check requested: ${opportunity.title || 'new opportunity'}`,
    `CIO has identified a market opportunity (${opportunity.title}). Before CMO outreach proceeds, please confirm this meets margin thresholds. Estimated value: ${opportunity.estimatedValue || 'unknown'}.`,
    { opportunity_id: opportunity.id, ...opportunity },
    tenantId
  );

  await broadcastToDirector('CIO', {
    title: `New opportunity: ${opportunity.title || 'market signal detected'}`,
    message: `CIO detected: ${opportunity.description || opportunity.title}. CMO and CFO have been notified.`,
    eventType: 'opportunity_detected',
    priority: opportunity.priority || 'Medium',
    requiresDecision: Boolean(opportunity.requiresFounderDecision),
    aiRecommendation: opportunity.recommendation || 'Evaluate pricing viability before outreach.',
    linkedRoute: '/export-os/cio'
  }, tenantId);

  await writeAgentMemory('CIO', 'market-opportunities', `${opportunity.title}: ${opportunity.description}`, { confidence: 0.75 });

  return { ok: true, data: { opportunity, notified: ['CMO', 'CFO', 'Director'] }, backend: backendStatus };
}

// CTO raises a system incident and notifies COO + CMO
export async function ctoRaiseIncident(incident = {}, tenantId = demoTenantId) {
  await sendAgentMessage(
    'CTO', 'COO',
    `System incident: ${incident.title || 'integration issue'}`,
    `CTO has raised a system incident: ${incident.description || incident.title}. Severity: ${incident.severity || 'Medium'}. COO should pause any automation-dependent workflows until resolved.`,
    { incident_id: incident.id, severity: incident.severity, ...incident },
    tenantId
  );

  await sendAgentMessage(
    'CTO', 'CMO',
    `Publishing may be affected: ${incident.title || 'integration issue'}`,
    `CTO raised a system incident that may affect publishing integrations. CMO should hold any scheduled posts until CTO confirms resolution.`,
    { incident_id: incident.id, ...incident },
    tenantId
  );

  await broadcastToDirector('CTO', {
    title: `System incident: ${incident.title || 'integration issue'}`,
    message: `CTO: ${incident.description || incident.title}. COO and CMO notified. Severity: ${incident.severity || 'Medium'}.`,
    eventType: 'system_incident',
    priority: incident.severity === 'Critical' ? 'Critical' : 'High',
    requiresDecision: incident.severity === 'Critical',
    linkedRoute: '/export-os/executives/cto'
  }, tenantId);

  return { ok: true, data: { incident, notified: ['COO', 'CMO', 'Director'] }, backend: backendStatus };
}

// CTO clears an incident and unblocks agents
export async function ctoClearIncident(incidentId, resolution, tenantId = demoTenantId) {
  await sendAgentMessage(
    'CTO', 'COO',
    `Incident cleared: ${incidentId}`,
    `CTO has resolved incident ${incidentId}. Resolution: ${resolution}. COO may resume automation-dependent workflows.`,
    { incident_id: incidentId, resolution },
    tenantId
  );

  await sendAgentMessage(
    'CTO', 'CMO',
    `Publishing integrations restored`,
    `CTO has cleared incident ${incidentId}. Publishing integrations are operational. CMO may resume scheduled content.`,
    { incident_id: incidentId, resolution },
    tenantId
  );

  await broadcastToDirector('CTO', {
    title: `Incident resolved: ${incidentId}`,
    message: `CTO resolved incident. ${resolution}. All systems operational.`,
    eventType: 'incident_resolved',
    priority: 'Low',
    requiresDecision: false,
    linkedRoute: '/export-os/executives/cto'
  }, tenantId);

  return { ok: true, data: { incident_id: incidentId, resolved: true, resolution }, backend: backendStatus };
}

// Full cross-agent workflow: CIO opportunity → CFO check → COO feasibility → CMO content → Director summary
export async function runOpportunityWorkflow(opportunity = {}, tenantId = demoTenantId) {
  const steps = [];

  // Step 1: CIO fires off to CFO and CMO
  steps.push(await cioDetectOpportunity(opportunity, tenantId));

  // Step 2: CMO cross-queries CFO memory for margin context
  const cfoMemory = await crossQueryMemory('CMO', 'CFO', 'margin');
  const marginContext = cfoMemory.data?.[0]?.knowledge_value || 'No CFO margin history available.';

  // Step 3: CMO writes a strategy note informed by CFO memory
  await writeAgentMemory('CMO', 'outreach-strategy', `Opportunity: ${opportunity.title}. CFO margin context: ${marginContext}. Draft outreach prepared, pending approval.`, { confidence: 0.7 });

  // Step 4: COO feasibility check message to CFO
  await sendAgentMessage(
    'COO', 'CFO',
    `Operational feasibility for: ${opportunity.title || 'new opportunity'}`,
    `COO has reviewed operational capacity for this opportunity. Supplier and warehouse capacity appears available. CFO margin approval is the current gate.`,
    { opportunity_id: opportunity.id },
    tenantId
  );

  // Step 5: Director gets a consolidated summary
  await broadcastToDirector('CIO', {
    title: `Cross-agent workflow active: ${opportunity.title || 'new opportunity'}`,
    message: `CIO opportunity triggered. CFO margin check in progress. COO confirmed operational capacity. CMO has outreach draft ready. Awaiting CFO approval before release.`,
    eventType: 'cross_agent_workflow',
    priority: opportunity.priority || 'High',
    requiresDecision: true,
    aiRecommendation: 'Review CFO margin approval before releasing CMO outreach and COO commitment.',
    linkedRoute: '/export-os/director'
  }, tenantId);

  // Step 6: Create a Task for the Founder
  await createTaskFromWorkflow({
    tenant_id: tenantId,
    title: `Cross-agent workflow: ${opportunity.title || 'new opportunity'}`,
    description: `CIO, CMO, COO, and CFO are coordinating on this opportunity. CFO margin approval is the current blocker. All agents have been briefed.`,
    workflow_source: 'Agent Workflow Orchestrator',
    linked_record_id: opportunity.id || `opp-${Date.now()}`,
    linked_label: opportunity.title || 'Market opportunity',
    linked_route: '/export-os/director',
    department: 'Founder Office',
    owner_command: 'Founder',
    assigned_role: 'Founder',
    priority: opportunity.priority || 'High',
    status: 'Waiting CFO Approval',
    due_date: 'Today',
    blocking_reason: 'CFO margin threshold review is required before the workflow can proceed.',
    next_action: 'Founder reviews CFO margin decision and approves outreach release.'
  });

  return { ok: true, data: { opportunity, steps, workflow: 'opportunity_cross_agent' }, backend: backendStatus };
}

// Get a real-time Agent Activity Feed for Director Command
export async function getAgentActivityFeed(tenantId = demoTenantId) {
  const results = await Promise.all(
    EXECUTIVE_ROLES.map((role) => getAgentMessages(role, null, tenantId))
  );

  const allMessages = results
    .flatMap((r) => r.data || [])
    .filter((m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 40);

  const pendingByRole = {};
  for (const role of EXECUTIVE_ROLES) {
    pendingByRole[role] = allMessages.filter((m) => m.to_role === role && m.status === 'pending').length;
  }

  return {
    ok: true,
    data: {
      messages: allMessages,
      pendingByRole,
      totalPending: allMessages.filter((m) => m.status === 'pending').length,
      lastActivity: allMessages[0]?.created_at || null
    },
    backend: backendStatus
  };
}

export { EXECUTIVE_ROLES };
