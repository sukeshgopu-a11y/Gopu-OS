import { backendStatus } from '../lib/supabaseClient.js';
import { getApprovalQueue } from './approvalService.js';
import { getAllAgentMemorySummary } from './agentMemoryService.js';
import { getAgentActivityFeed } from './agentWorkflowService.js';

export const directorBranches = [
  {
    id: 'cto',
    name: 'CTO',
    command: 'CTO Command',
    route: '/export-os/executives/cto',
    responsibility: 'Systems, integrations, automations, deployment readiness, and reliability.',
    status: 'Operational'
  },
  {
    id: 'cio',
    name: 'CIO',
    command: 'CIO Command',
    route: '/export-os/executives/cio',
    responsibility: 'Importer intelligence, buyer discovery, trade signals, and opportunity scoring.',
    status: 'Operational'
  },
  {
    id: 'cmo',
    name: 'CMO',
    command: 'CMO Command',
    route: '/export-os/executives/cmo',
    responsibility: 'Content, brand approval, buyer outreach, campaigns, and growth workflows.',
    status: 'Operational'
  },
  {
    id: 'cfo',
    name: 'CFO',
    command: 'CFO Command',
    route: '/export-os/executives/cfo',
    responsibility: 'Pricing, margins, payments, renewals, cash control, and commercial risk.',
    status: 'Review Active'
  },
  {
    id: 'coo',
    name: 'COO',
    command: 'COO Command',
    route: '/export-os/executives/coo',
    responsibility: 'Operations, shipments, documents, suppliers, tasks, and execution discipline.',
    status: 'Operational'
  }
];

const directorQueueFallback = [];

const whatsappActions = [];

const globalOpportunities = [];

const worldwideTradeEvents = [];

const executiveEventStream = [];

const workflowDelayIntelligence = [];

const executivePerformanceInsights = [];

const operationalHeatmap = [];

const warRoomItems = [];

const aiRecommendations = [];

export async function getDirectorCommandData(tenantId) {
  const [approvals, agentMemory, agentActivity] = await Promise.all([
    getApprovalQueue(tenantId),
    getAllAgentMemorySummary(),
    getAgentActivityFeed(tenantId)
  ]);

  const approvalQueue = approvals.data || [];
  const liveMode = (approvals.backend || backendStatus).mode === 'Connected';
  const allQueue = liveMode ? approvalQueue : [...approvalQueue, ...directorQueueFallback];
  const liveSupport = liveMode ? [] : null;

  return {
    ok: true,
    backend: approvals.backend || backendStatus,
    data: {
      branches: directorBranches,
      queue: allQueue,
      summary: {
        branches: directorBranches.length,
        pendingDecisions: allQueue.filter((item) => !['Approved', 'Rejected'].includes(item.status)).length,
        critical: allQueue.filter((item) => item.priority === 'Critical' || item.risk_level === 'Critical').length,
        escalated: allQueue.filter((item) => item.status === 'Escalated').length,
        agentMessagesPending: agentActivity.data?.totalPending || 0,
        lastAgentActivity: agentActivity.data?.lastActivity || null
      },
      agentMemory: agentMemory.data || {},
      agentActivityFeed: agentActivity.data?.messages || [],
      agentPendingByRole: agentActivity.data?.pendingByRole || {},
      whatsappActions: liveSupport || whatsappActions,
      globalOpportunities: liveSupport || globalOpportunities,
      worldwideTradeEvents: liveSupport || worldwideTradeEvents,
      executiveEventStream: liveSupport || executiveEventStream,
      workflowDelayIntelligence: liveSupport || workflowDelayIntelligence,
      executivePerformanceInsights: liveSupport || executivePerformanceInsights,
      operationalHeatmap: liveSupport || operationalHeatmap,
      warRoomItems: liveSupport || warRoomItems,
      aiRecommendations: liveSupport || aiRecommendations
    },
    error: null
  };
}
