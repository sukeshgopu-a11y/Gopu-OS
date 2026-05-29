import { backendStatus } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';
import { getApprovalQueue } from './approvalService.js';
import { createTaskFromWorkflow, getCOOTaskSummary, getTasks } from './taskService.js';

const statusFromPriority = (priority = '') => priority === 'Critical' ? 'Blocked' : priority === 'High' ? 'Attention' : 'Monitoring';

function dueSortValue(task) {
  if (task.due_date === 'Overdue') return 0;
  if (task.due_date === 'Today') return 1;
  if (task.due_date === 'Tomorrow') return 2;
  return 3;
}

function workflowFromTask(task) {
  return {
    id: task.linked_record_id || task.id,
    sourceModule: task.workflow_source,
    buyerSupplier: task.buyer || task.linked_label || 'Workflow',
    product: task.product || 'Operational workflow',
    currentStage: task.status,
    owner: task.owner_command,
    priority: task.priority,
    dueDate: task.due_date,
    status: task.status,
    nextAction: task.next_action,
    linkedRoute: task.linked_route || '/export-os/tasks'
  };
}

function blockerFromTask(task) {
  const reason = task.blocking_reason || task.next_action || task.title;
  return {
    id: task.id,
    title: task.title,
    reason,
    businessImpact: task.workflow_source === 'Invoice System'
      ? 'Final PDF, buyer email, and release remain blocked.'
      : task.workflow_source === 'Pricing Engine'
        ? 'Buyer quote cannot move forward until CFO/founder path is clear.'
        : task.workflow_source === 'Document Factory'
          ? 'Buyer document package stays draft-only.'
          : 'Operational workflow cannot progress safely.',
    owner: task.owner_command,
    escalationTarget: task.escalation_level,
    linkedRoute: task.linked_route || '/export-os/tasks',
    priority: task.priority,
    status: task.status
  };
}

function readinessRows(tasks) {
  return tasks
    .filter((task) => ['Invoice System', 'Document Factory', 'Documents'].includes(task.workflow_source))
    .map((task) => ({
      id: `readiness-${task.id}`,
      title: task.title,
      readiness: task.status === 'Done' ? 100 : task.status === 'Blocked' ? 0 : 50,
      missingFields: task.blocking_reason || task.next_action || 'Review required',
      owner: task.owner_command,
      approvalState: task.status,
      linkedRoute: task.linked_route || '/export-os/tasks',
      relatedTasks: 1
    }));
}

function supplierShipmentRows(tasks) {
  return tasks
    .filter((task) => `${task.title} ${task.workflow_source}`.toLowerCase().match(/supplier|shipment|warehouse|dispatch|packing/))
    .map((task) => ({
      id: `supplier-shipment-${task.id}`,
      title: task.title,
      party: task.buyer || task.linked_label || 'Workflow',
      product: task.product || 'Operational workflow',
      deadline: task.due_date,
      owner: task.owner_command,
      priority: task.priority,
      status: task.status || statusFromPriority(task.priority),
      nextAction: task.next_action,
      linkedRoute: task.linked_route || '/export-os/tasks'
    }));
}

function sopIssues(tasks) {
  const text = tasks.map((task) => `${task.title} ${task.blocking_reason} ${task.next_action}`).join(' ').toLowerCase();
  return [
    ['Missing LUT data', text.includes('lut') ? 3 : 1, 'Create monthly LUT readiness check before invoice drafting.'],
    ['Missing destination port', text.includes('port') ? 2 : 1, 'Add destination port as required intake field before pricing.'],
    ['HSN review delay', text.includes('hsn') ? 3 : 1, 'Create HSN/origin pre-check before document package creation.'],
    ['Supplier confirmation delay', text.includes('supplier') ? 2 : 1, 'Add same-day supplier follow-up rule for shipment dependencies.'],
    ['Pricing input gaps', text.includes('pricing') || text.includes('cost') ? 2 : 1, 'Require CFO missing-cost task before quote approval routing.']
  ].map(([issue, count, recommendation], index) => ({ id: `sop-${index}`, issue, count, recommendation, status: count >= 3 ? 'Review Required' : 'Monitoring' }));
}

export async function getCOOSummary(tenantId = demoTenantId) {
  const taskSummary = await getCOOTaskSummary(tenantId);
  const tasks = taskSummary.data?.tasks || [];
  const approvals = await getApprovalQueue(tenantId);
  const approvalWaiting = approvals.data?.filter((item) => ['Founder Review Required', 'Attention Required', 'Review Pending'].includes(item.status)).length || taskSummary.data?.founderWaiting || 0;
  return {
    ok: true,
    backend: backendStatus,
    data: {
      activeLeads: 0,
      openTasks: taskSummary.data?.open || 0,
      dueToday: taskSummary.data?.dueToday || 0,
      blockedWorkflows: taskSummary.data?.blocked || 0,
      pendingInvoices: tasks.filter((task) => task.workflow_source === 'Invoice System').length,
      documentReviews: tasks.filter((task) => ['Document Factory', 'Documents'].includes(task.workflow_source)).length,
      supplierFollowups: taskSummary.data?.supplierFollowups || 0,
      founderApprovalsWaiting: approvalWaiting,
      highRisk: tasks.filter((task) => ['Critical', 'High'].includes(task.priority)).length,
      activeWorkflows: tasks.length
    }
  };
}

export async function getOperationsControlBoard(tenantId = demoTenantId) {
  const result = await getTasks(tenantId);
  const taskRows = result.data.map(workflowFromTask);
  return { ok: true, backend: result.backend, data: taskRows.sort((a, b) => dueSortValue({ due_date: a.dueDate }) - dueSortValue({ due_date: b.dueDate })) };
}

export async function getBlockedWorkflows(tenantId = demoTenantId) {
  const result = await getTasks(tenantId);
  const blockers = result.data.filter((task) => ['Blocked', 'Escalated', 'Waiting Founder Approval', 'Revision Required'].includes(task.status) || task.blocking_reason).map(blockerFromTask);
  return { ok: true, backend: result.backend, data: blockers };
}

export async function getTodayPriorities(tenantId = demoTenantId) {
  const result = await getTasks(tenantId);
  return { ok: true, backend: result.backend, data: result.data.filter((task) => task.due_date === 'Today' || task.due_date === 'Overdue').sort((a, b) => dueSortValue(a) - dueSortValue(b)).slice(0, 8) };
}

export async function getApprovalDependencies(tenantId = demoTenantId) {
  const approvals = await getApprovalQueue(tenantId);
  return { ok: true, backend: approvals.backend, data: (approvals.data || []).filter((item) => ['Founder Review Required', 'Attention Required', 'Review Pending', 'Escalated'].includes(item.status)).map((item) => ({ ...item, linkedRoute: '/export-os/director' })) };
}

export async function getInvoiceDocumentReadiness(tenantId = demoTenantId) {
  const result = await getTasks(tenantId);
  return { ok: true, backend: result.backend, data: readinessRows(result.data) };
}

export async function getSupplierShipmentFollowups(tenantId = demoTenantId) {
  const result = await getTasks(tenantId);
  return { ok: true, backend: result.backend, data: supplierShipmentRows(result.data) };
}

export async function generateCOODailyPlan(tenantId = demoTenantId) {
  const [priorities, blockers, approvals] = await Promise.all([
    getTodayPriorities(tenantId),
    getBlockedWorkflows(tenantId),
    getApprovalDependencies(tenantId)
  ]);
  return {
    ok: true,
    backend: backendStatus,
    data: [
      `1. Clear top priority: ${priorities.data[0]?.title || 'Review active workflow queue'}`,
      `2. Blocked workflows: ${blockers.data.length} require owner follow-up.`,
      `3. Founder approvals waiting: ${approvals.data.length}.`,
      '4. Confirm supplier packing and warehouse allocation before shipment commitments.',
      '5. Keep invoice/document release blocked until validation and approval gates pass.'
    ].join('\n')
  };
}

export async function generateFounderOperationsSummary(tenantId = demoTenantId) {
  const [summary, blockers, approvals] = await Promise.all([
    getCOOSummary(tenantId),
    getBlockedWorkflows(tenantId),
    getApprovalDependencies(tenantId)
  ]);
  return {
    ok: true,
    backend: backendStatus,
    data: [
      `1. Operations Status: ${summary.data.activeWorkflows} active workflow signals, ${summary.data.openTasks} open tasks.`,
      `2. Blocked Workflows: ${blockers.data.length} blockers require owner action.`,
      '3. Critical Actions: complete LUT/HSN/origin checks before invoice or document release.',
      '4. Owner Assignments: COO coordinates operations, CFO handles commercial review, Founder owns final approval.',
      `5. Founder Approvals Needed: ${approvals.data.length} approval dependencies are waiting.`,
      '6. COO Recommendations: clear release blockers first, then supplier/shipment confirmations, then SOP improvements.'
    ].join('\n')
  };
}

export async function createCOOFollowupTask(payload = {}) {
  return createTaskFromWorkflow({
    tenant_id: payload.tenant_id || demoTenantId,
    title: payload.title || 'COO operational follow-up',
    description: payload.description || 'COO created follow-up task from operations control room.',
    workflow_source: 'COO Command',
    linked_record_id: payload.linked_record_id || 'COO-FOLLOWUP',
    linked_label: payload.linked_label || 'Operations follow-up',
    linked_route: payload.linked_route || payload.linkedRoute || '/export-os/executives/coo',
    department: 'Operations',
    owner_command: 'COO Command',
    assigned_role: 'COO',
    priority: payload.priority || 'Medium',
    status: 'New',
    due_date: payload.due_date || 'Today',
    blocking_reason: payload.blocking_reason || 'Operational confirmation pending.',
    next_action: payload.next_action || 'Assign owner, confirm dependency, and update Task Engine.',
    buyer: payload.buyer || 'Operational workflow',
    product: payload.product || 'Follow-up'
  });
}

export function getSOPImprovementWatch(tasks = []) {
  return sopIssues(tasks);
}

export function getCOOKnowledgeBase() {
  return {
    role: 'Chief Operations Officer',
    mandate: 'Zero-error export operations. Every shipment on time, every document correct, every supplier confirmed.',
    dailyChecklist: [
      'Check all active supplier confirmations (min 5 days before delivery)',
      'Review document readiness: invoice, packing list, COO, phytosanitary, B/L draft',
      'Track all active consignments and update buyer with tracking numbers',
      'Confirm warehouse allocation and batch quality holds',
      'Review blocked workflows and escalate to Founder if unresolved >24h',
      'Coordinate with freight forwarder on upcoming shipments',
    ],
    documentsManaged: [
      'Commercial Invoice', 'Packing List', 'Certificate of Origin',
      'Phytosanitary Certificate', 'Bill of Lading (B/L)', 'ARE-1',
      'Letter of Credit (L/C) documents', 'Insurance Certificate',
      'Bank Realisation Certificate (BRC)', 'Shipping Bill'
    ],
    approvalAuthority: {
      canApproveAutonomously: ['Supplier selection', 'Freight booking', 'Warehouse allocation', 'Document preparation'],
      needsFounderApproval: ['New supplier onboarding >Rs.50,000 order', 'Shipment commitment to new buyer', 'Document discrepancy resolution'],
    },
    kpis: ['On-time delivery rate', 'Document readiness %', 'Supplier confirmation rate', 'Blocked workflows count', 'Days to shipment'],
  };
}
