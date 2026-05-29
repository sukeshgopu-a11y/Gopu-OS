import { backendStatus, requireSupabase } from '../lib/supabaseClient.js';
import { DateTime } from 'luxon';
import {
  CMO_PLATFORM_DEFAULT_SLOTS,
  DEFAULT_CMO_TIMEZONE,
  getCmoDateRangeUtc,
  getCmoNowUtc,
  getCmoTimezoneOption,
  getSelectedCmoTimezone
} from '../lib/cmoTimezone.js';
import { createAuditLog } from './auditService.js';
import { getIntegrations } from './integrationService.js';
import { demoTenantId } from './demoData.js';

const serviceResponse = (data) => ({ ok: true, data, error: null, backend: backendStatus });
const serviceErrorResponse = (data, error) => ({ ok: false, data, error: error?.message || String(error), backend: backendStatus });
const CMO_MAX_PUBLISH_ATTEMPTS = 3;
const isLocalDevRuntime = () => Boolean(import.meta.env?.DEV) || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
const connectedIntegrationStates = new Set(['connected', 'healthy', 'active', 'verified', 'verification success']);
const platformProviderMap = {
  LinkedIn: 'linkedin',
  Facebook: 'facebook',
  Instagram: 'instagram',
  YouTube: 'youtube',
  X: 'x',
  Blog: 'blog',
  Email: 'resend'
};

function normalizePublishPlatform(platform = '') {
  const value = String(platform || '').trim().toLowerCase();
  if (value === 'x/twitter' || value === 'twitter') return 'X';
  if (value === 'linkedin' || value === 'linked in') return 'LinkedIn';
  if (value === 'facebook' || value === 'meta facebook') return 'Facebook';
  if (value === 'instagram' || value === 'meta instagram') return 'Instagram';
  if (value === 'youtube' || value === 'you tube') return 'YouTube';
  if (value === 'blog') return 'Blog';
  if (value === 'email') return 'Email';
  return platform || '';
}

function normalizeProviderKey(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized === 'x-twitter' || normalized === 'twitter') return 'x';
  if (normalized === 'linked-in') return 'linkedin';
  return normalized;
}

function isProviderConnected(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  const health = String(row.health_status || '').trim().toLowerCase();
  return connectedIntegrationStates.has(status) || connectedIntegrationStates.has(health);
}

function isFounderApprovalApproved(value) {
  return ['approved', 'founder approved', 'confirmed'].includes(String(value || '').trim().toLowerCase());
}

async function writePublishAudit({ tenantId, actionType, platform, runId, status, message, metadata = {}, riskLevel = 'High' }) {
  return createAuditLog({
    tenant_id: tenantId,
    action_type: actionType,
    module: 'CMO Publishing',
    related_table: 'content_history',
    related_record_id: metadata.content_history_id || null,
    actor: 'CMO Publishing Guard',
    description: message,
    risk_level: riskLevel,
    metadata: {
      platform,
      run_id: runId || null,
      publish_status: status,
      ...metadata
    }
  });
}

const cmoSummary = {
  todayRunbook: 'No live run scheduled',
  dailyReachGrowth: 'Awaiting analytics',
  weeklyGrowth: 'Awaiting analytics',
  authorityScore: 'Awaiting analytics',
  pendingApprovals: 0,
  campaignActivity: 0,
  buyerOutreachActivity: 0,
  importerSignals: 0,
  brandRisks: 0,
  consistencyScore: 'Awaiting analytics',
  scheduledContent: 0
};

const linkedInPipeline = [];
const instagramPipeline = [];
const youtubePlans = [];
const facebookPipeline = [];
const campaigns = [];
const buyerOutreach = [];
const competitorReviews = [];
const brandRisks = [];
const contentCalendar = [];
const socialGrowthMetrics = [];
const contentPerformance = [];
const growthTargets = [];
const crossExecutiveIdeas = [];
const approvalQueue = [];
const optimizationInsights = [];
const openAIContentBrain = [];
const contentToolchain = [];
const openAIContentMemory = [];
const tenglishVoiceRules = [];
const globalTargetingStrategy = [];
const thumbnailDirections = [];
const videoScriptStyles = [];
const digitalMarketingOptimization = [];

const aiCmoOperatingSystemFallback = {
  mode: 'AI primary operator',
  authority: 'Founder approval required',
  source: 'architecture',
  operatorSplit: [
    ['AI controls', 'generation, planning, scheduling recommendations, optimization, analysis, forecasts, lead scoring'],
    ['Founder controls', 'approve, override, pause, monitor, audit'],
    ['AI cannot', 'spend beyond approved budgets, publish paid ads silently, bypass approvals, modify protected financial limits']
  ],
  activity: [
    ['AI Content Engine', 'Monitoring', 'Waiting for connected content generation logs.'],
    ['AI Budget Intelligence', 'Monitoring', 'Waiting for campaign spend and budget analysis rows.'],
    ['AI Schedule Optimizer', 'Monitoring', 'Using selected GOPU OS timezone only.'],
    ['AI Growth Analyst', 'Monitoring', 'Waiting for connected platform metrics.'],
    ['AI Lead Intelligence', 'Monitoring', 'Waiting for importer lead score rows.']
  ]
};

const aiBudgetAnalysisFallback = {
  connected: false,
  healthScore: 'Awaiting spend data',
  spendEfficiencyScore: 'Awaiting spend data',
  roiConfidenceScore: 'Awaiting conversion data',
  profitabilityEstimate: 'Not enough live campaign data',
  rows: [],
  recommendations: [
    'AI budget recommendations stay advisory until CFO and founder approval.',
    'No campaign can auto-spend beyond approved limits.',
    'Low-performing campaigns should be paused only through an approved workflow.'
  ]
};

const aiCampaignForecastFallback = {
  connected: false,
  rows: [],
  summary: 'Connect campaign forecasts to show reach, lead, CPL, CPC, and ROI projections without fabricated results.'
};

const aiScheduleOptimizationFallback = {
  connected: false,
  timezone: DEFAULT_CMO_TIMEZONE,
  rows: [],
  summary: 'AI schedule optimization uses the selected GOPU OS timezone only, never browser/device timezone.'
};

const aiLeadScoresFallback = {
  connected: false,
  rows: [],
  summary: 'Connect importer lead scoring to rank serious buyers, spam risk, and follow-up priority.'
};

const aiGrowthInsightsFallback = {
  connected: false,
  rows: [],
  summary: 'Connect growth insights to explain why engagement, reach, audience quality, and country response changed.'
};

const aiRecommendationsFallback = {
  connected: false,
  rows: []
};

export async function getCMOSummary() { return serviceResponse(cmoSummary); }
export async function getLinkedInPipeline() { return serviceResponse(linkedInPipeline); }
export async function getInstagramPipeline() { return serviceResponse(instagramPipeline); }
export async function getYouTubePlans() { return serviceResponse(youtubePlans); }
export async function getFacebookPipeline() { return serviceResponse(facebookPipeline); }
export async function getCampaigns() { return serviceResponse(campaigns); }
export async function getBuyerOutreach() { return serviceResponse(buyerOutreach); }
export async function getCompetitorReviews() { return serviceResponse(competitorReviews); }
export async function getBrandRisks() { return serviceResponse(brandRisks); }
export async function getContentCalendar() { return serviceResponse(contentCalendar); }
export async function getSocialGrowthMetrics() { return serviceResponse(socialGrowthMetrics); }
export async function getContentPerformance() { return serviceResponse(contentPerformance); }
export async function getGrowthTargets() { return serviceResponse(growthTargets); }
export async function getCrossExecutiveContentIdeas() { return serviceResponse(crossExecutiveIdeas); }
export async function getContentApprovalQueue() { return serviceResponse(approvalQueue); }
export async function getGrowthOptimizationInsights() { return serviceResponse(optimizationInsights); }
export async function getOpenAIContentBrain() { return serviceResponse(openAIContentBrain); }
export async function getContentToolchain() { return serviceResponse(contentToolchain); }
export async function getOpenAIContentMemory() { return serviceResponse(openAIContentMemory); }
export async function getTenglishVoiceRules() { return serviceResponse(tenglishVoiceRules); }
export async function getGlobalTargetingStrategy() { return serviceResponse(globalTargetingStrategy); }
export async function getThumbnailDirections() { return serviceResponse(thumbnailDirections); }
export async function getVideoScriptStyles() { return serviceResponse(videoScriptStyles); }
export async function getDigitalMarketingOptimization() { return serviceResponse(digitalMarketingOptimization); }

async function listAiRows(tableName, orderColumn = 'created_at', limit = 30) {
  const { client, error } = requireSupabase();
  if (error) return { rows: [], connected: false, error: error.message };
  let query = client.from(tableName).select('*').limit(limit);
  if (orderColumn) query = query.order(orderColumn, { ascending: false });
  const { data, error: queryError } = await query;
  if (queryError) return { rows: [], connected: false, error: queryError.message };
  return { rows: Array.isArray(data) ? data : [], connected: Boolean(data?.length), error: '' };
}

export async function getAICmoOperatingSystem() {
  return serviceResponse(aiCmoOperatingSystemFallback);
}

export async function getAIBudgetAnalysis(tenantId = demoTenantId) {
  const result = await listAiRows('ai_budget_analysis', 'created_at', 20);
  if (!result.connected) return serviceResponse({ ...aiBudgetAnalysisFallback, error: result.error || '' });
  const rows = result.rows.filter((row) => !row.tenant_id || row.tenant_id === tenantId);
  const latest = rows[0] || {};
  return serviceResponse({
    connected: true,
    healthScore: latest.budget_health_score ?? latest.health_score ?? 'Needs review',
    spendEfficiencyScore: latest.spend_efficiency_score ?? 'Needs review',
    roiConfidenceScore: latest.roi_confidence_score ?? 'Needs review',
    profitabilityEstimate: latest.campaign_profitability_estimate ?? latest.profitability_estimate ?? 'Needs review',
    rows,
    recommendations: rows.map((row) => row.recommendation || row.summary || row.analysis).filter(Boolean).slice(0, 5)
  });
}

export async function getAICampaignForecasts(tenantId = demoTenantId) {
  const result = await listAiRows('ai_campaign_forecasts', 'created_at', 30);
  if (!result.connected) return serviceResponse({ ...aiCampaignForecastFallback, error: result.error || '' });
  return serviceResponse({ connected: true, rows: result.rows.filter((row) => !row.tenant_id || row.tenant_id === tenantId), summary: 'Live AI campaign forecasts connected.' });
}

export async function getAIScheduleOptimizations(filters = {}) {
  const timezone = getSelectedCmoTimezone({ timezone: filters.timezone || DEFAULT_CMO_TIMEZONE });
  const result = await listAiRows('ai_schedule_optimizations', 'created_at', 30);
  if (!result.connected) return serviceResponse({ ...aiScheduleOptimizationFallback, timezone, error: result.error || '' });
  return serviceResponse({ connected: true, timezone, rows: result.rows, summary: `AI schedule recommendations are interpreted in ${timezone}.` });
}

export async function getAILeadScores(tenantId = demoTenantId) {
  const result = await listAiRows('ai_lead_scores', 'created_at', 40);
  if (!result.connected) return serviceResponse({ ...aiLeadScoresFallback, error: result.error || '' });
  return serviceResponse({ connected: true, rows: result.rows.filter((row) => !row.tenant_id || row.tenant_id === tenantId), summary: 'Live importer lead scores connected.' });
}

export async function getAIGrowthInsights(tenantId = demoTenantId) {
  const result = await listAiRows('ai_growth_insights', 'created_at', 30);
  if (!result.connected) return serviceResponse({ ...aiGrowthInsightsFallback, error: result.error || '' });
  return serviceResponse({ connected: true, rows: result.rows.filter((row) => !row.tenant_id || row.tenant_id === tenantId), summary: 'Live AI growth insights connected.' });
}

export async function getAIRecommendations(tenantId = demoTenantId) {
  const result = await listAiRows('ai_recommendations', 'created_at', 40);
  if (!result.connected) return serviceResponse({ ...aiRecommendationsFallback, error: result.error || '' });
  return serviceResponse({ connected: true, rows: result.rows.filter((row) => !row.tenant_id || row.tenant_id === tenantId) });
}

const campaignStatusSet = new Set(['Draft', 'Active', 'Paused', 'Completed', 'Failed']);

function normalizeCampaignStatus(value = '') {
  const match = Array.from(campaignStatusSet).find((status) => status.toLowerCase() === String(value || '').trim().toLowerCase());
  return match || 'Draft';
}

function safeCampaignNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatCampaignDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

function metricByCampaign(rows = [], campaignId, metricName) {
  return rows.find((row) => String(row.campaign_id || row.marketing_campaign_id || '') === String(campaignId) && String(row.metric_name || '').toLowerCase() === metricName)?.metric_value;
}

function buildCampaignControlRows(campaignRows = [], budgetRows = [], metricRows = [], leadRows = [], scheduleRows = []) {
  return campaignRows.map((campaign) => {
    const campaignName = campaign.campaign_name || campaign.name || 'Untitled campaign';
    const budget = budgetRows.find((row) => String(row.campaign_id || '') === String(campaign.id) || row.campaign_name === campaignName) || {};
    const campaignLeads = leadRows.filter((row) => String(row.campaign_id || '') === String(campaign.id) || row.campaign_name === campaignName);
    const campaignSchedule = scheduleRows.filter((row) => String(row.campaign_id || '') === String(campaign.id) || row.campaign_name === campaignName);
    const totalBudget = safeCampaignNumber(campaign.total_budget_inr ?? campaign.total_budget ?? campaign.allocated_budget ?? budget.total_budget_inr ?? budget.budget_amount);
    const spend = safeCampaignNumber(campaign.spend_inr ?? campaign.spend ?? budget.spend_amount);
    const leads = safeCampaignNumber(metricByCampaign(metricRows, campaign.id, 'leads') ?? campaignLeads.length);
    const cpc = safeCampaignNumber(metricByCampaign(metricRows, campaign.id, 'cpc') ?? campaign.cpc);
    const ctr = safeCampaignNumber(metricByCampaign(metricRows, campaign.id, 'ctr') ?? campaign.ctr);
    const roi = safeCampaignNumber(metricByCampaign(metricRows, campaign.id, 'roi') ?? campaign.roi);
    return {
      id: campaign.id,
      campaignName,
      platform: campaign.platform || campaign.channel || 'Platform pending',
      objective: campaign.objective || campaign.stage || 'Objective pending',
      status: normalizeCampaignStatus(campaign.status || campaign.performance_status),
      budget: totalBudget,
      spend,
      remainingBudget: Math.max(totalBudget - spend, 0),
      leads,
      cpc,
      ctr,
      roi,
      startDate: formatCampaignDate(campaign.start_date || budget.start_date),
      endDate: formatCampaignDate(campaign.end_date || budget.end_date),
      countryTarget: campaign.country_target || campaign.target_market || '',
      audienceTarget: campaign.audience_target || '',
      approvalStatus: campaign.founder_approval_status || campaign.approval_status || budget.approval_status || 'Founder approval required',
      scheduleCount: campaignSchedule.length
    };
  });
}

function buildCampaignBudgetSummary(campaigns = []) {
  const totalMarketingBudget = campaigns.reduce((sum, row) => sum + row.budget, 0);
  const activeSpend = campaigns.reduce((sum, row) => sum + row.spend, 0);
  const totalLeads = campaigns.reduce((sum, row) => sum + row.leads, 0);
  const activeCampaigns = campaigns.filter((row) => row.status === 'Active');
  const bestRoiCampaign = campaigns.filter((row) => row.roi > 0).sort((a, b) => b.roi - a.roi)[0];
  return {
    totalMarketingBudget,
    activeSpend,
    remainingBudget: Math.max(totalMarketingBudget - activeSpend, 0),
    estimatedMonthlySpend: activeCampaigns.reduce((sum, row) => sum + row.spend, 0),
    costPerLead: totalLeads > 0 ? activeSpend / totalLeads : 0,
    bestRoiPlatform: bestRoiCampaign?.platform || 'No ROI data'
  };
}

function buildCampaignWarnings(campaigns = []) {
  const warnings = [];
  campaigns.forEach((campaign) => {
    if (campaign.budget > 0 && campaign.spend >= campaign.budget) {
      warnings.push({ type: 'Overspending detection', campaign: campaign.campaignName, message: `${campaign.campaignName} has reached or exceeded its approved budget.` });
    } else if (campaign.budget > 0 && campaign.spend / campaign.budget >= 0.85) {
      warnings.push({ type: 'Campaign nearing budget limit', campaign: campaign.campaignName, message: `${campaign.campaignName} has used ${Math.round((campaign.spend / campaign.budget) * 100)}% of budget.` });
    }
    if (campaign.spend > 0 && campaign.roi > 0 && campaign.roi < 1) {
      warnings.push({ type: 'Low ROI alert', campaign: campaign.campaignName, message: `${campaign.campaignName} ROI is below 1.0x.` });
    }
  });
  return warnings;
}

function buildCampaignRecommendations(campaigns = []) {
  if (!campaigns.length) return ['Create the first campaign draft to activate metric-based recommendations.'];
  const recommendations = [];
  const roiRows = campaigns.filter((row) => row.roi > 0);
  const best = [...roiRows].sort((a, b) => b.roi - a.roi)[0];
  const weak = [...roiRows].sort((a, b) => a.roi - b.roi)[0];
  const bestCtr = campaigns.filter((row) => row.ctr > 0).sort((a, b) => b.ctr - a.ctr)[0];
  const bestCpl = campaigns.filter((row) => row.leads > 0 && row.spend > 0).sort((a, b) => (a.spend / a.leads) - (b.spend / b.leads))[0];
  if (best) recommendations.push(`${best.platform} is currently the best ROI platform at ${best.roi.toFixed(2)}x from connected campaign metrics.`);
  if (weak && weak.id !== best?.id) recommendations.push(`Review ${weak.campaignName}: ROI is ${weak.roi.toFixed(2)}x and may need budget reduction or creative changes.`);
  if (bestCtr) recommendations.push(`${bestCtr.campaignName} has the strongest CTR at ${bestCtr.ctr.toFixed(2)}%. Use its content type as the next test baseline.`);
  if (bestCpl) recommendations.push(`${bestCpl.platform} has the lowest connected cost per lead at ₹${Math.round(bestCpl.spend / bestCpl.leads)}.`);
  return recommendations.length ? recommendations : ['Connected campaign metrics are not sufficient yet for AI marketing recommendations.'];
}

export async function getMarketingCampaignControlCenter(tenantId = demoTenantId) {
  const empty = {
    connected: backendStatus.mode === 'Connected',
    campaigns: [],
    budgetSummary: buildCampaignBudgetSummary([]),
    warnings: [],
    recommendations: ['Create the first campaign draft to activate metric-based recommendations.'],
    schedule: [],
    leads: [],
    error: ''
  };
  const { client, error } = requireSupabase();
  if (error) return serviceResponse({ ...empty, connected: false, error: error.message });

  try {
    const [campaignResult, budgetResult, metricResult, leadResult, scheduleResult] = await Promise.all([
      client.from('marketing_campaigns').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      client.from('campaign_budgets').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      client.from('campaign_metrics').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      client.from('campaign_leads').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      client.from('campaign_schedule').select('*').eq('tenant_id', tenantId).order('scheduled_at', { ascending: true })
    ]);
    if (campaignResult.error) return serviceErrorResponse(empty, campaignResult.error);
    const errors = [budgetResult.error, metricResult.error, leadResult.error, scheduleResult.error].filter(Boolean);
    const campaigns = buildCampaignControlRows(campaignResult.data || [], budgetResult.data || [], metricResult.data || [], leadResult.data || [], scheduleResult.data || []);
    return serviceResponse({
      connected: true,
      campaigns,
      budgetSummary: buildCampaignBudgetSummary(campaigns),
      warnings: buildCampaignWarnings(campaigns),
      recommendations: buildCampaignRecommendations(campaigns),
      schedule: scheduleResult.error ? [] : (scheduleResult.data || []),
      leads: leadResult.error ? [] : (leadResult.data || []),
      error: errors.map((item) => item.message).join(' ')
    });
  } catch (error) {
    return serviceErrorResponse(empty, error);
  }
}

export async function createMarketingCampaignDraft(payload = {}) {
  const tenantId = payload.tenant_id || demoTenantId;
  const { client, error } = requireSupabase();
  if (error) return serviceErrorResponse(null, error);

  const campaignPayload = {
    tenant_id: tenantId,
    campaign_name: payload.campaign_name,
    platform: payload.platform,
    objective: payload.objective,
    target_market: payload.country_target,
    country_target: payload.country_target,
    audience_target: payload.audience_target,
    daily_budget_inr: safeCampaignNumber(payload.daily_budget_inr),
    total_budget_inr: safeCampaignNumber(payload.total_budget_inr),
    allocated_budget: safeCampaignNumber(payload.total_budget_inr),
    spend_inr: 0,
    start_date: payload.start_date || null,
    end_date: payload.end_date || null,
    ai_suggestion_enabled: Boolean(payload.ai_suggestion_enabled),
    founder_approval_status: 'Founder approval required',
    stage: 'Draft created',
    owner: 'CMO Command',
    next_action: 'Request founder approval before launch. No paid ads are launched automatically.',
    status: 'Draft',
    performance_status: 'Draft'
  };

  try {
    const { data, error: insertError } = await client.from('marketing_campaigns').insert(campaignPayload).select('*').single();
    if (insertError) return serviceErrorResponse(null, insertError);

    await client.from('campaign_budgets').insert({
      tenant_id: tenantId,
      campaign_id: data.id,
      campaign_name: data.campaign_name,
      currency: 'INR',
      daily_budget_inr: campaignPayload.daily_budget_inr,
      total_budget_inr: campaignPayload.total_budget_inr,
      budget_amount: campaignPayload.total_budget_inr,
      spend_amount: 0,
      approval_status: 'Founder approval required',
      owner_role: 'cmo',
      metadata: {
        safety_rule: 'No paid ads auto-launch. Founder approval required before campaign launch.',
        platform: data.platform,
        objective: data.objective
      }
    });

    if (payload.start_date) {
      await client.from('campaign_schedule').insert({
        tenant_id: tenantId,
        campaign_id: data.id,
        campaign_name: data.campaign_name,
        schedule_type: 'Ad launch date',
        title: `${data.campaign_name} launch approval deadline`,
        scheduled_at: payload.start_date,
        status: 'Pending Approval',
        metadata: { platform: data.platform, founder_approval_required: true }
      });
    }

    await createAuditLog({
      tenant_id: tenantId,
      action_type: 'Marketing campaign draft created',
      module: 'CMO Campaign Control',
      related_table: 'marketing_campaigns',
      related_record_id: data.id,
      actor: 'CMO Command',
      description: `${data.campaign_name} campaign draft created. Founder approval required before launch.`,
      risk_level: 'Medium',
      metadata: { platform: data.platform, objective: data.objective, total_budget_inr: campaignPayload.total_budget_inr }
    });

    return serviceResponse(data);
  } catch (error) {
    return serviceErrorResponse(null, error);
  }
}

const cmoAutomationFlowDefinitions = [
  {
    id: 'time-trigger',
    step: 1,
    title: 'Time Trigger',
    time: '8:00 AM IST',
    engine: 'Vercel Cron',
    description: 'Vercel wakes the workflow endpoint every 10 minutes; GOPU OS timezone/settings decide whether posting is due.',
    logoKey: 'vercel',
    integrationKeys: ['vercel_cron_scheduler', 'vercel-cron-scheduler', 'vercel_cron'],
    outputs: ['Trigger queued'],
    missingMessage: 'Vercel Cron scheduler health is not live yet.'
  },
  {
    id: 'ai-content-generation',
    step: 2,
    title: 'AI Content Generation',
    time: 'Content build',
    engine: 'OpenAI',
    description: 'Generates captions, platform copy, hashtags, and image prompts.',
    logoKey: 'openai',
    integrationKeys: ['openai'],
    outputs: ['Instagram caption', 'Facebook caption', 'LinkedIn copy', 'Hashtags', 'Image prompt'],
    missingMessage: 'OpenAI key missing in CTO provider vault.'
  },
  {
    id: 'creative-engine',
    step: 3,
    title: 'Poster & Creative Engine',
    time: 'Creative render',
    engine: 'Image generation and Sharp poster composition',
    description: 'Creates final poster/video assets with brand-safe stamping.',
    logoKey: 'creative',
    integrationKeys: ['image-generation', 'sharp', 'creative-engine'],
    outputs: ['Poster asset', 'Sharp-composed final image'],
    missingMessage: 'Missing creative provider health: image generation or Sharp poster composition is not live.'
  },
  {
    id: 'asset-storage',
    step: 4,
    title: 'Supabase Storage Upload',
    time: 'Upload URL',
    engine: 'Supabase Storage',
    description: 'Uploads final media to the GOPU OS storage bucket and returns a public asset URL.',
    logoKey: 'supabase',
    integrationKeys: ['asset-storage', 'supabase-storage', 'supabase', 'cmo-generated-assets'],
    outputs: ['Poster asset public URL', 'Generated image public URL'],
    missingMessage: 'Missing Supabase Storage health: upload or public retrieval is not live.'
  },
  {
    id: 'slack-approval',
    step: 5,
    title: 'Slack Approval',
    time: 'Approval card',
    engine: 'Slack Block Kit approval',
    description: 'Sends approval card with Approve / Reject decision buttons.',
    logoKey: 'slack',
    integrationKeys: ['slack'],
    outputs: ['Approve button', 'Reject button'],
    missingMessage: 'Missing Slack approval config: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SLACK_SIGNING_SECRET, and SLACK_APPROVAL_WEBHOOK_URL or SLACK_WEBHOOK_URL.'
  },
  {
    id: 'founder-decision',
    step: 6,
    title: 'Founder Decision',
    time: 'Waiting',
    engine: 'Founder approval logic',
    description: 'Approved content moves to publish queue; rejected content returns to edit queue.',
    logoKey: 'founder',
    integrationKeys: ['founder-approval', 'founder_approvals', 'approvals'],
    outputs: ['Approved', 'Rejected', 'Waiting'],
    pendingMessage: 'Waiting for founder approval decision.'
  },
  {
    id: 'meta-publish-engine',
    step: 7,
    title: 'Publishing State',
    time: 'Publish queue',
    engine: 'Instagram Graph API, Facebook Pages API, WhatsApp Cloud API',
    description: 'Tracks approved content as it moves from queued state into the protected publishing path.',
    logoKey: 'meta',
    integrationKeys: ['meta', 'instagram', 'facebook', 'whatsapp'],
    outputs: ['Queued', 'Publishing', 'Published', 'Failed', 'Retry scheduled'],
    missingMessage: 'Missing Meta publishing config: Meta access token, Instagram business account, Facebook page, WhatsApp phone number ID, or webhook status is not live.'
  },
  {
    id: 'delivery-tracking',
    step: 8,
    title: 'Analytics State',
    time: 'Engagement sync',
    engine: 'Publish response, platform engagement sync, and learning signals',
    description: 'Collects post-delivery signals after publishing has succeeded.',
    logoKey: 'tracking',
    integrationKeys: ['delivery-tracking', 'webhook-events', 'meta-webhook', 'whatsapp-webhook'],
    outputs: ['Collecting analytics', 'Engagement sync', 'AI learning'],
    missingMessage: 'Missing delivery/webhook health: publish response or platform webhook tracking is not live.'
  },
  {
    id: 'audit-analytics',
    step: 9,
    title: 'Optimization State',
    time: 'AI learning',
    engine: 'Supabase audit_logs and AI optimization memory',
    description: 'Saves the audit trail and adapts future content from approved performance signals.',
    logoKey: 'supabase',
    integrationKeys: ['supabase', 'audit_logs', 'audit-analytics'],
    outputs: ['AI optimization running', 'Hashtag optimization', 'Performance adaptation'],
    missingMessage: 'Missing Supabase audit_logs health: audit insert/read test or Supabase integration status is not live.'
  }
];

function normalizeCmoIntegrationStatus(value = '') {
  const status = String(value || '').trim().toLowerCase();
  if (['live', 'connected', 'healthy', 'active', 'verified', 'live connected', 'verification success'].includes(status)) return 'live';
  if (['error', 'failed', 'failure detected', 'not connected', 'webhook pending', 'setup required', 'missing', 'invalid'].includes(status)) return 'error';
  return 'pending';
}

function normalizeCmoPlatformKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function rowMatchesCmoStep(row = {}, keys = []) {
  const candidates = [
    row.platform_key,
    row.platform_name,
    row.service_name,
    row.logo_key,
    row.id,
    row.environment
  ].map(normalizeCmoPlatformKey);
  return keys.map(normalizeCmoPlatformKey).some((key) => candidates.includes(key) || candidates.some((candidate) => candidate.includes(key)));
}

function normalizeCmoIntegrationRow(row = {}) {
  const status = normalizeCmoIntegrationStatus(row.status || row.health_status);
  return {
    id: row.id,
    platform_key: row.platform_key || row.id || row.service_name,
    platform_name: row.platform_name || row.service_name || row.platform_key || row.id,
    logo_key: row.logo_key || row.id || row.platform_key,
    status,
    error_message: row.error_message || (status === 'error' ? row.connection_message || row.quota_remaining || row.last_request || row.status || 'Integration is not live.' : ''),
    provider: row.provider || row.metadata?.provider || '',
    runtime: row.runtime || row.metadata?.runtime || row.metadata?.scheduler_runtime || '',
    last_checked_at: row.last_checked_at || row.metadata?.last_checked_at || '',
    last_sync_at: row.last_sync_at || row.last_checked_at || row.updated_at || row.last_verified || row.created_at || '',
    metadata: row.metadata || {
      health_status: row.health_status,
      request_volume: row.request_volume,
      connection_message: row.connection_message
    }
  };
}

function normalizeCmoPostingSetting(row = {}) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    platform: row.platform || '',
    timezone: row.timezone || '',
    country: row.country || '',
    local_post_time: row.local_post_time || '',
    schedule_mode: row.schedule_mode || 'every_day',
    schedule_days: row.schedule_days || [],
    trigger_window_minutes: row.trigger_window_minutes || 10,
    last_triggered_at_utc: row.last_triggered_at_utc || ''
  };
}

async function readCmoIntegrationStatusRows() {
  const { client, error } = requireSupabase();
  if (error) return { rows: [], source: 'none', error: error.message || 'Supabase client is not configured.' };

  try {
    const platformResult = await client
      .from('platform_integrations')
      .select('id,platform_key,platform_name,logo_key,provider,status,runtime,error_message,last_sync_at,last_checked_at,metadata,created_at,updated_at')
      .order('updated_at', { ascending: false });

    if (!platformResult.error) {
      return { rows: (platformResult.data || []).map(normalizeCmoIntegrationRow), source: 'platform_integrations', error: '' };
    }

    const integrationResult = await client
      .from('integration_services')
      .select('id,service_name,environment,status,health_status,quota_remaining,last_verified,last_request,connection_message,request_volume,created_at,updated_at')
      .order('updated_at', { ascending: false });

    if (!integrationResult.error) {
      return { rows: (integrationResult.data || []).map(normalizeCmoIntegrationRow), source: 'integration_services', error: platformResult.error.message || '' };
    }

    return { rows: [], source: 'none', error: integrationResult.error.message || platformResult.error.message || 'Integration status could not be checked.' };
  } catch (error) {
    return { rows: [], source: 'none', error: error.message || 'Integration status could not be checked.' };
  }
}

async function readCmoSchedulerHealthSnapshot() {
  try {
    if (typeof fetch !== 'function') return { row: null, postingRows: [], source: 'none', error: '' };
    const response = await fetch(`/api/cmo/scheduler-health?_=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      },
      cache: 'no-store'
    });
    if (!response.ok) return { row: null, postingRows: [], source: 'none', error: `Scheduler health endpoint returned HTTP ${response.status}.` };
    const result = await response.json();
    const schedulerStatus = normalizeCmoIntegrationStatus(result.status || result.integration?.status);
    const endpointVerified = result.endpoint_verified === true || result.endpoint_verified === 'true' || result.integration?.metadata?.endpoint_verified === true || result.integration?.metadata?.endpoint_verified === 'true';
    const postingRows = (result.postingSettings || []).map(normalizeCmoPostingSetting);
    const dbReadSucceeded = result.ok === true && result.status !== 'db_read_failed' && result.status !== 'failed_safely' && result.status !== 'not_configured';
    const liveWithoutIntegrationRow = schedulerStatus === 'live' || (endpointVerified && dbReadSucceeded);

    if (!result.ok && !liveWithoutIntegrationRow) {
      return { row: null, postingRows: [], source: 'none', error: result.message || 'Scheduler health endpoint is not ready.' };
    }

    if (!result.integration && !liveWithoutIntegrationRow) {
      return { row: null, postingRows, source: result.source || 'scheduler_health_api', error: result.message || 'Scheduler health endpoint is not ready.' };
    }

    const integration = result.integration || {};
    const metadata = {
      ...(integration.metadata || {}),
      endpoint_verified: endpointVerified || integration.metadata?.endpoint_verified || result.endpoint_verified || false,
      cron_secret_configured: integration.metadata?.cron_secret_configured ?? result.cron_secret_configured ?? true,
      last_cron_check_status: integration.metadata?.last_cron_check_status || result.last_cron_check_status || (dbReadSucceeded ? 'success' : ''),
      due_count: integration.metadata?.due_count ?? result.due_count ?? 0,
      selected_timezone: integration.metadata?.selected_timezone || result.selected_timezone || postingRows[0]?.timezone || '',
      selected_country: integration.metadata?.selected_country || result.selected_country || postingRows[0]?.country || '',
      selected_posting_time: integration.metadata?.selected_posting_time || result.selected_posting_time || postingRows[0]?.local_post_time || '',
      next_check_at_utc: integration.metadata?.next_check_at_utc || result.next_check_at_utc || '',
      next_scheduled_post_local: integration.metadata?.next_scheduled_post_local || result.next_scheduled_post_local || ''
    };

    return {
      row: normalizeCmoIntegrationRow({
        id: integration.id || 'scheduler-health-api',
        platform_key: integration.platform_key || 'vercel_cron_scheduler',
        platform_name: integration.platform_name || 'Vercel Cron Scheduler',
        logo_key: integration.logo_key || 'vercel',
        provider: integration.provider || 'vercel',
        status: liveWithoutIntegrationRow ? 'live' : integration.status,
        runtime: integration.runtime || metadata.scheduler_runtime || 'vercel_cron',
        error_message: liveWithoutIntegrationRow ? '' : integration.error_message,
        last_sync_at: integration.last_sync_at || integration.last_checked_at || '',
        last_checked_at: integration.last_checked_at || '',
        metadata
      }),
      postingRows,
      source: result.source || 'scheduler_health_api',
      error: ''
    };
  } catch (error) {
    return { row: null, postingRows: [], source: 'none', error: error.message || 'Scheduler health endpoint is not ready.' };
  }
}

async function readCmoPostingScheduleRows() {
  const { client, error } = requireSupabase();
  if (error) return { rows: [], source: 'none', error: error.message || 'Supabase client is not configured.' };

  try {
    const result = await client
      .from('cmo_posting_settings')
      .select('id,tenant_id,platform,timezone,country,local_post_time,schedule_mode,schedule_days,trigger_window_minutes,last_triggered_at_utc')
      .order('updated_at', { ascending: false });

    if (result.error) return { rows: [], source: 'none', error: result.error.message || 'Posting settings could not be checked.' };
    return { rows: (result.data || []).map(normalizeCmoPostingSetting), source: 'cmo_posting_settings', error: '' };
  } catch (error) {
    return { rows: [], source: 'none', error: error.message || 'Posting settings could not be checked.' };
  }
}

function getPrimaryCmoPostingSetting(scheduleRows = []) {
  return scheduleRows.find((row) => row.timezone && row.local_post_time) || scheduleRows[0] || null;
}

function buildTimeTriggerHealth(definition, matches = [], source = 'none', sourceError = '', scheduleRows = []) {
  const liveMatch = matches.find((row) => row.status === 'live');
  const errorMatch = matches.find((row) => row.status === 'error');
  const pendingMatch = matches.find((row) => row.status === 'pending');
  const active = liveMatch || errorMatch || pendingMatch;
  const metadata = active?.metadata || {};
  const postingSetting = getPrimaryCmoPostingSetting(scheduleRows);
  const selectedTimezone = metadata.selected_timezone || postingSetting?.timezone || '';
  const selectedCountry = metadata.selected_country || postingSetting?.country || '';
  const selectedPostingTime = metadata.selected_posting_time || postingSetting?.local_post_time || '';
  const endpointVerified = metadata.endpoint_verified === true || metadata.endpoint_verified === 'true';
  const cronSecretConfigured = metadata.cron_secret_configured === true || metadata.cron_secret_configured === 'true';
  const lastCronStatus = metadata.last_cron_check_status || '';
  const dueCount = Number(metadata.due_count || 0);
  const runtime = active?.runtime || metadata.scheduler_runtime || 'vercel_cron';
  const liveFromSchedulerHealth = Boolean(liveMatch && source === 'scheduler_health_api');
  const dbHealthy = Boolean(liveMatch && (liveFromSchedulerHealth || (endpointVerified && cronSecretConfigured && selectedTimezone && selectedPostingTime && lastCronStatus === 'success')));

  if (dbHealthy) {
    return {
      status: 'live',
      healthMessage: dueCount > 0 ? `${dueCount} posting schedule(s) currently due.` : 'Scheduler active. No posting schedule currently due.',
      matchedProvider: liveMatch.platform_name,
      runtime,
      healthDetails: {
        ...metadata,
        selected_timezone: selectedTimezone,
        selected_country: selectedCountry,
        selected_posting_time: selectedPostingTime,
        schedule_mode: postingSetting?.schedule_mode || metadata.schedule_mode || 'every_day'
      },
      lastSyncAt: liveMatch.last_sync_at || liveMatch.last_checked_at || ''
    };
  }

  if (errorMatch) {
    return {
      status: 'error',
      healthMessage: errorMatch.error_message || metadata.last_cron_error || definition.missingMessage,
      matchedProvider: errorMatch.platform_name,
      runtime,
      healthDetails: {
        ...metadata,
        selected_timezone: selectedTimezone,
        selected_country: selectedCountry,
        selected_posting_time: selectedPostingTime
      },
      lastSyncAt: errorMatch.last_sync_at || errorMatch.last_checked_at || ''
    };
  }

  if (pendingMatch) {
    return {
      status: 'pending',
      healthMessage: pendingMatch.error_message || 'Vercel Cron scheduler health is pending verification.',
      matchedProvider: pendingMatch.platform_name,
      runtime,
      healthDetails: {
        ...metadata,
        selected_timezone: selectedTimezone,
        selected_country: selectedCountry,
        selected_posting_time: selectedPostingTime
      },
      lastSyncAt: pendingMatch.last_sync_at || pendingMatch.last_checked_at || ''
    };
  }

  return {
    status: 'pending',
    healthMessage: sourceError ? `Status cannot be checked: ${sourceError}` : definition.missingMessage,
    matchedProvider: '',
    runtime: 'vercel_cron',
    healthDetails: {
      selected_timezone: selectedTimezone,
      selected_country: selectedCountry,
      selected_posting_time: selectedPostingTime,
      last_cron_check_status: source === 'none' ? 'unavailable' : 'pending'
    },
    lastSyncAt: ''
  };
}

function buildCmoAutomationStep(definition, rows = [], source = 'none', sourceError = '', scheduleRows = []) {
  const matches = rows.filter((row) => rowMatchesCmoStep(row, definition.integrationKeys));
  let status = 'error';
  let healthMessage = definition.missingMessage;
  let matchedProvider = '';
  let runtime = '';
  let healthDetails = {};
  const liveMatch = matches.find((row) => row.status === 'live');
  const errorMatch = matches.find((row) => row.status === 'error');
  const pendingMatch = matches.find((row) => row.status === 'pending');

  if (definition.id === 'time-trigger') {
    const timeHealth = buildTimeTriggerHealth(definition, matches, source, sourceError, scheduleRows);
    return {
      ...definition,
      status: timeHealth.status,
      healthMessage: timeHealth.healthMessage,
      matchedProvider: timeHealth.matchedProvider,
      runtime: timeHealth.runtime,
      healthDetails: timeHealth.healthDetails,
      statusSource: source,
      lastSyncAt: timeHealth.lastSyncAt
    };
  }

  if (definition.id === 'founder-decision') {
    status = 'pending';
    healthMessage = definition.pendingMessage;
  } else if (liveMatch) {
    status = 'live';
    healthMessage = '';
    matchedProvider = liveMatch.platform_name;
    runtime = liveMatch.runtime || liveMatch.metadata?.scheduler_runtime || '';
    healthDetails = liveMatch.metadata || {};
  } else if (errorMatch) {
    status = 'error';
    healthMessage = errorMatch.error_message || definition.missingMessage;
    matchedProvider = errorMatch.platform_name;
    runtime = errorMatch.runtime || errorMatch.metadata?.scheduler_runtime || '';
    healthDetails = errorMatch.metadata || {};
  } else if (pendingMatch) {
    status = source === 'platform_integrations' ? 'pending' : 'error';
    healthMessage = source === 'platform_integrations'
      ? `${pendingMatch.platform_name || definition.engine} status is pending verification.`
      : pendingMatch.error_message || `${pendingMatch.platform_name || definition.engine} is not live: ${pendingMatch.metadata?.connection_message || pendingMatch.metadata?.health_status || 'configuration/API health is pending verification.'}`;
    matchedProvider = pendingMatch.platform_name;
    runtime = pendingMatch.runtime || pendingMatch.metadata?.scheduler_runtime || '';
    healthDetails = pendingMatch.metadata || {};
  } else if (source === 'none' && sourceError) {
    status = 'pending';
    healthMessage = `Status cannot be checked: ${sourceError}`;
  }

  return {
    ...definition,
    status,
    healthMessage,
    matchedProvider,
    runtime,
    healthDetails,
    statusSource: source,
    lastSyncAt: (liveMatch || errorMatch || pendingMatch)?.last_sync_at || ''
  };
}

function normalizeCreativeProviderStatus(provider = {}) {
  return {
    status: provider.status === 'live' ? 'live' : provider.status === 'pending' ? 'pending' : 'error',
    provider: provider.provider || '',
    latency_ms: provider.latency_ms ?? null,
    version: provider.version || '',
    error_message: provider.error_message || ''
  };
}

function buildCreativeAutomationStep(definition, creativeStatus) {
  if (!creativeStatus) {
    return {
      ...definition,
      status: 'pending',
      healthMessage: 'Checking creative providers...',
      matchedProvider: '',
      runtime: '',
      healthDetails: {
        providers: {
          openai_creative: { status: 'pending', provider: 'OpenAI Creative', error_message: '' },
          sharp: { status: 'pending', version: '', error_message: '' }
        }
      },
      statusSource: 'creative_status_endpoint',
      lastSyncAt: ''
    };
  }

  const providers = {
    openai_creative: normalizeCreativeProviderStatus(creativeStatus.providers?.openai_creative),
    sharp: normalizeCreativeProviderStatus(creativeStatus.providers?.sharp)
  };
  const status = creativeStatus.status === 'live' ? 'live' : creativeStatus.status === 'pending' ? 'pending' : 'error';
  const errorMessage = creativeStatus.error_message || Object.values(providers).find((provider) => provider.status === 'error')?.error_message || definition.missingMessage;
  return {
    ...definition,
    status,
    healthMessage: status === 'live'
      ? 'Creative Engine is live: poster generation and Sharp composition are operational.'
      : status === 'pending'
        ? 'Checking creative providers...'
        : errorMessage,
    matchedProvider: creativeStatus.platform_name || definition.title,
    runtime: 'backend_health_check',
    healthDetails: {
      providers,
      render_pipeline: creativeStatus.render_pipeline || {},
      last_success_at: creativeStatus.last_success_at || ''
    },
    statusSource: 'creative_status_endpoint',
    lastSyncAt: creativeStatus.last_success_at || ''
  };
}

function buildSupabaseStorageAutomationStep(definition, storageStatus, integrationRows = [], source = 'none') {
  const integrationMatch = (integrationRows || []).find((row) => rowMatchesCmoStep(row, definition.integrationKeys));
  const normalizedStorageStatus = storageStatus || (integrationMatch ? {
    platform_key: integrationMatch.platform_key,
    platform_name: integrationMatch.platform_name,
    status: integrationMatch.status,
    bucket: integrationMatch.metadata?.bucket || integrationMatch.metadata?.latest_upload?.bucket || 'cmo-generated-assets',
    error_message: integrationMatch.error_message,
    last_success_at: integrationMatch.metadata?.latest_upload?.upload_timestamp || integrationMatch.last_sync_at,
    source: source || 'platform_integrations',
    health: {
      upload: integrationMatch.metadata?.credentials_verified || integrationMatch.metadata?.latest_upload,
      public_url: integrationMatch.metadata?.public_url_verified || integrationMatch.metadata?.latest_upload?.public_url,
      signed_url: false
    },
    metadata: integrationMatch.metadata || {}
  } : null);

  if (!normalizedStorageStatus) {
    return {
      ...definition,
      status: 'pending',
      healthMessage: 'Checking Supabase Storage connection...',
      matchedProvider: '',
      runtime: 'backend_health_check',
      healthDetails: {
        upload: false,
        public_url: false,
        signed_url: false
      },
      statusSource: 'supabase_storage_health_endpoint',
      lastSyncAt: ''
    };
  }

  const status = normalizedStorageStatus.status === 'live' ? 'live' : normalizedStorageStatus.status === 'pending' ? 'pending' : 'error';
  const latestUpload = normalizedStorageStatus.metadata?.latest_upload || {};
  return {
    ...definition,
    status,
    healthMessage: status === 'live'
      ? 'Supabase Storage is live: upload and public URL retrieval are working.'
      : status === 'pending'
        ? 'Checking Supabase Storage connection...'
        : normalizedStorageStatus.error_message || definition.missingMessage,
    matchedProvider: normalizedStorageStatus.platform_name || definition.title,
    runtime: normalizedStorageStatus.runtime || 'supabase_storage',
    healthDetails: {
      bucket: normalizedStorageStatus.bucket || latestUpload.bucket || 'cmo-generated-assets',
      upload: Boolean(normalizedStorageStatus.health?.upload),
      public_url: Boolean(normalizedStorageStatus.health?.public_url),
      signed_url: Boolean(normalizedStorageStatus.health?.signed_url),
      public_asset_url: latestUpload.public_url || '',
      storage_path: latestUpload.storage_path || '',
      latency_ms: normalizedStorageStatus.latency_ms ?? null,
      last_success_at: normalizedStorageStatus.last_success_at || ''
    },
    statusSource: normalizedStorageStatus.source || 'supabase_storage_health_endpoint',
    lastSyncAt: normalizedStorageStatus.last_success_at || ''
  };
}

async function readCreativeEngineStatus() {
  try {
    if (typeof fetch !== 'function') return null;
    const response = await fetch('/api/integrations/creative/status', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function readSupabaseStorageStatus() {
  const readStatus = async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return response.json();
  };

  try {
    if (typeof fetch !== 'function') return null;
    const relativeStatus = await readStatus('/api/integrations/supabase/storage/status');
    if (relativeStatus) return relativeStatus;
  } catch {
    // Fall through to the local API server fallback below.
  }

  try {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (!['localhost', '127.0.0.1'].includes(host)) return null;
    return await readStatus('http://127.0.0.1:8787/api/integrations/supabase/storage/status');
  } catch {
    return null;
  }
}

async function readSlackApprovalStatus() {
  const readStatus = async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return response.json();
  };

  try {
    if (typeof fetch !== 'function') return null;
    const relativeStatus = await readStatus('/api/slack/approval');
    if (relativeStatus) return relativeStatus;
  } catch {
    // Fall through to the local API server fallback below.
  }

  try {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (!['localhost', '127.0.0.1'].includes(host)) return null;
    return await readStatus('http://127.0.0.1:8787/api/integrations/slack/status');
  } catch {
    return null;
  }
}

function buildSlackApprovalAutomationStep(definition, slackStatus, integrationRows = [], source = 'none') {
  const integrationMatch = (integrationRows || []).find((row) => rowMatchesCmoStep(row, definition.integrationKeys));
  const normalizedSlackStatus = slackStatus || (integrationMatch ? {
    platform_key: integrationMatch.platform_key,
    platform_name: integrationMatch.platform_name,
    status: integrationMatch.status,
    error_message: integrationMatch.error_message,
    runtime: integrationMatch.runtime || 'slack_block_kit',
    last_success_at: integrationMatch.last_sync_at,
    source,
    required_config: integrationMatch.metadata || {}
  } : null);

  if (!normalizedSlackStatus) {
    return {
      ...definition,
      status: 'pending',
      healthMessage: 'Checking Slack approval connection...',
      matchedProvider: '',
      runtime: 'slack_block_kit',
      healthDetails: {},
      statusSource: 'slack_status_endpoint',
      lastSyncAt: ''
    };
  }

  const status = normalizedSlackStatus.status === 'live' ? 'live' : normalizedSlackStatus.status === 'pending' ? 'pending' : 'error';
  return {
    ...definition,
    status,
    healthMessage: status === 'live'
      ? 'Slack Approval is live: approval card config and signature verification source are configured.'
      : status === 'pending'
        ? 'Checking Slack approval connection...'
        : normalizedSlackStatus.error_message || definition.missingMessage,
    matchedProvider: normalizedSlackStatus.platform_name || definition.title,
    runtime: normalizedSlackStatus.runtime || 'slack_block_kit',
    healthDetails: normalizedSlackStatus.required_config || normalizedSlackStatus.metadata || {},
    statusSource: normalizedSlackStatus.source || 'slack_status_endpoint',
    lastSyncAt: normalizedSlackStatus.last_success_at || ''
  };
}

export async function getCmoAutomationFlow() {
  const [schedulerSnapshot, integrationStatus, postingSchedule, creativeStatus, storageStatus, slackStatus] = await Promise.all([
    readCmoSchedulerHealthSnapshot(),
    readCmoIntegrationStatusRows(),
    readCmoPostingScheduleRows(),
    readCreativeEngineStatus(),
    readSupabaseStorageStatus(),
    readSlackApprovalStatus()
  ]);
  const rows = schedulerSnapshot.row
    ? [schedulerSnapshot.row, ...(integrationStatus.rows || []).filter((row) => row.platform_key !== schedulerSnapshot.row.platform_key)]
    : integrationStatus.rows;
  const source = schedulerSnapshot.row ? schedulerSnapshot.source : integrationStatus.source;
  const error = schedulerSnapshot.row ? '' : (schedulerSnapshot.error || integrationStatus.error);
  const postingRows = schedulerSnapshot.postingRows?.length ? schedulerSnapshot.postingRows : postingSchedule.rows;
  const postingError = schedulerSnapshot.postingRows?.length ? '' : postingSchedule.error;
  return serviceResponse({
    source,
    checkedAt: new Date().toISOString(),
    steps: cmoAutomationFlowDefinitions.map((definition) => (
      definition.id === 'creative-engine'
        ? buildCreativeAutomationStep(definition, creativeStatus)
        : definition.id === 'asset-storage'
          ? buildSupabaseStorageAutomationStep(definition, storageStatus, rows, source)
        : definition.id === 'slack-approval'
          ? buildSlackApprovalAutomationStep(definition, slackStatus, rows, source)
        : buildCmoAutomationStep(definition, rows, source, error || postingError, postingRows)
    ))
  });
}

export async function getCmoTimezonePreference() {
  const fallbackTimezone = getSelectedCmoTimezone();
  const fallback = {
    timezone: fallbackTimezone,
    country: getCmoTimezoneOption(fallbackTimezone).country,
    source: 'fallback'
  };
  const { client, error } = requireSupabase();
  if (error) return serviceResponse(fallback);

  const readPreference = async (tableName) => client
    .from(tableName)
    .select('timezone,country,updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  try {
    const timezonePreference = await readPreference('cmo_timezone_preferences');
    if (timezonePreference.data?.timezone) {
      return serviceResponse({
        timezone: getSelectedCmoTimezone({ timezone: timezonePreference.data.timezone }),
        country: timezonePreference.data.country || getCmoTimezoneOption(timezonePreference.data.timezone).country,
        source: 'cmo_timezone_preferences'
      });
    }

    const postingSetting = await readPreference('cmo_posting_settings');
    if (postingSetting.data?.timezone) {
      return serviceResponse({
        timezone: getSelectedCmoTimezone({ timezone: postingSetting.data.timezone }),
        country: postingSetting.data.country || getCmoTimezoneOption(postingSetting.data.timezone).country,
        source: 'cmo_posting_settings'
      });
    }

    return serviceResponse(fallback);
  } catch (error) {
    return serviceErrorResponse(fallback, error);
  }
}

export async function saveCmoTimezonePreference({ tenant_id, timezone, country }) {
  const selectedTimezone = getSelectedCmoTimezone({ timezone });
  const selectedCountry = country || getCmoTimezoneOption(selectedTimezone).country;
  const { client, error } = requireSupabase();
  if (error) return serviceResponse({ timezone: selectedTimezone, country: selectedCountry, source: 'local-fallback' });

  try {
    const { data, error: saveError } = await client
      .from('cmo_timezone_preferences')
      .insert({
        tenant_id,
        timezone: selectedTimezone,
        country: selectedCountry
      })
      .select('timezone,country,updated_at')
      .single();

    if (saveError) return serviceErrorResponse({ timezone: selectedTimezone, country: selectedCountry, source: 'save-failed' }, saveError);
    return serviceResponse({ ...data, source: 'cmo_timezone_preferences' });
  } catch (error) {
    return serviceErrorResponse({ timezone: selectedTimezone, country: selectedCountry, source: 'save-failed' }, error);
  }
}

function normalizePostingPlatform(platform) {
  return platform === 'X/Twitter' ? 'X' : platform;
}

export async function saveCmoPostingSettings({ tenant_id, timezone, country, scheduleMode, postingTime, schedule = [], platforms = [] }) {
  const selectedTimezone = getSelectedCmoTimezone({ timezone });
  const selectedCountry = country || getCmoTimezoneOption(selectedTimezone).country;
  const selectedPlatforms = Array.isArray(platforms) ? platforms : [];
  const mode = scheduleMode === 'Specific days' || scheduleMode === 'specific_days' ? 'specific_days' : 'every_day';
  const scheduleDays = mode === 'specific_days' ? schedule.map((item) => ({
    day: item.day,
    time: item.time || postingTime
  })) : [];
  const fallbackTime = scheduleDays[0]?.time || postingTime || CMO_PLATFORM_DEFAULT_SLOTS.LinkedIn;
  const { client, error } = requireSupabase();
  if (error) return serviceResponse({ source: 'local-fallback', saved: 0, error: error.message });

  const rows = selectedPlatforms.map((platform) => ({
    tenant_id,
    platform: normalizePostingPlatform(platform),
    timezone: selectedTimezone,
    country: selectedCountry,
    local_post_time: fallbackTime,
    schedule_mode: mode,
    schedule_days: scheduleDays,
    trigger_window_minutes: 5,
    approval_required: true
  }));

  if (!rows.length) return serviceResponse({ source: 'cmo_posting_settings', saved: 0 });

  try {
    const { data, error: saveError } = await client
      .from('cmo_posting_settings')
      .upsert(rows, { onConflict: 'tenant_id,platform' })
      .select('id,platform,timezone,local_post_time,schedule_mode,schedule_days');

    if (!saveError) return serviceResponse({ source: 'cmo_posting_settings', saved: data?.length || 0 });

    const fallbackRows = rows.map(({ schedule_mode, schedule_days, trigger_window_minutes, ...row }) => row);
    const fallback = await client
      .from('cmo_posting_settings')
      .upsert(fallbackRows, { onConflict: 'tenant_id,platform' })
      .select('id,platform,timezone,local_post_time');

    if (fallback.error) return serviceErrorResponse({ source: 'save-failed', saved: 0 }, fallback.error);
    return serviceResponse({ source: 'cmo_posting_settings_legacy', saved: fallback.data?.length || 0 });
  } catch (error) {
    return serviceErrorResponse({ source: 'save-failed', saved: 0 }, error);
  }
}

export async function getCmoProviderConnectionStatus(platforms = [], tenantId = demoTenantId) {
  const requestedPlatforms = (Array.isArray(platforms) && platforms.length ? platforms : ['LinkedIn', 'Facebook', 'Instagram', 'YouTube', 'X', 'Blog', 'Email'])
    .map(normalizePublishPlatform)
    .filter(Boolean);
  try {
    const response = await getIntegrations(tenantId);
    const rows = Array.isArray(response.data) ? response.data : [];
    const providerRows = rows.reduce((acc, row) => {
      const keys = [row.id, row.service_name].map(normalizeProviderKey).filter(Boolean);
      keys.forEach((key) => { acc[key] = row; });
      return acc;
    }, {});

    return serviceResponse(requestedPlatforms.map((platform) => {
      const providerKey = platformProviderMap[platform] || normalizeProviderKey(platform);
      const row = providerRows[providerKey];
      const connected = Boolean(row && isProviderConnected(row));
      return {
        platform,
        provider: row?.service_name || providerKey,
        connected,
        status: connected ? 'Connected' : 'Missing credentials',
        message: connected
          ? `${row.service_name || platform} credentials are connected.`
          : `Missing ${platform} provider credentials. Add server-side credentials before publishing.`,
        last_verified: row?.last_verified || 'Not verified'
      };
    }));
  } catch (error) {
    return serviceErrorResponse(requestedPlatforms.map((platform) => ({
      platform,
      provider: platformProviderMap[platform] || platform,
      connected: false,
      status: 'Connection check failed',
      message: `Unable to verify ${platform} provider credentials.`,
      last_verified: 'Not verified'
    })), error);
  }
}

export async function guardCmoPublishAttempt(payload = {}) {
  const tenantId = payload.tenant_id || demoTenantId;
  const platform = normalizePublishPlatform(payload.platform);
  const runId = String(payload.run_id || payload.runId || payload.content_run_id || '').trim();
  const nowUtc = getCmoNowUtc();
  const baseResult = {
    tenant_id: tenantId,
    run_id: runId || null,
    platform: platform || payload.platform || '',
    status: 'blocked',
    live_post_url: payload.live_post_url || payload.post_url || '',
    message: ''
  };

  async function blocked(status, message, metadata = {}) {
    const audit = await writePublishAudit({
      tenantId,
      actionType: 'Publishing attempt blocked',
      platform,
      runId,
      status,
      message,
      metadata,
      riskLevel: status === 'duplicate_publish_blocked' ? 'Medium' : 'High'
    });
    return serviceResponse({ ...baseResult, status, message, audit_ok: Boolean(audit.ok), audit_error: audit.error || null });
  }

  if (!platform) return blocked('invalid_platform', 'Publishing blocked: platform is required.');
  if (!runId) return blocked('missing_run_id', 'Publishing blocked: run ID is required to prevent duplicate publishing.');

  const approvalStatus = payload.approval_status || payload.founder_approval_status || payload.founderApprovalStatus;
  if (!isFounderApprovalApproved(approvalStatus)) {
    return blocked('founder_approval_required', 'Publishing blocked: founder approval must be approved before any platform publish attempt.');
  }
  if ((payload.is_test === true || payload.metadata?.test_mode === true) && !isLocalDevRuntime()) {
    return blocked('test_content_publish_blocked', 'Publishing blocked: test-mode content cannot enter production publishing queue.', { test_mode: true });
  }

  const providerResponse = await getCmoProviderConnectionStatus([platform], tenantId);
  const provider = providerResponse.data?.[0];
  if (!provider?.connected) {
    return blocked('missing_platform_credentials', provider?.message || `Publishing blocked: missing ${platform} platform credentials.`, { provider_status: provider || null });
  }

  const { client, error } = requireSupabase();
  if (error) {
    return blocked('supabase_unavailable', `Publishing blocked: ${error.message}`, { provider_status: provider });
  }

  try {
    const existing = await client
      .from('content_history')
      .select('id,status,publish_status,publish_attempt_count,post_url,live_post_url,metadata')
      .eq('tenant_id', tenantId)
      .eq('platform', platform)
      .eq('run_id', runId)
      .maybeSingle();

    if (existing.error && existing.error.code !== 'PGRST116') {
      return blocked('publish_state_unavailable', `Publishing blocked: unable to verify prior publish state for ${platform}.`, { supabase_error: existing.error.message });
    }

    const existingRow = existing.data;
    if (existingRow?.metadata?.test_mode === true && !isLocalDevRuntime()) {
      return blocked('test_content_publish_blocked', 'Publishing blocked: test-mode content cannot enter production publishing queue.', { content_history_id: existingRow.id, test_mode: true });
    }
    const existingStatus = String(existingRow?.publish_status || existingRow?.status || '').toLowerCase();
    const existingAttempts = Number(existingRow?.publish_attempt_count || 0);
    if (existingRow && !['failed', 'retry_allowed'].includes(existingStatus)) {
      return blocked('duplicate_publish_blocked', `Publishing blocked: run ${runId} already has a ${platform} publish record.`, { content_history_id: existingRow.id });
    }
    if (existingRow && existingAttempts >= CMO_MAX_PUBLISH_ATTEMPTS) {
      return blocked('publish_retry_limit_reached', `Publishing blocked: ${platform} failed ${existingAttempts} times for this run. Manual review required.`, { content_history_id: existingRow.id, attempts: existingAttempts });
    }

    const livePostUrl = payload.live_post_url || payload.post_url || null;
    const confirmedLivePost = Boolean(livePostUrl && (payload.platform_confirmed === true || payload.publish_status === 'published'));
    const contentPayload = {
      tenant_id: tenantId,
      run_id: runId,
      platform,
      content_type: payload.content_type || 'Post',
      campaign_name: payload.campaign_name || payload.campaign || null,
      region_country: payload.region_country || payload.country || null,
      topic: payload.topic || null,
      status: 'Approved',
      generated_at_utc: payload.generated_at_utc || nowUtc,
      approved_at_utc: payload.approved_at_utc || nowUtc,
      generated_text: payload.generated_content || payload.generated_text || '',
      final_text: payload.final_approved_content || payload.final_text || '',
      hashtags: payload.hashtags || null,
      image_url: payload.image_url || null,
      post_url: livePostUrl,
      live_post_url: livePostUrl,
      timezone: getSelectedCmoTimezone({ timezone: payload.timezone }),
      country: payload.country || getCmoTimezoneOption(getSelectedCmoTimezone({ timezone: payload.timezone })).country,
      approval_status: 'approved',
      publish_status: confirmedLivePost ? 'published' : 'ready_for_publish',
      platform_integration_connected: true,
      publish_attempt_count: existingAttempts + 1,
      last_publish_attempt_at: nowUtc,
      last_publish_error: null
    };

    const writeQuery = existingRow
      ? client.from('content_history').update(contentPayload).eq('id', existingRow.id).select('*').single()
      : client.from('content_history').insert(contentPayload).select('*').single();
    const { data, error: writeError } = await writeQuery;

    if (writeError) {
      return blocked('publish_record_failed', `Publishing blocked: content history could not store this publish attempt. ${writeError.message}`, { provider_status: provider });
    }

    const status = contentPayload.publish_status;
    const message = confirmedLivePost
      ? `${platform} publish record stored with confirmed live post URL.`
      : `${platform} publish record stored as ready_for_publish. Live post URL is unavailable or unconfirmed until the platform confirms publication.`;
    const audit = await writePublishAudit({
      tenantId,
      actionType: 'Publishing attempt recorded',
      platform,
      runId,
      status,
      message,
      metadata: { content_history_id: data.id, provider_status: provider },
      riskLevel: 'Medium'
    });

    return serviceResponse({
      ...baseResult,
      id: data.id,
      status,
      message,
      content_history: data,
      audit_ok: Boolean(audit.ok),
      audit_error: audit.error || null
    });
  } catch (error) {
    const audit = await writePublishAudit({
      tenantId,
      actionType: 'Publishing attempt failed',
      platform,
      runId,
      status: 'failed',
      message: error?.message || 'Publishing attempt failed safely.',
      metadata: { error: error?.message || String(error) },
      riskLevel: 'High'
    });
    return serviceErrorResponse({ ...baseResult, status: 'failed', message: 'Publishing attempt failed safely.', audit_ok: Boolean(audit.ok), audit_error: audit.error || null }, error);
  }
}

function normalizeContentHashtags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function normalizePlatformTargets(value, fallbackPlatform = '') {
  if (Array.isArray(value) && value.length) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return fallbackPlatform ? [fallbackPlatform] : [];
}

function buildAiQualityReview(payload = {}) {
  const caption = String(payload.caption || payload.generated_caption || payload.generated_text || '').trim();
  const hashtags = normalizeContentHashtags(payload.hashtags);
  const imagePrompt = String(payload.image_prompt || '').trim();
  const riskFlags = [];
  if (!caption) riskFlags.push('missing_caption');
  if (!hashtags.length) riskFlags.push('missing_hashtags');
  if (!imagePrompt) riskFlags.push('missing_image_prompt');
  if (/(guarantee|best in the world|100%|lowest price|officially certified)/i.test(caption)) riskFlags.push('claim_review_required');
  const qualityScore = Math.max(0, 100 - riskFlags.length * 18);
  return {
    review_status: riskFlags.length ? 'review_required' : 'ready_for_founder_review',
    quality_score: qualityScore,
    brand_safety_score: riskFlags.includes('claim_review_required') ? 72 : 92,
    compliance_score: riskFlags.length ? 76 : 94,
    risk_flags: riskFlags,
    recommendations: riskFlags.length
      ? ['Review missing fields or risky public claims before approval.']
      : ['Ready for founder approval. Publishing remains blocked until Step 6 is explicitly enabled.']
  };
}

export async function saveGeneratedContentPackage(payload = {}) {
  const tenantId = payload.tenant_id || demoTenantId;
  const runId = String(payload.run_id || payload.runId || '').trim();
  const platformTargets = normalizePlatformTargets(payload.platform_targets || payload.platformTargets, payload.platform || 'LinkedIn');
  const primaryPlatform = normalizePublishPlatform(payload.platform || platformTargets[0] || 'LinkedIn');
  const nowUtc = payload.generated_at_utc || getCmoNowUtc();
  const approvalStatus = payload.approval_status || 'pending_approval';
  const hashtags = normalizeContentHashtags(payload.hashtags);
  const caption = String(payload.caption || payload.generated_caption || payload.generated_text || '').trim();
  const imagePrompt = String(payload.image_prompt || '').trim();
  const posterUrl = payload.poster_url || payload.generated_poster_url || payload.image_url || '';
  const aiQualityReview = payload.ai_quality_review || buildAiQualityReview({ ...payload, caption, hashtags, image_prompt: imagePrompt });
  const auditReferences = Array.isArray(payload.audit_references) ? payload.audit_references : [];
  const slackMessageReference = payload.slack_message_reference || {};

  if (!runId) return serviceErrorResponse({ saved: false }, new Error('run_id is required for content memory.'));
  if (!caption || !imagePrompt || !posterUrl) return serviceErrorResponse({ saved: false }, new Error('Generated caption, image prompt, and poster URL are required for content memory.'));

  const { client, error } = requireSupabase();
  if (error) return serviceErrorResponse({ saved: false }, error);

  const historyPayload = {
    tenant_id: tenantId,
    run_id: runId,
    platform: primaryPlatform,
    platform_target: primaryPlatform,
    platform_targets: platformTargets,
    content_type: payload.content_type || 'Post',
    campaign_name: payload.campaign_name || payload.campaign || null,
    region_country: payload.region_country || payload.country || null,
    topic: payload.topic || null,
    caption,
    generated_text: caption,
    final_text: payload.final_text || payload.approved_caption || '',
    final_approved_content: payload.final_approved_content || payload.approved_caption || '',
    hashtags,
    image_prompt: imagePrompt,
    poster_url: posterUrl,
    image_url: posterUrl,
    approval_status: approvalStatus,
    approved_at: payload.approved_at || null,
    approved_at_utc: payload.approved_at_utc || payload.approved_at || null,
    rejected_at: payload.rejected_at || null,
    rejected_at_utc: payload.rejected_at_utc || payload.rejected_at || null,
    slack_message_reference: slackMessageReference,
    publish_status: payload.publish_status || 'not_published',
    live_post_url: null,
    post_url: null,
    audit_references: auditReferences,
    ai_quality_review: aiQualityReview,
    generated_at: nowUtc,
    generated_at_utc: nowUtc,
    scheduled_at_utc: payload.scheduled_at_utc || payload.scheduled_at || null,
    timezone: getSelectedCmoTimezone({ timezone: payload.timezone }),
    country: payload.country || getCmoTimezoneOption(getSelectedCmoTimezone({ timezone: payload.timezone })).country,
    platform_integration_connected: false,
    publish_attempt_count: 0,
    last_publish_attempt_at: null,
    last_publish_error: null,
    metadata: {
      source: payload.source || 'cmo_generated_package',
      no_public_publish: true,
      ...(payload.metadata || {}),
      ...(payload.is_test ? { test_mode: true, is_test: true } : {})
    }
  };

  try {
    const { data: history, error: historyError } = await client
      .from('content_history')
      .upsert(historyPayload, { onConflict: 'tenant_id,run_id,platform' })
      .select('*')
      .single();
    if (historyError) return serviceErrorResponse({ saved: false }, historyError);

    const versions = [
      {
        version_number: 1,
        version_type: 'original',
        caption,
        draft_text: caption,
        final_text: '',
        notes: 'Original AI generated draft.'
      },
      {
        version_number: 2,
        version_type: 'improved',
        caption: payload.improved_caption || caption,
        draft_text: payload.improved_caption || caption,
        final_text: '',
        notes: payload.improved_caption ? 'Improved draft prepared for review.' : 'No improved draft created yet.'
      },
      {
        version_number: 3,
        version_type: 'approved',
        caption: payload.approved_caption || payload.final_approved_content || '',
        draft_text: '',
        final_text: payload.approved_caption || payload.final_approved_content || '',
        approval_status: approvalStatus,
        notes: approvalStatus === 'approved' ? 'Approved content version.' : 'Approved version pending founder approval.'
      }
    ].map((row) => ({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      hashtags,
      image_prompt: imagePrompt,
      poster_url: posterUrl,
      audit_references: auditReferences,
      ...row
    }));
    const { error: versionsError } = await client.from('content_versions').insert(versions);
    if (versionsError) return serviceErrorResponse({ saved: false, content_history_id: history.id }, versionsError);

    const { error: linkError } = await client.from('content_links').insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      platform: primaryPlatform,
      platform_target: primaryPlatform,
      link_type: 'poster',
      label: 'Generated poster preview',
      url: posterUrl,
      poster_url: posterUrl,
      publish_status: 'not_published',
      timezone: historyPayload.timezone,
      country: historyPayload.country,
      audit_references: auditReferences
    });
    if (linkError) return serviceErrorResponse({ saved: false, content_history_id: history.id }, linkError);

    const { error: approvalError } = await client.from('content_approvals').insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      approval_status: approvalStatus,
      status: approvalStatus === 'approved' ? 'Approved' : approvalStatus === 'rejected' ? 'Rejected' : 'Pending',
      approved_at: historyPayload.approved_at,
      approved_at_utc: historyPayload.approved_at_utc,
      rejected_at: historyPayload.rejected_at,
      rejected_at_utc: historyPayload.rejected_at_utc,
      slack_approval_id: payload.slack_approval_id || slackMessageReference.approval_id || '',
      slack_message_reference: slackMessageReference,
      audit_references: auditReferences,
      notes: payload.approval_notes || 'Founder approval pending. Publishing is blocked.',
      timezone: historyPayload.timezone,
      country: historyPayload.country
    });
    if (approvalError) return serviceErrorResponse({ saved: false, content_history_id: history.id }, approvalError);

    const { error: qualityError } = await client.from('content_quality_reviews').insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      run_id: runId,
      review_status: aiQualityReview.review_status,
      quality_score: aiQualityReview.quality_score,
      brand_safety_score: aiQualityReview.brand_safety_score,
      compliance_score: aiQualityReview.compliance_score,
      risk_flags: aiQualityReview.risk_flags || [],
      recommendations: aiQualityReview.recommendations || [],
      audit_references: auditReferences
    });
    if (qualityError) return serviceErrorResponse({ saved: false, content_history_id: history.id }, qualityError);

    const { error: memoryError } = await client.from('ai_content_memory').insert({
      tenant_id: tenantId,
      content_history_id: history.id,
      platform: primaryPlatform,
      prompt: imagePrompt,
      generated_version: caption,
      approved_version: payload.approved_caption || payload.final_approved_content || '',
      rejected_version: approvalStatus === 'rejected' ? caption : '',
      rejection_reason: payload.rejection_reason || '',
      ai_reasoning: 'Stored before publishing so future approvals and public posts have reliable operational memory.',
      quality_review: aiQualityReview
    });
    if (memoryError) return serviceErrorResponse({ saved: false, content_history_id: history.id }, memoryError);

    return serviceResponse({ saved: true, content_history_id: history.id, run_id: runId, platform: primaryPlatform });
  } catch (error) {
    return serviceErrorResponse({ saved: false }, error);
  }
}

export async function getContentMemoryArchive(filters = {}) {
  const selectedTimezone = getSelectedCmoTimezone({ timezone: filters.timezone || DEFAULT_CMO_TIMEZONE });
  const emptyArchive = {
    items: [],
    connected: backendStatus.mode === 'Connected',
    error: '',
    timezone: selectedTimezone,
    loadedAt: getCmoNowUtc()
  };
  const { client, error } = requireSupabase();
  if (error) return serviceResponse({ ...emptyArchive, connected: false, error: error.message });

  try {
    let query = client
      .from('content_history')
      .select(`
        *,
        content_versions(*),
        content_links(*),
        content_metrics(*),
        content_approvals(*),
        ai_generation_logs(*),
        content_quality_reviews(*),
        ai_content_memory(*)
      `)
      .order('generated_at_utc', { ascending: false, nullsFirst: false })
      .limit(120);

    if (filters.selectedDate) {
      const range = getCmoDateRangeUtc(filters.selectedDate, selectedTimezone);
      query = query
        .gte('generated_at_utc', range.startUtc)
        .lte('generated_at_utc', range.endUtc);
    }

    const { data, error: queryError } = await query;

    if (queryError) {
      return serviceErrorResponse(emptyArchive, queryError);
    }

    return serviceResponse({
      ...emptyArchive,
      items: Array.isArray(data) ? data : []
    });
  } catch (error) {
    return serviceErrorResponse(emptyArchive, error);
  }
}

export async function getCmoLearningCentreDashboard(tenantId = demoTenantId) {
  const emptyDashboard = {
    connected: backendStatus.mode === 'Connected',
    filters: [],
    findings: [],
    statusCards: [
      { label: 'Research findings', value: 0 },
      { label: 'Pattern library', value: 0 },
      { label: 'Strategy memory', value: 0 },
      { label: 'Latest source', value: 'Not recorded' }
    ],
    growthPlan: {
      followerGoal: '100,000 followers in 1 month',
      goalNote: 'Growth target only. No results are claimed without connected platform analytics.',
      strategy: [],
      warningRules: []
    },
    error: ''
  };
  const { client, error } = requireSupabase();
  if (error) return serviceResponse({ ...emptyDashboard, connected: false, error: error.message });

  try {
    const [findingsResult, patternResult, strategyResult] = await Promise.all([
      client
        .from('content_research_findings')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(25),
      client
        .from('content_pattern_library')
        .select('id, platform, pattern_type, created_at')
        .eq('tenant_id', tenantId)
        .limit(50),
      client
        .from('cmo_strategy_memory')
        .select('id, strategy_type, recommendation, avoid_rule, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20)
    ]);

    const queryError = findingsResult.error || patternResult.error || strategyResult.error;
    if (queryError) return serviceErrorResponse(emptyDashboard, queryError);

    const rows = Array.isArray(findingsResult.data) ? findingsResult.data : [];
    const patterns = Array.isArray(patternResult.data) ? patternResult.data : [];
    const strategyRows = Array.isArray(strategyResult.data) ? strategyResult.data : [];
    const filters = Array.from(new Set(rows.map((row) => row.platform || row.source_platform || row.content_category || row.topic).filter(Boolean))).slice(0, 8);
    const latest = rows[0] || {};

    return serviceResponse({
      ...emptyDashboard,
      connected: true,
      filters,
      findings: rows.map((row) => ({
        id: row.id,
        sourcePlatform: row.platform || row.source_platform || 'Unknown platform',
        companyName: row.company_name || row.source_name || row.brand_name || 'Source not recorded',
        sourceDomain: row.source_domain || '',
        sourceUrl: row.source_url || '',
        topic: row.topic || row.research_topic || 'Topic not recorded',
        contentCategory: row.content_category || row.category || '',
        learningSummary: row.learning_summary || row.summary || row.insight || '',
        gopuLearning: row.gopu_learning || row.recommendation || row.learning_summary || '',
        visualStyle: row.visual_style || row.format || '',
        captionStyle: row.caption_style || row.copy_style || '',
        hashtagsUsed: Array.isArray(row.hashtags_used) ? row.hashtags_used : [],
        engagementSignals: row.engagement_signals || row.performance_signal || '',
        whyPerformedWell: row.why_performed_well || row.reason || '',
        avoid: row.avoid || row.avoid_rule || '',
        confidenceScore: row.confidence_score ?? 0,
        recordedAt: row.recorded_at || row.created_at || row.updated_at
      })),
      statusCards: [
        { label: 'Research findings', value: rows.length },
        { label: 'Pattern library', value: patterns.length },
        { label: 'Strategy memory', value: strategyRows.length },
        { label: 'Latest source', value: latest.source_domain || latest.source_url || 'Not recorded' }
      ],
      growthPlan: {
        ...emptyDashboard.growthPlan,
        strategy: strategyRows.map((row) => row.recommendation || row.strategy_type).filter(Boolean).slice(0, 5),
        warningRules: strategyRows.map((row) => row.avoid_rule).filter(Boolean).slice(0, 5)
      }
    });
  } catch (error) {
    return serviceErrorResponse(emptyDashboard, error);
  }
}

function normalizeFounderDecisionAction(action = '') {
  const value = String(action || '').toLowerCase();
  if (value.includes('approve')) {
    return {
      action: 'approve',
      approvalStatus: 'approved',
      approvalLabel: 'Approved',
      publishStatus: 'queued',
      finalStatus: 'ready_for_publish',
      note: 'Founder approved content. Publishing queue can accept this item.'
    };
  }
  if (value.includes('edit') || value.includes('reject')) {
    return {
      action: 'needs_edit',
      approvalStatus: 'needs_edit',
      approvalLabel: 'Needs Edit',
      publishStatus: 'needs_edit',
      finalStatus: 'needs_edit',
      note: 'Founder sent content back for edit. Publishing remains blocked.'
    };
  }
  return {
    action: 'hold',
    approvalStatus: 'hold',
    approvalLabel: 'Hold',
    publishStatus: 'hold',
    finalStatus: 'hold',
    note: 'Founder held the queue. Content remains waiting and unpublished.'
  };
}

export async function updateFounderContentDecision(contentHistoryId, action, options = {}) {
  const id = String(contentHistoryId || '').trim();
  if (!id) return serviceErrorResponse({ updated: false }, new Error('No content item is selected for founder decision.'));
  const { client, error } = requireSupabase();
  if (error) return serviceErrorResponse({ updated: false }, error);

  const decision = normalizeFounderDecisionAction(action);
  const decidedAt = getCmoNowUtc();
  const tenantId = options.tenant_id || demoTenantId;
  const note = options.note || decision.note;
  const existing = await client
    .from('content_history')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') {
    return serviceErrorResponse({ updated: false }, existing.error);
  }
  const existingMetadata = existing.data?.metadata && typeof existing.data.metadata === 'object' ? existing.data.metadata : {};
  const existingHasCurrentStep = Object.prototype.hasOwnProperty.call(existing.data || {}, 'current_step');
  const existingHasWorkflowStage = Object.prototype.hasOwnProperty.call(existing.data || {}, 'workflow_stage');
  const existingHasStatus = Object.prototype.hasOwnProperty.call(existing.data || {}, 'status');
  const nextStep = decision.action === 'approve' ? 7 : 6;
  const workflowStage = decision.action === 'approve' ? 'publishing' : decision.action === 'needs_edit' ? 'content_edit' : 'approval_hold';
  const baseHistoryPatch = {
    approval_status: decision.approvalStatus,
    publish_status: decision.publishStatus,
    updated_at: decidedAt,
    metadata: {
      ...existingMetadata,
      current_step: nextStep,
      workflow_stage: workflowStage,
      founder_decision: decision.action,
      founder_decision_at: decidedAt,
      no_public_publish_from_step_6_ui: true
    }
  };
  if (existingHasCurrentStep) baseHistoryPatch.current_step = nextStep;
  if (existingHasWorkflowStage) baseHistoryPatch.workflow_stage = workflowStage;
  if (existingHasStatus) baseHistoryPatch.status = workflowStage;

  const historyPatch = decision.action === 'approve'
    ? {
        ...baseHistoryPatch,
        approved_at: decidedAt,
        approved_at_utc: decidedAt,
        rejected_at: null,
        rejected_at_utc: null
      }
    : decision.action === 'needs_edit'
      ? {
          ...baseHistoryPatch,
          rejected_at: decidedAt,
          rejected_at_utc: decidedAt
        }
      : baseHistoryPatch;

  try {
    const { data: history, error: historyError } = await client
      .from('content_history')
      .update(historyPatch)
      .eq('id', id)
      .select('*')
      .single();
    if (historyError) return serviceErrorResponse({ updated: false }, historyError);

    const approvalPatch = {
      approval_status: decision.approvalStatus,
      status: decision.approvalLabel,
      notes: note,
      timezone: history.timezone || getSelectedCmoTimezone({ timezone: options.timezone }),
      country: history.country || getCmoTimezoneOption(getSelectedCmoTimezone({ timezone: options.timezone })).country
    };
    if (decision.action === 'approve') {
      approvalPatch.approved_at = decidedAt;
      approvalPatch.approved_at_utc = decidedAt;
      approvalPatch.rejected_at = null;
      approvalPatch.rejected_at_utc = null;
    }
    if (decision.action === 'needs_edit') {
      approvalPatch.rejected_at = decidedAt;
      approvalPatch.rejected_at_utc = decidedAt;
    }

    const { data: existingApprovals, error: approvalReadError } = await client
      .from('content_approvals')
      .select('id')
      .eq('content_history_id', id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (approvalReadError) return serviceErrorResponse({ updated: false, content_history: history }, approvalReadError);

    const approvalId = existingApprovals?.[0]?.id;
    const approvalWrite = approvalId
      ? client.from('content_approvals').update(approvalPatch).eq('id', approvalId).select('*').single()
      : client.from('content_approvals').insert({
          tenant_id: history.tenant_id || tenantId,
          content_history_id: id,
          run_id: history.run_id,
          ...approvalPatch
        }).select('*').single();
    const { data: approval, error: approvalError } = await approvalWrite;
    if (approvalError) return serviceErrorResponse({ updated: false, content_history: history }, approvalError);

    const audit = await createAuditLog({
      tenant_id: history.tenant_id || tenantId,
      action_type: `CMO founder decision ${decision.action}`,
      module: 'AI CMO Workflow',
      related_table: 'content_history',
      related_record_id: id,
      actor: 'Founder OS',
      description: note,
      risk_level: decision.action === 'approve' ? 'Medium' : 'Low',
      metadata: {
        content_history_id: id,
        run_id: history.run_id,
        platform: history.platform,
        approval_status: decision.approvalStatus,
        publish_status: decision.publishStatus,
        no_public_publish: true
      }
    });

    return serviceResponse({
      updated: true,
      decision: decision.action,
      approval_status: decision.approvalStatus,
      publish_status: decision.publishStatus,
      content_history: {
        ...history,
        content_approvals: approval ? [approval] : history.content_approvals || []
      },
      audit_ok: audit?.ok !== false
    });
  } catch (error) {
    return serviceErrorResponse({ updated: false }, error);
  }
}

export async function createStep6TestContentPackage() {
  if (!isLocalDevRuntime()) return serviceErrorResponse({ saved: false }, new Error('Step 6 test mode is available only in local development.'));
  const scheduledAt = DateTime.utc().plus({ hours: 2 }).toISO();
  const runId = `dev-step6-${Date.now()}`;
  const posterSvg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <rect width="1200" height="675" fill="#071015"/>
      <linearGradient id="g" x1="0" x2="1"><stop stop-color="#2ef2ff" stop-opacity=".22"/><stop offset="1" stop-color="#ffbf69" stop-opacity=".2"/></linearGradient>
      <rect x="70" y="70" width="1060" height="535" rx="28" fill="url(#g)" stroke="#2ef2ff" stroke-opacity=".32"/>
      <text x="105" y="165" fill="#2ef2ff" font-family="Arial" font-size="30" font-weight="700">DEV TEST CONTENT</text>
      <text x="105" y="270" fill="#f4f9fb" font-family="Arial" font-size="58" font-weight="700">Founder Decision Review</text>
      <text x="105" y="345" fill="#b8c4d5" font-family="Arial" font-size="32">Real Supabase row, blocked from production publishing.</text>
      <text x="105" y="515" fill="#ffd37a" font-family="Arial" font-size="28">GOPU OS Step 6 Test Mode</text>
    </svg>
  `);
  const result = await saveGeneratedContentPackage({
    run_id: runId,
    platform: 'LinkedIn',
    platform_targets: ['LinkedIn', 'Instagram', 'Facebook'],
    content_type: 'Post',
    campaign_name: 'DEV Step 6 approval test',
    topic: 'Founder-led export trust systems',
    caption: 'Indian agri exporters win global buyer trust when pricing, documentation, shipment readiness, and founder approval gates work together. GOPU OS keeps content draft-only until the founder approves the final version.',
    hashtags: ['#AgriExport', '#FounderLed', '#GlobalTrade', '#GOPUOS'],
    image_prompt: 'Premium dark export-tech founder OS poster showing global trade routes, approval shield, and agri export operations command center.',
    poster_url: `data:image/svg+xml;charset=utf-8,${posterSvg}`,
    approval_status: 'waiting',
    publish_status: 'pending',
    scheduled_at_utc: scheduledAt,
    timezone: DEFAULT_CMO_TIMEZONE,
    country: 'India',
    is_test: true,
    metadata: {
      test_mode: true,
      is_test: true,
      dev_only: true,
      step: 6,
      cleanup_key: runId,
      production_publish_blocked: true
    },
    source: 'step_6_dev_test_mode'
  });
  if (!result.ok) return result;

  const archive = await getContentMemoryArchive({ timezone: DEFAULT_CMO_TIMEZONE });
  return serviceResponse({
    ...result.data,
    archive: archive.data,
    created_count: 1
  });
}

export async function cleanupLatestStep6TestContentPackage() {
  if (!isLocalDevRuntime()) return serviceErrorResponse({ deleted: false }, new Error('Step 6 cleanup is available only in local development.'));
  const { client, error } = requireSupabase();
  if (error) return serviceErrorResponse({ deleted: false }, error);
  try {
    const { data: rows, error: readError } = await client
      .from('content_history')
      .select('id,run_id,tenant_id')
      .contains('metadata', { test_mode: true, step: 6 })
      .order('created_at', { ascending: false })
      .limit(1);
    if (readError) return serviceErrorResponse({ deleted: false }, readError);
    const target = rows?.[0];
    if (!target) return serviceResponse({ deleted: false, message: 'No Step 6 test content package found.' });

    const cleanup = { content_history_id: target.id, deleted: true, related: {}, errors: [] };
    for (const table of ['content_approvals', 'content_links', 'content_versions', 'content_quality_reviews', 'ai_content_memory']) {
      const { error: deleteError } = await client.from(table).delete().eq('content_history_id', target.id);
      cleanup.related[table] = !deleteError;
      if (deleteError) cleanup.errors.push(`${table}: ${deleteError.message}`);
    }
    const auditDelete = await client
      .from('audit_logs')
      .delete()
      .eq('related_table', 'content_history')
      .eq('related_record_id', target.id);
    cleanup.related.audit_logs = !auditDelete.error;
    if (auditDelete.error) cleanup.errors.push(`audit_logs: ${auditDelete.error.message}`);

    const { error: historyDeleteError } = await client.from('content_history').delete().eq('id', target.id);
    cleanup.related.content_history = !historyDeleteError;
    if (historyDeleteError) cleanup.errors.push(`content_history: ${historyDeleteError.message}`);

    const archive = await getContentMemoryArchive({ timezone: DEFAULT_CMO_TIMEZONE });
    return serviceResponse({ ...cleanup, archive: archive.data });
  } catch (error) {
    return serviceErrorResponse({ deleted: false }, error);
  }
}

const growthPlatforms = ['LinkedIn', 'Facebook', 'Instagram', 'YouTube', 'X/Twitter'];

const metricAliases = {
  views: 'views',
  view: 'views',
  video_views: 'views',
  likes: 'likes',
  like: 'likes',
  reactions: 'likes',
  comments: 'comments',
  comment: 'comments',
  shares: 'shares',
  share: 'shares',
  clicks: 'clicks',
  click: 'clicks',
  link_clicks: 'clicks',
  saves: 'saves',
  save: 'saves',
  impressions: 'impressions',
  impression: 'impressions',
  reach: 'reach',
  followers: 'followers',
  follower_count: 'followers',
  follower_growth: 'followerGrowth',
  engagement: 'engagement',
  engagement_rate: 'engagementRate'
};

const emptyGrowthAnalytics = (timezone = DEFAULT_CMO_TIMEZONE) => ({
  connected: false,
  partialData: false,
  timezone,
  periodLabel: 'Last 30 days',
  currentStart: '',
  currentEnd: '',
  previousStart: '',
  previousEnd: '',
  summaryCards: [],
  platforms: growthPlatforms.map((platform) => ({
    platform,
    views: 0,
    likes: 0,
    comments: 0,
    engagementRate: null,
    change: 0,
    status: 'Stable',
    hasData: false
  })),
  diagnosis: {
    increasing: 'No connected metrics yet.',
    decreasing: 'No connected metrics yet.',
    bestPlatform: 'No connected metrics yet.',
    weakestPlatform: 'No connected metrics yet.',
    bestTopic: 'No connected metrics yet.',
    contentGap: 'Connect platform metrics to identify content gaps.',
    nextAction: 'Connect platform metrics to activate AI growth recommendations.'
  },
  dataWarnings: [],
  loadedAt: getCmoNowUtc()
});

function normalizeMetricName(metricName = '') {
  const key = String(metricName).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return metricAliases[key] || key;
}

function normalizeGrowthPlatform(platform = '') {
  const value = String(platform).trim().toLowerCase();
  if (value === 'x' || value === 'twitter' || value === 'x/twitter') return 'X/Twitter';
  if (value === 'linkedin' || value === 'linked in') return 'LinkedIn';
  if (value === 'facebook' || value === 'meta facebook') return 'Facebook';
  if (value === 'instagram' || value === 'meta instagram') return 'Instagram';
  if (value === 'youtube' || value === 'you tube') return 'YouTube';
  return platform || 'Unknown';
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getPeriodBoundaries(filters = {}) {
  const selectedTimezone = getSelectedCmoTimezone({ timezone: filters.timezone || DEFAULT_CMO_TIMEZONE });
  const selectedDateRange = filters.selectedDate ? getCmoDateRangeUtc(filters.selectedDate, selectedTimezone) : null;
  const rangeDays = selectedDateRange ? 1 : Math.max(1, Number(filters.rangeDays) || 30);
  const currentEndDate = selectedDateRange ? new Date(selectedDateRange.endUtc) : filters.endDate ? new Date(filters.endDate) : new Date();
  if (Number.isNaN(currentEndDate.getTime())) currentEndDate.setTime(Date.now());
  const currentStartDate = selectedDateRange ? new Date(selectedDateRange.startUtc) : new Date(currentEndDate);
  if (!selectedDateRange) currentStartDate.setUTCDate(currentStartDate.getUTCDate() - rangeDays);
  const previousEndDate = new Date(currentStartDate);
  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setUTCDate(previousStartDate.getUTCDate() - rangeDays);

  return {
    rangeDays,
    currentStart: currentStartDate.toISOString(),
    currentEnd: currentEndDate.toISOString(),
    previousStart: previousStartDate.toISOString(),
    previousEnd: previousEndDate.toISOString()
  };
}

function isWithinPeriod(value, start, end) {
  if (!value) return false;
  const time = new Date(value).getTime();
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Number.isFinite(time) && Number.isFinite(startTime) && Number.isFinite(endTime) && time >= startTime && time < endTime;
}

function getChange(current, previous) {
  if (!previous && !current) return 0;
  if (!previous && current) return 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function getTrendStatus(change) {
  if (change > 3) return 'Increasing';
  if (change < -3) return 'Decreasing';
  return 'Stable';
}

function createMetricBucket() {
  return {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    clicks: 0,
    saves: 0,
    impressions: 0,
    reach: 0,
    followers: 0,
    followerGrowth: 0,
    engagement: 0,
    metricCount: 0,
    topics: {}
  };
}

function addMetricToBucket(bucket, row) {
  const metricName = normalizeMetricName(row.metric_name);
  if (!Object.prototype.hasOwnProperty.call(bucket, metricName)) return;
  const value = toNumber(row.metric_value);
  bucket[metricName] += value;
  bucket.metricCount += 1;

  const topic = row.content_history?.topic;
  if (topic) {
    bucket.topics[topic] = bucket.topics[topic] || createMetricBucket();
    bucket.topics[topic][metricName] += value;
    bucket.topics[topic].metricCount += 1;
  }
}

function getEngagementRate(bucket) {
  if (bucket.engagementRate) return bucket.engagementRate;
  const engagementTotal = bucket.engagement || bucket.likes + bucket.comments + bucket.shares + bucket.clicks + bucket.saves;
  const denominator = bucket.views || bucket.impressions || bucket.reach;
  if (!denominator) return null;
  return (engagementTotal / denominator) * 100;
}

function buildSummaryCard(label, key, currentBucket, previousBucket, formatter = 'number') {
  const current = key === 'engagementRate' ? getEngagementRate(currentBucket) : currentBucket[key];
  const previous = key === 'engagementRate' ? getEngagementRate(previousBucket) : previousBucket[key];
  const safeCurrent = current ?? 0;
  const safePrevious = previous ?? 0;
  const change = getChange(safeCurrent, safePrevious);
  return {
    label,
    key,
    formatter,
    current: current ?? null,
    previous: previous ?? null,
    change,
    status: getTrendStatus(change),
    hasData: current !== null && (safeCurrent > 0 || safePrevious > 0)
  };
}

function getTopTopic(topics) {
  const scoredTopics = Object.entries(topics).map(([topic, bucket]) => {
    const score = bucket.engagement || bucket.likes + bucket.comments + bucket.shares + bucket.clicks + bucket.saves || bucket.views;
    return [topic, score];
  }).filter(([, score]) => score > 0);
  return scoredTopics.sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function buildGrowthDiagnosis(summaryCards, platforms, currentBucket, dataWarnings) {
  const increasing = summaryCards.filter((card) => card.hasData && card.status === 'Increasing').map((card) => card.label);
  const decreasing = summaryCards.filter((card) => card.hasData && card.status === 'Decreasing').map((card) => card.label);
  const rankedPlatforms = platforms
    .filter((platform) => platform.hasData)
    .map((platform) => ({
      ...platform,
      score: platform.engagementRate ?? platform.views
    }))
    .sort((a, b) => b.score - a.score);
  const bestPlatform = rankedPlatforms[0]?.platform || '';
  const weakestPlatform = rankedPlatforms.length > 1 ? rankedPlatforms[rankedPlatforms.length - 1].platform : '';
  const bestTopic = getTopTopic(currentBucket.topics);
  const missingPlatform = platforms.find((platform) => !platform.hasData)?.platform;
  const missingMetric = summaryCards.find((card) => !card.hasData)?.label;
  const contentGap = missingPlatform
    ? `${missingPlatform} metrics are not connected for this period.`
    : missingMetric
      ? `${missingMetric} tracking is incomplete for this period.`
      : 'No major metric gap detected in the connected data.';
  const nextAction = bestPlatform && bestTopic
    ? `Use ${bestPlatform} as the next growth priority and publish more ${bestTopic} content backed by live metric tracking.`
    : bestPlatform
      ? `Use ${bestPlatform} as the next growth priority and connect topic-level content history for sharper recommendations.`
      : 'Connect platform metrics to activate AI growth recommendations.';

  return {
    increasing: increasing.length ? increasing.join(', ') : 'No connected growth metric is increasing above 3%.',
    decreasing: decreasing.length ? decreasing.join(', ') : 'No connected growth metric is decreasing below -3%.',
    bestPlatform: bestPlatform || 'No platform has enough connected data yet.',
    weakestPlatform: weakestPlatform || 'No platform has enough connected data yet.',
    bestTopic: bestTopic || 'No topic has enough connected metric data yet.',
    contentGap,
    nextAction,
    partialNotice: dataWarnings.length ? 'Partial data available. Insights may be limited.' : ''
  };
}

export async function getSocialGrowthAnalytics(filters = {}) {
  const timezone = getSelectedCmoTimezone({ timezone: filters.timezone || DEFAULT_CMO_TIMEZONE });
  const empty = emptyGrowthAnalytics(timezone);
  const { client, error } = requireSupabase();
  if (error) return serviceResponse({ ...empty, connected: false, dataWarnings: [error.message] });

  const periods = getPeriodBoundaries(filters);
  const currentBucket = createMetricBucket();
  const previousBucket = createMetricBucket();
  const platformBuckets = growthPlatforms.reduce((acc, platform) => {
    acc[platform] = { current: createMetricBucket(), previous: createMetricBucket() };
    return acc;
  }, {});
  const dataWarnings = [];

  try {
    const { data: metricRows, error: metricError } = await client
      .from('content_metrics')
      .select('id,platform,metric_name,metric_value,metric_unit,captured_at,content_history(platform,topic,published_at,status)')
      .gte('captured_at', periods.previousStart)
      .lte('captured_at', periods.currentEnd)
      .order('captured_at', { ascending: true })
      .limit(2000);

    if (metricError) {
      return serviceErrorResponse(empty, metricError);
    }

    const rows = Array.isArray(metricRows) ? metricRows : [];
    rows.forEach((row) => {
      const platform = normalizeGrowthPlatform(row.platform || row.content_history?.platform);
      const periodKey = isWithinPeriod(row.captured_at, periods.currentStart, periods.currentEnd)
        ? 'current'
        : isWithinPeriod(row.captured_at, periods.previousStart, periods.previousEnd)
          ? 'previous'
          : '';
      if (!periodKey) return;

      addMetricToBucket(periodKey === 'current' ? currentBucket : previousBucket, row);
      if (platformBuckets[platform]) addMetricToBucket(platformBuckets[platform][periodKey], row);
    });

    const summaryCards = [
      buildSummaryCard('Total Views', 'views', currentBucket, previousBucket),
      buildSummaryCard('Total Likes', 'likes', currentBucket, previousBucket),
      buildSummaryCard('Total Comments', 'comments', currentBucket, previousBucket),
      buildSummaryCard('Total Shares', 'shares', currentBucket, previousBucket),
      buildSummaryCard('Total Clicks', 'clicks', currentBucket, previousBucket),
      buildSummaryCard('Engagement Rate', 'engagementRate', currentBucket, previousBucket, 'percent'),
      buildSummaryCard('Follower Growth', 'followerGrowth', currentBucket, previousBucket)
    ];

    const platforms = growthPlatforms.map((platform) => {
      const current = platformBuckets[platform].current;
      const previous = platformBuckets[platform].previous;
      const engagementRate = getEngagementRate(current);
      const previousEngagementRate = getEngagementRate(previous);
      const change = getChange(engagementRate ?? current.views, previousEngagementRate ?? previous.views);
      return {
        platform,
        views: current.views,
        likes: current.likes,
        comments: current.comments,
        engagementRate,
        previousEngagementRate,
        change,
        status: getTrendStatus(change),
        hasData: current.metricCount > 0 || previous.metricCount > 0
      };
    });

    if (rows.length && summaryCards.some((card) => !card.hasData)) {
      dataWarnings.push('Some requested metrics are not connected for the selected comparison window.');
    }
    if (rows.length && platforms.some((platform) => !platform.hasData)) {
      dataWarnings.push('Some platform metrics are not connected for the selected comparison window.');
    }

    return serviceResponse({
      ...empty,
      connected: rows.length > 0,
      partialData: dataWarnings.length > 0,
      periodLabel: `Last ${periods.rangeDays} days`,
      currentStart: periods.currentStart,
      currentEnd: periods.currentEnd,
      previousStart: periods.previousStart,
      previousEnd: periods.previousEnd,
      summaryCards,
      platforms,
      diagnosis: buildGrowthDiagnosis(summaryCards, platforms, currentBucket, dataWarnings),
      dataWarnings
    });
  } catch (error) {
    return serviceErrorResponse(empty, error);
  }
}

export async function generateDailyGrowthRunbook() {
  return serviceResponse([
    'Daily growth runbook:',
    '1. OpenAI Brain: generate Tenglish strategy from COO, CIO, CFO, and CTO operational inputs.',
    '2. YouTube: draft an 18-minute founder-led authority video with real export examples and premium thumbnail direction.',
    '3. LinkedIn: publish one major Tenglish authority post and queue additional export/business insights.',
    '4. Instagram/Facebook: create educational export content with operational trust, not cheap viral entertainment.',
    '5. Campaign targeting: segment UAE, GCC, Europe, ASEAN, USA, Africa, LATAM, and Australia importer audiences.',
    '6. Optimization: review watch-time, click-through, engagement, importer signals, country response, and topic performance placeholders.',
    '7. Approval control: route claims, budgets, sensitive wording, and brand-risk content before publishing.'
  ].join('\n'));
}

export async function generateCMOReport() {
  return serviceResponse('CMO report ready: content and campaign states are draft-controlled. Live analytics are awaiting connected platform data.');
}

export async function generateFounderMarketingSummary() {
  return serviceResponse('Founder marketing summary: CMO is positioned for Tenglish export authority content, premium thumbnail direction, and worldwide targeting across UAE, GCC, Europe, ASEAN, USA, Africa, LATAM, and Australia. Keep claims proof-backed, keep campaign budgets CFO-controlled, and connect analytics before reporting live performance.');
}
