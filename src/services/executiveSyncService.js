import { backendStatus } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';
import { createTaskFromWorkflow } from './taskService.js';
import { getWorkflowDependencyEngineData } from './workflowDependencyService.js';
import { getWorkflowJourneyDashboard } from './operationalTimelineService.js';
import { getAllAgentMemorySummary, writeAgentMemory } from './agentMemoryService.js';
import { getAgentActivityFeed } from './agentWorkflowService.js';

const demoDelay = 70;
const generatedSyncEvents = new Set();

function wait() {
  return new Promise((resolve) => setTimeout(resolve, demoDelay));
}

function severityState(severity) {
  if (severity === 'Critical') return 'Critical';
  if (severity === 'High Risk' || severity === 'High') return 'High';
  if (severity === 'Medium' || severity === 'Attention') return 'Medium';
  return 'Low';
}

function executiveForRisk(riskType) {
  const text = riskType.toLowerCase();
  if (text.includes('margin') || text.includes('pricing') || text.includes('invoice') || text.includes('payment')) return 'CFO';
  if (text.includes('shipment') || text.includes('supplier') || text.includes('warehouse') || text.includes('dispatch')) return 'COO';
  if (text.includes('api') || text.includes('automation') || text.includes('technical')) return 'CTO';
  if (text.includes('buyer') || text.includes('communication') || text.includes('outreach')) return 'CMO';
  return 'CIO';
}

function buildCrossExecutiveAlerts(journeys, dependencyEngine) {
  const firstJourney = journeys[0];
  const blockers = dependencyEngine.blockers.slice(0, 8);
  return [
    {
      id: 'sync-alert-low-margin',
      title: 'Low margin and freight uncertainty impacts shipment viability',
      severity: 'High',
      source_executives: ['CFO', 'COO', 'CIO'],
      impacted_departments: ['Pricing', 'Shipment', 'Strategic Opportunity'],
      workflow_id: firstJourney.id,
      message: 'CFO margin review blocks buyer quote release; COO must confirm operational feasibility; CIO should weigh UAE opportunity value.',
      linked_route: '/export-os/pricing-engine',
      next_action: 'CFO updates freight/margin, COO confirms feasibility, then Founder receives combined recommendation.'
    },
    {
      id: 'sync-alert-supplier-delay',
      title: 'Supplier confirmation delay impacts invoice release and buyer commitment',
      severity: 'Critical',
      source_executives: ['COO', 'CFO', 'CMO'],
      impacted_departments: ['Supplier', 'Invoice', 'Buyer Communication'],
      workflow_id: firstJourney.id,
      message: 'Supplier confirmation and quality review are unresolved; invoice and shipment communication should remain controlled.',
      linked_route: '/export-os/suppliers/supplier-malabar-spice',
      next_action: 'COO creates supplier follow-up, CFO keeps invoice release blocked, CMO prepares buyer update draft only.'
    },
    {
      id: 'sync-alert-api-approval',
      title: 'Automation/approval dependency requires CTO monitoring',
      severity: 'Medium',
      source_executives: ['CTO', 'COO', 'Founder'],
      impacted_departments: ['Automation', 'Director Queue', 'Task Engine'],
      workflow_id: firstJourney.id,
      message: 'Workflow automation is locally connected; CTO should monitor queue readiness before any external execution claim.',
      linked_route: '/export-os/executives/cto',
      next_action: 'CTO confirms integration readiness and COO keeps manual fallback visible.'
    },
    ...blockers.map((blocker) => ({
      id: `sync-alert-${blocker.id}`,
      title: `${blocker.workflow_title}: ${blocker.blocker_type}`,
      severity: severityState(blocker.severity),
      source_executives: [executiveForRisk(blocker.blocker_type), 'COO'],
      impacted_departments: [blocker.workflow_type, blocker.owner],
      workflow_id: blocker.workflow_id,
      message: blocker.business_impact,
      linked_route: blocker.linked_route,
      next_action: blocker.next_action
    }))
  ];
}

function buildSharedDependencies(journeys) {
  return [
    {
      id: 'dep-pricing-invoice-shipment',
      chain: ['Pricing approval pending', 'Invoice release blocked', 'Shipment planning blocked', 'Buyer communication paused'],
      executives: ['CFO', 'Founder', 'COO', 'CMO'],
      status: 'Blocked',
      severity: 'Critical',
      linked_route: '/export-os/workflows/mwf-uae-black-pepper-001',
      next_action: 'Resolve pricing/founder approval before invoice or shipment communication progresses.'
    },
    {
      id: 'dep-supplier-warehouse-shipment',
      chain: ['Supplier confirmation missing', 'Batch reservation delayed', 'Packing readiness uncertain', 'Dispatch readiness blocked'],
      executives: ['COO', 'CFO'],
      status: 'Review Required',
      severity: 'High',
      linked_route: '/export-os/warehouse',
      next_action: 'COO confirms supplier, warehouse reserves batch, CFO keeps commercial release controlled.'
    },
    {
      id: 'dep-market-outreach-pricing',
      chain: ['CIO opportunity detected', 'CMO outreach draft prepared', 'CFO pricing viability pending', 'Founder summary required'],
      executives: ['CIO', 'CMO', 'CFO', 'Founder'],
      status: 'Monitoring',
      severity: 'Medium',
      linked_route: '/export-os/cio',
      next_action: 'Coordinate market opportunity with safe pricing and approved buyer communication.'
    },
    ...journeys.slice(0, 2).map((workflow) => ({
      id: `dep-${workflow.id}`,
      chain: [workflow.current_stage, `${workflow.scores.dependencyCompletion}% dependencies`, `${workflow.scores.approvalCompletion}% approvals`, `${workflow.scores.shipmentReadiness}% shipment readiness`],
      executives: ['COO', 'CFO', 'Founder'],
      status: workflow.risk_level,
      severity: workflow.risk_level,
      linked_route: `/export-os/workflows/${workflow.id}`,
      next_action: 'Open master workflow and resolve the active blocked stage.'
    }))
  ];
}

function buildCoordinationTimeline() {
  return [
    ['CFO review requested', 'CFO', 'High', 'Margin/freight review required before quote release.', '/export-os/pricing-engine'],
    ['COO blocker created', 'COO', 'Critical', 'Supplier confirmation and dispatch dependencies are blocking shipment readiness.', '/export-os/executives/coo'],
    ['CTO incident monitoring triggered', 'CTO', 'Medium', 'Automation and approval workflow health require monitoring.', '/export-os/executives/cto'],
    ['CMO outreach paused', 'CMO', 'Attention', 'Buyer communication remains draft-only until approval gates pass.', '/export-os/executives/cmo'],
    ['CIO opportunity detected', 'CIO', 'Medium', 'UAE black pepper opportunity remains strategically useful if execution risk is controlled.', '/export-os/cio'],
    ['Founder escalation generated', 'Founder', 'Critical', 'Unified decision required on pricing, invoice release, and shipment commitment.', '/export-os/director']
  ].map(([event, executive, severity, note, route], index) => ({
    id: `coord-${index + 1}`,
    event,
    executive,
    severity,
    note,
    linked_route: route,
    created_at: new Date(Date.now() - (6 - index) * 2700000).toISOString()
  }));
}

function buildRiskBoard(journeys, alerts) {
  const base = [
    ['Operational risk', 'Critical', ['COO'], 'Shipment and supplier blockers prevent clean execution.', '/export-os/executives/coo'],
    ['Financial risk', 'High', ['CFO'], 'Low margin and freight uncertainty require CFO control.', '/export-os/executives/cfo'],
    ['Technical risk', 'Medium', ['CTO'], 'Automation readiness should remain monitored; no external execution claim.', '/export-os/executives/cto'],
    ['Supplier risk', 'High', ['COO', 'CFO'], 'Supplier confirmation, quality review, and availability remain pending.', '/export-os/suppliers/supplier-malabar-spice'],
    ['Buyer risk', 'Medium', ['CMO', 'COO'], 'Buyer communication should remain controlled and draft-only.', '/export-os/buyer-crm'],
    ['Logistics risk', 'High', ['COO'], 'CHA coordination and dispatch readiness depend on invoice/document completion.', '/export-os/shipments/SHP-UAE-001'],
    ['Market risk', 'Medium', ['CIO', 'CMO'], 'Opportunity exists, but pricing and execution risk must be reconciled.', '/export-os/cio']
  ];
  return base.map(([risk_type, severity, impacted_departments, summary, linked_route], index) => ({
    id: `risk-${index + 1}`,
    workflow_id: journeys[0]?.id,
    risk_type,
    severity,
    impacted_departments,
    summary,
    linked_route,
    alert_count: alerts.filter((alert) => alert.impacted_departments.some((dept) => impacted_departments.includes(dept))).length
  }));
}

function buildEscalationQueue(journeys) {
  return [
    {
      id: 'founder-escalation-commercial-release',
      title: 'Commercial release decision blocked across CFO/COO/Founder',
      source_executives: ['CFO', 'COO', 'Founder'],
      operational_impact: 'Quote, invoice, shipment planning, and buyer communication cannot progress safely.',
      urgency: 'Critical',
      recommended_founder_action: 'Review low-margin pricing, invoice release blockers, and shipment commitment before buyer-facing release.',
      linked_route: `/export-os/workflows/${journeys[0]?.id || 'mwf-uae-black-pepper-001'}`
    },
    {
      id: 'founder-escalation-supplier-shipment',
      title: 'Supplier delay creates shipment and buyer communication conflict',
      source_executives: ['COO', 'CMO', 'CFO'],
      operational_impact: 'Buyer update should remain draft-only until supplier and packing dependencies are confirmed.',
      urgency: 'High',
      recommended_founder_action: 'Approve escalation path if supplier delay affects buyer commitment.',
      linked_route: '/export-os/suppliers/supplier-malabar-spice'
    },
    {
      id: 'founder-escalation-strategic-margin',
      title: 'Strategic buyer opportunity conflicts with low-margin risk',
      source_executives: ['CIO', 'CMO', 'CFO'],
      operational_impact: 'Market opportunity may justify attention, but CFO margin guardrails and founder approval remain required.',
      urgency: 'High',
      recommended_founder_action: 'Decide whether to pursue strategic buyer with controlled pricing and approved communication.',
      linked_route: '/export-os/cio'
    }
  ];
}

function buildRecommendations(journeys) {
  return [
    ['COO', 'Resolve supplier, packing, document, and dispatch blockers before committing shipment dates.', 'Critical', '/export-os/executives/coo'],
    ['CFO', 'Keep quote and invoice release blocked until freight, margin, and approval thresholds are complete.', 'High', '/export-os/executives/cfo'],
    ['CTO', 'Monitor workflow automation and approval routing health; keep manual fallback visible.', 'Medium', '/export-os/executives/cto'],
    ['CMO', 'Prepare buyer communication as draft only; avoid shipment or pricing promises until approvals pass.', 'Attention', '/export-os/executives/cmo'],
    ['CIO', 'Treat UAE demand as strategic, but only after CFO and COO confirm commercial/operational feasibility.', 'Medium', '/export-os/cio'],
    ['Founder', `Open ${journeys[0]?.buyer || 'priority workflow'} and decide the cross-executive release path.`, 'Critical', `/export-os/workflows/${journeys[0]?.id || 'mwf-uae-black-pepper-001'}`]
  ].map(([executive_type, recommendation, severity, linked_route], index) => ({
    id: `exec-rec-${index + 1}`,
    workflow_id: journeys[0]?.id,
    executive_type,
    recommendation,
    severity,
    linked_route,
    created_at: new Date().toISOString()
  }));
}

function buildBottlenecks() {
  return [
    ['Invoice waiting on operations', 'COO + CFO', 'HSN/origin, shipment link, and supplier confirmation block invoice release.', 'Critical', '/export-os/invoices/new'],
    ['Shipment waiting on finance', 'COO + CFO', 'Pricing approval and founder approval block dispatch planning.', 'High', '/export-os/pricing-engine'],
    ['Buyer communication waiting on approvals', 'CMO + Founder', 'Quote/invoice emails remain draft-only until approval gates pass.', 'High', '/export-os/director'],
    ['Warehouse waiting on supplier confirmation', 'COO', 'Batch reservation and packing material checks require supplier confirmation.', 'High', '/export-os/warehouse'],
    ['CTO incidents blocking operations', 'CTO + COO', 'Automation readiness should be monitored before external execution is claimed.', 'Medium', '/export-os/executives/cto']
  ].map(([title, owner, impact, severity, linked_route], index) => ({ id: `bottleneck-${index + 1}`, title, owner, impact, severity, linked_route }));
}

function buildConflicts() {
  return [
    ['Low margin vs strategic buyer', 'CFO margin guardrails conflict with CIO/CMO opportunity value.', 'Route founder review with CFO margin floor and CIO strategic note.', 'High', '/export-os/director'],
    ['Shipment urgency vs missing documents', 'COO shipment pressure conflicts with invoice/document readiness.', 'Block shipment commitment until document dependencies pass.', 'Critical', '/export-os/workflows/mwf-uae-black-pepper-001'],
    ['Pricing risk vs market opportunity', 'CIO opportunity exists but CFO risk remains unresolved.', 'Create controlled quote draft and require founder approval before release.', 'High', '/export-os/pricing-engine'],
    ['Inventory shortage vs confirmed order', 'Warehouse allocation pressure conflicts with buyer commitment.', 'COO validates stock and supplier fallback before confirmation.', 'High', '/export-os/warehouse']
  ].map(([title, conflict, resolution, severity, linked_route], index) => ({ id: `conflict-${index + 1}`, title, conflict, resolution, severity, linked_route }));
}

function buildOpportunitySync() {
  return [
    ['UAE black pepper importer opportunity', 'CIO', 'CMO outreach draft, CFO margin review, COO feasibility check, warehouse stock check.', 'High Opportunity', '/export-os/cio'],
    ['Oman turmeric HORECA demand', 'CIO + CMO', 'Buyer outreach should wait for pricing viability and supplier availability.', 'Medium Opportunity', '/export-os/importer-intelligence'],
    ['GCC distributor relationship path', 'CMO + CFO + COO', 'Relationship value is useful, but pricing and dispatch discipline remain gating factors.', 'Strategic Expansion Opportunity', '/export-os/buyer-outreach']
  ].map(([title, owner, sync_path, status, linked_route], index) => ({ id: `opportunity-${index + 1}`, title, owner, sync_path, status, linked_route }));
}

function buildMemory() {
  return [
    ['Recurring conflict', 'Low-margin opportunities repeatedly require CFO + Founder review before buyer communication.'],
    ['Repeated bottleneck', 'Invoice release frequently waits on LUT, HSN/origin, and shipment linkage.'],
    ['Approval pattern', 'Founder approval is the common blocker for low-margin quote and invoice release paths.'],
    ['Shipment risk pattern', 'Supplier confirmation delay creates downstream warehouse, document, and buyer communication risk.'],
    ['Operational lesson', 'Buyer-facing communication should remain draft-only until cross-executive blockers are resolved.']
  ].map(([memory_type, content], index) => ({ id: `exec-memory-${index + 1}`, memory_type, content, status: 'Memory' }));
}

function buildWarRoomSummary(journeys, alerts, risks, escalations) {
  const readiness = Math.round(journeys.reduce((sum, workflow) => sum + workflow.scores.workflowCompletion + workflow.scores.dependencyCompletion + workflow.scores.approvalCompletion + workflow.scores.shipmentReadiness + workflow.scores.documentationReadiness, 0) / (journeys.length * 5));
  return {
    activeWorkflows: journeys.length,
    criticalAlerts: alerts.filter((alert) => alert.severity === 'Critical').length,
    highRisks: risks.filter((risk) => ['Critical', 'High'].includes(risk.severity)).length,
    founderEscalations: escalations.length,
    operationalReadiness: readiness,
    status: readiness < 55 ? 'High Risk' : readiness < 70 ? 'Attention' : 'Monitoring',
    founderSummary: 'Resolve cross-executive blockers in this order: pricing/invoice approval, supplier confirmation, shipment readiness, buyer communication release.'
  };
}

export async function getExecutiveSyncDashboard() {
  await wait();
  const [journeyResponse, dependencyResponse, agentMemoryResult, agentActivityResult] = await Promise.all([
    getWorkflowJourneyDashboard(),
    getWorkflowDependencyEngineData(),
    getAllAgentMemorySummary(),
    getAgentActivityFeed()
  ]);
  const journeys = journeyResponse.data.workflows;
  const dependencyEngine = dependencyResponse.data;
  const crossExecutiveAlerts = buildCrossExecutiveAlerts(journeys, dependencyEngine);
  const sharedDependencies = buildSharedDependencies(journeys);
  const coordinationTimeline = buildCoordinationTimeline();
  const riskBoard = buildRiskBoard(journeys, crossExecutiveAlerts);
  const founderEscalations = buildEscalationQueue(journeys);
  const recommendations = buildRecommendations(journeys);
  const bottlenecks = buildBottlenecks();
  const conflicts = buildConflicts();
  const opportunities = buildOpportunitySync();
  const staticMemory = buildMemory();

  // Merge static memory with live OpenAI-stored agent knowledge
  const liveMemoryRows = Object.entries(agentMemoryResult.data || {}).flatMap(([role, rows]) =>
    rows.slice(0, 3).map((row) => ({
      id: `live-memory-${role}-${row.topic_cluster}`,
      memory_type: `${role} knowledge`,
      content: row.knowledge_value?.slice(0, 200) || '',
      status: 'Memory',
      confidence: row.confidence_score,
      updated_at: row.updated_at
    }))
  );
  const memory = [...liveMemoryRows, ...staticMemory];

  const warRoom = buildWarRoomSummary(journeys, crossExecutiveAlerts, riskBoard, founderEscalations);

  // Persist the current sync state as agent memory so all agents can query it
  await writeAgentMemory('COO', 'sync-dashboard', `OperationalReadiness:${warRoom.operationalReadiness}% Status:${warRoom.status} Bottlenecks:${bottlenecks.length} Conflicts:${conflicts.length}`, { confidence: 0.7 }).catch(() => null);

  return {
    ok: true,
    backend: backendStatus,
    data: {
      warRoom,
      crossExecutiveAlerts,
      sharedDependencies,
      coordinationTimeline,
      riskBoard,
      founderEscalations,
      recommendations,
      bottlenecks,
      conflicts,
      opportunities,
      memory,
      journeys,
      agentMessages: agentActivityResult.data?.messages?.slice(0, 10) || [],
      agentPendingByRole: agentActivityResult.data?.pendingByRole || {}
    },
    error: null
  };
}

export async function generateFounderWarRoomSummary() {
  const dashboard = await getExecutiveSyncDashboard();
  const data = dashboard.data;
  return {
    ok: true,
    backend: backendStatus,
    data: {
      title: 'Founder War Room Summary',
      status: data.warRoom.status,
      sections: [
        ['Critical workflows', data.founderEscalations.map((item) => item.title).join(' / ')],
        ['Live blockers', data.bottlenecks.slice(0, 3).map((item) => item.title).join(' / ')],
        ['Executive conflicts', data.conflicts.slice(0, 3).map((item) => item.title).join(' / ')],
        ['Major opportunities', data.opportunities.slice(0, 2).map((item) => item.title).join(' / ')],
        ['Strategic risks', data.riskBoard.filter((risk) => ['Critical', 'High'].includes(risk.severity)).map((risk) => risk.risk_type).join(' / ')],
        ['Operational readiness', `${data.warRoom.operationalReadiness}% - ${data.warRoom.founderSummary}`]
      ],
      created_at: new Date().toISOString()
    },
    error: null
  };
}

export async function escalateExecutiveConflict(conflict, tenantId = demoTenantId) {
  await wait();
  if (!generatedSyncEvents.has(conflict.id)) {
    generatedSyncEvents.add(conflict.id);
    await createTaskFromWorkflow({
      tenant_id: tenantId,
      title: `Resolve executive conflict: ${conflict.title}`,
      description: conflict.conflict || conflict.impact || conflict.message,
      workflow_source: 'Executive Synchronization',
      linked_record_id: conflict.workflow_id || conflict.id,
      linked_label: conflict.title,
      linked_route: conflict.linked_route || '/export-os/executive-sync',
      department: 'Founder + Executives',
      owner_command: 'Founder',
      assigned_role: 'Founder',
      priority: conflict.severity === 'Critical' ? 'Critical' : 'High',
      status: 'Escalated',
      due_date: 'Today',
      escalation_level: 'Founder War Room',
      blocking_reason: conflict.conflict || conflict.message || conflict.title,
      next_action: conflict.resolution || conflict.next_action || conflict.recommended_founder_action
    });
  }
  return {
    ok: true,
    backend: backendStatus,
    data: {
      ...conflict,
      status: 'Escalated',
      escalation_note: `${conflict.title} escalated to Founder War Room.`,
      updated_at: new Date().toISOString()
    },
    error: null
  };
}
