import { backendStatus, checkSupabaseConnection } from '../lib/supabaseClient.js';
import { demoTenantId } from './demoData.js';
import { sendSlackNotification } from './slackNotificationService.js';
import { createTaskFromWorkflow } from './taskService.js';
import { getIntegrations } from './integrationService.js';
import { automationQueueService, platformHealthService, technicalIncidentService } from './monitoringService.js';

const platformHealthFallback = [];

const apiHealthFallback = [];

const automationQueueFallback = [];

const incidentFallback = [];

const subscriptionWatchFallback = [];

const deploymentStatusFallback = [];

const architectureMapFallback = [];

const technicalAuditFallback = [];

const cmoMediaStackFallback = [];

const cmoSocialIntegrationFallback = [];

const cmoPublishingWorkflowFallback = [];

function liveRows(result, fallback = []) {
  return result.backend?.mode === 'Connected' ? (result.data || []) : [];
}

function staticRows(fallback = []) {
  return [];
}

export async function getPlatformHealth(tenantId = demoTenantId) {
  const result = await platformHealthService.list({ tenant_id: tenantId });
  return { ok: true, backend: result.backend || backendStatus, data: liveRows(result, platformHealthFallback) };
}

export async function getApiHealth() {
  const supabaseConnection = await checkSupabaseConnection();
  const rows = [{
    id: 'api-health-supabase',
    service: 'Supabase',
    status: supabaseConnection.status,
    latency: supabaseConnection.live ? 'Verified' : 'N/A',
    failures: supabaseConnection.live ? 0 : 1,
    last_success: supabaseConnection.live ? supabaseConnection.lastChecked : 'Not connected',
    recommended_action: supabaseConnection.live ? 'Supabase is live. Keep RLS and tenant filters active.' : supabaseConnection.message
  }];
  return { ok: true, backend: backendStatus, data: rows };
}

export async function getAutomationQueue(tenantId = demoTenantId) {
  const result = await automationQueueService.list({ tenant_id: tenantId });
  return { ok: true, backend: result.backend || backendStatus, data: liveRows(result, automationQueueFallback) };
}

export async function getIncidents(tenantId = demoTenantId) {
  const result = await technicalIncidentService.list({ tenant_id: tenantId });
  return { ok: true, backend: result.backend || backendStatus, data: liveRows(result, incidentFallback) };
}

export async function createIncident(payload = {}) {
  return { ok: true, backend: backendStatus, data: { id: `incident-created-${Date.now()}`, status: 'Attention', ...payload, created_at: new Date().toISOString() } };
}

export async function createPaymentRequirement(payload = {}) {
  const result = await createTaskFromWorkflow({
    tenant_id: payload.tenant_id || demoTenantId,
    title: payload.title || 'Create payment requirement for infrastructure renewal',
    description: 'CTO detected technical renewal/credit need. CTO does not execute payment.',
    workflow_source: 'CTO Command',
    linked_record_id: payload.linked_record_id || 'PAYMENT-REQ-TECH',
    linked_label: payload.vendor || 'Infrastructure vendor',
    linked_route: '/export-os/payment-vault',
    department: 'Technical / Finance',
    owner_command: 'CTO Command',
    assigned_role: 'CTO',
    priority: payload.priority || 'High',
    status: 'Waiting Review',
    due_date: 'Today',
    blocking_reason: payload.reason || 'Credit/renewal risk detected.',
    next_action: 'COO confirms operational need, CFO validates and executes, Founder approves/owns OTP if required.',
    buyer: payload.vendor || 'Infrastructure vendor',
    product: payload.category || 'Trusted infrastructure'
  });
  await sendSlackNotification({
    type: payload.expired ? 'Renewal Expired' : 'Renewal Expiring Soon',
    priority: payload.priority === 'Critical' || payload.expired ? 'URGENT' : 'WARNING',
    reference: result.data?.id || payload.linked_record_id || 'PAYMENT-REQ-TECH',
    buyer: payload.vendor || 'Infrastructure vendor',
    status: result.data?.status || 'Waiting Review',
    eta: payload.due_date || 'Today',
    actionRequired: payload.reason || 'CFO validates renewal need and executes through tokenized Payment Vault if approved.',
    source: 'CTO Command'
  });
  return result;
}

export async function getSubscriptionWatch() {
  return { ok: true, backend: backendStatus, data: staticRows(subscriptionWatchFallback) };
}

export async function getDeploymentStatus() {
  return { ok: true, backend: backendStatus, data: staticRows(deploymentStatusFallback) };
}

export async function getArchitectureMap() {
  return { ok: true, backend: backendStatus, data: staticRows(architectureMapFallback) };
}

export async function getTechnicalAuditLog() {
  return { ok: true, backend: backendStatus, data: staticRows(technicalAuditFallback) };
}

export async function getCMOMediaStack() {
  return { ok: true, backend: backendStatus, data: staticRows(cmoMediaStackFallback) };
}

export async function getCMOSocialIntegrations() {
  return { ok: true, backend: backendStatus, data: staticRows(cmoSocialIntegrationFallback) };
}

export async function getCMOPublishingWorkflow() {
  return { ok: true, backend: backendStatus, data: staticRows(cmoPublishingWorkflowFallback) };
}

export async function getCTODashboard(tenantId = demoTenantId) {
  const [health, integrations, apiHealth, automationQueue, incidents, subscriptionWatch, deploymentStatus, architectureMap, auditLog, cmoMediaStack, cmoSocialIntegrations, cmoPublishingWorkflow, supabaseConnection, liveIntegrations] = await Promise.all([
    getPlatformHealth(tenantId),
    getIntegrations(tenantId),
    getApiHealth(),
    getAutomationQueue(tenantId),
    getIncidents(tenantId),
    getSubscriptionWatch(),
    getDeploymentStatus(),
    getArchitectureMap(),
    getTechnicalAuditLog(),
    getCMOMediaStack(),
    getCMOSocialIntegrations(),
    getCMOPublishingWorkflow(),
    checkSupabaseConnection(),
    getLiveIntegrationStatus(tenantId)
  ]);
  return {
    ok: true,
    backend: backendStatus,
    data: {
      health: health.data,
      integrations: backendStatus.mode === 'Connected' ? (integrations.data || []) : (integrations.data || []),
      apiHealth: apiHealth.data,
      automationQueue: automationQueue.data,
      incidents: incidents.data,
      subscriptionWatch: subscriptionWatch.data,
      deploymentStatus: deploymentStatus.data,
      architectureMap: architectureMap.data,
      auditLog: auditLog.data,
      cmoMediaStack: cmoMediaStack.data,
      cmoSocialIntegrations: cmoSocialIntegrations.data,
      cmoPublishingWorkflow: cmoPublishingWorkflow.data,
      supabaseConnection,
      liveIntegrations,
      summary: {
        activeIncidents: incidents.data.filter((item) => ['High', 'Critical'].includes(item.severity)).length,
        failedWorkflows: automationQueue.data.filter((item) => ['Failed', 'Retry Pending', 'Attention'].includes(item.queue_status || item.status)).length,
        creditRisks: subscriptionWatch.data.filter((item) => item.usage >= 70).length,
        cmoIntegrationReadiness: cmoMediaStack.data.filter((item) => ['Setup Required', 'Not Connected'].includes(item.status)).length,
        liveIntegrationScore: liveIntegrations.length ? Math.round((liveIntegrations.filter((s) => s.status === 'live').length / liveIntegrations.length) * 100) : 0
      }
    }
  };
}

// ─── Live Integration Status ──────────────────────────────────────────────

function envPresent(...names) {
  for (const name of names) {
    const val =
      (typeof process !== 'undefined' && process.env?.[name]) ||
      (typeof import.meta !== 'undefined' && import.meta.env?.[name]);
    if (!val) return false;
  }
  return true;
}

async function checkSupabaseHealth() {
  try {
    const result = await checkSupabaseConnection();
    return {
      service: 'Supabase',
      status: result.live ? 'live' : 'error',
      message: result.message || (result.live ? 'Connected' : 'Not connected'),
      last_checked: new Date().toISOString(),
    };
  } catch (e) {
    return { service: 'Supabase', status: 'error', message: e?.message || 'Check failed', last_checked: new Date().toISOString() };
  }
}

function checkOpenAIHealth() {
  const present = envPresent('OPENAI_API_KEY') || envPresent('VITE_OPENAI_API_KEY');
  return Promise.resolve({
    service: 'OpenAI',
    status: present ? 'live' : 'unconfigured',
    message: present ? 'API key configured' : 'OPENAI_API_KEY not set',
    last_checked: new Date().toISOString(),
  });
}

function checkSlackHealth() {
  const present = envPresent('SLACK_BOT_TOKEN') && envPresent('SLACK_CHANNEL_ID') && envPresent('SLACK_SIGNING_SECRET');
  return Promise.resolve({
    service: 'Slack',
    status: present ? 'live' : 'unconfigured',
    message: present ? 'Bot token, channel and signing secret configured' : 'Missing SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, or SLACK_SIGNING_SECRET',
    last_checked: new Date().toISOString(),
  });
}

function checkResendHealth() {
  const present = envPresent('RESEND_API_KEY');
  return Promise.resolve({
    service: 'Resend',
    status: present ? 'live' : 'unconfigured',
    message: present ? 'API key configured' : 'RESEND_API_KEY not set',
    last_checked: new Date().toISOString(),
  });
}

function checkVercelHealth() {
  const present = envPresent('VERCEL') || envPresent('VERCEL_URL');
  return Promise.resolve({
    service: 'Vercel',
    status: present ? 'live' : 'unconfigured',
    message: present ? 'Running on Vercel' : 'VERCEL or VERCEL_URL env not set',
    last_checked: new Date().toISOString(),
  });
}

function checkTwilioHealth() {
  const present = envPresent('TWILIO_ACCOUNT_SID') && envPresent('TWILIO_AUTH_TOKEN');
  return Promise.resolve({
    service: 'Twilio',
    status: present ? 'live' : 'unconfigured',
    message: present ? 'Account SID and auth token configured' : 'Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN',
    last_checked: new Date().toISOString(),
  });
}

export async function getLiveIntegrationStatus(tenantId = demoTenantId) {
  const results = await Promise.allSettled([
    checkSupabaseHealth(),
    checkOpenAIHealth(),
    checkSlackHealth(),
    checkResendHealth(),
    checkVercelHealth(),
    checkTwilioHealth(),
  ]);

  return results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    return { service: 'Unknown', status: 'error', message: r.reason?.message || 'Check threw', last_checked: new Date().toISOString() };
  });
}

export async function getSystemHealthSummary(tenantId = demoTenantId) {
  const services = await getLiveIntegrationStatus(tenantId);
  const total = services.length;
  const live = services.filter((s) => s.status === 'live').length;
  const score = total ? Math.round((live / total) * 100) : 0;
  const alerts = services.filter((s) => s.status === 'error');

  let overall;
  if (score >= 90) overall = 'healthy';
  else if (score >= 50) overall = 'degraded';
  else overall = 'critical';

  return {
    ok: true,
    data: {
      overall,
      score,
      services,
      alerts,
      lastChecked: new Date().toISOString(),
    },
    backend: backendStatus,
  };
}

export async function generateFounderTechnicalSummary(tenantId = demoTenantId) {
  const dashboard = await getCTODashboard(tenantId);
  const { summary } = dashboard.data;
  return {
    ok: true,
    backend: backendStatus,
    data: [
      '1. Platform status: Core app routes are monitoring; backend fallback remains active if env vars are missing.',
      `2. Active incidents: ${summary.activeIncidents} high/critical technical items require CTO review.`,
      `3. Failed workflows: ${summary.failedWorkflows} workflow or retry queues need controlled action.`,
      `4. Credit/subscription risks: ${summary.creditRisks} services are above attention thresholds.`,
      `5. CMO media stack readiness: ${summary.cmoIntegrationReadiness} media/design/scheduling items still need setup before live publishing.`,
      '6. Payment renewal requirements: CTO may create requirements only; COO validates need, CFO pays, Founder owns OTP/approval.',
      '7. CTO recommendations: connect provider records before claiming external publishing or analytics.',
      '8. Escalations needed: founder attention if credits, deployment, public workflow reliability, or AI/avatar use affects buyer-facing operations.'
    ].join('\n')
  };
}

export function getCTOKnowledgeBase() {
  return {
    role: 'Chief Technology Officer',
    mandate: 'The OS never sleeps. Every buyer email lands. Every integration stays green.',
    integrations: [
      { name: 'Supabase', role: 'Primary database', critical: true, envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] },
      { name: 'OpenAI', role: 'Agent memory + embeddings', critical: true, envVars: ['OPENAI_API_KEY'] },
      { name: 'Slack', role: 'Founder notifications + approvals + OTP', critical: true, envVars: ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_SIGNING_SECRET'] },
      { name: 'Resend', role: 'Transactional email to buyers', critical: true, envVars: ['RESEND_API_KEY'] },
      { name: 'Twilio', role: 'WhatsApp command interface', critical: false, envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
      { name: 'Vercel', role: 'Hosting + serverless functions', critical: true, envVars: ['VERCEL_URL'] },
    ],
    monitoringRules: [
      'If OpenAI credits < 20% → notify CFO to top up, send Slack alert',
      'If Resend quota > 80% used → raise payment requirement to CFO',
      'If Supabase connection fails → alert Director immediately',
      'If any buyer email bounces → alert CMO + COO',
      'If automation queue has >3 failed jobs → create incident',
    ],
    securityRules: [
      'No API keys in code — env vars only',
      'OTP values never stored in DB or logs',
      'All Slack webhooks verified with signing secret',
      'Supabase RLS enabled on all buyer-facing tables',
    ],
    kpis: ['System uptime %', 'API health score', 'Live integrations / total', 'Mean time to resolve incident', 'Email delivery rate'],
  };
}
