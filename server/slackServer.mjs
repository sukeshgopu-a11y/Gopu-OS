import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import handleContentQualityGenerate from '../api/cmo/content-quality/generate.js';
import handleContentQualityReview from '../api/cmo/content-quality/review.js';
import handleSchedulerHealth from '../api/cmo/scheduler-health.js';
import { getCreativeEngineStatus } from '../lib/creativeStatus.mjs';
import {
  handleLearningCentreFindings,
  handleLearningCentreReport,
  handleLearningCentreSafeTest,
  handleLearningCentreSetup,
  handleLearningCentreStart,
  handleLearningCentreStatus,
  handleLearningCentreStop
} from '../lib/learningCentreApiHandlers.mjs';
import { getOpenAIStatus } from '../lib/openaiStatus.mjs';
import { getSupabaseStorageStatus } from '../lib/supabaseStorageStatus.mjs';
import { getVercelStatus } from '../lib/vercelStatus.mjs';

const port = Number(process.env.SLACK_NOTIFICATION_PORT || 8787);
const allowedTypes = new Set([
  'New Lead',
  'New Shipment Created',
  'Shipment Delayed',
  'Renewal Expiring Soon',
  'Renewal Expired',
  'Payment Received',
  'High Priority Alert',
  'Founder Approval Required'
]);
const allowedPriorities = new Set(['INFO', 'WARNING', 'URGENT']);
const sentSlackNotificationKeys = new Set();
const processedSlackApprovalKeys = new Set();
const demoTenantId = '11111111-1111-1111-1111-111111111111';

function loadLocalEnv() {
  for (const file of ['.env', '.env.local']) {
    const target = path.resolve(process.cwd(), file);
    if (!fs.existsSync(target)) continue;
    const rows = fs.readFileSync(target, 'utf8').split(/\r?\n/);
    for (const row of rows) {
      const match = row.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function isValidSlackWebhook(url = '') {
  return /^https:\/\/hooks\.slack(?:-gov)?\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9_-]+$/i.test(url);
}

function isValidSlackBotToken(token = '') {
  return /^xoxb-[A-Za-z0-9-]+$/i.test(token);
}

function isValidSlackChannelId(channelId = '') {
  return /^[CGD][A-Z0-9]+$/i.test(channelId);
}

function getAllowedOrigin(requestOrigin = '') {
  if (!requestOrigin) return '*';
  const configuredOrigin = process.env.SLACK_ALLOWED_ORIGIN || 'http://127.0.0.1:5173';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)) return requestOrigin;
  return configuredOrigin;
}

function sendJson(response, statusCode, payload, requestOrigin = '') {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getAllowedOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Slack-Signature, X-Slack-Request-Timestamp'
  });
  response.end(JSON.stringify(payload));
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function normalizePayload(payload = {}) {
  const type = allowedTypes.has(payload.type) ? payload.type : 'High Priority Alert';
  const priority = allowedPriorities.has(String(payload.priority || '').toUpperCase()) ? String(payload.priority).toUpperCase() : 'INFO';
  return {
    type,
    priority,
    reference: normalizeText(payload.reference, 'GOPU-OS'),
    buyer: normalizeText(payload.buyer, 'GOPU OS'),
    status: normalizeText(payload.status, 'Monitoring'),
    eta: normalizeText(payload.eta, 'Not set'),
    actionRequired: normalizeText(payload.actionRequired, 'Review in GOPU OS.'),
    source: normalizeText(payload.source, 'GOPU OS')
  };
}

function env(name) {
  return process.env[name]?.trim() || '';
}

function getSupabaseUrl() {
  return env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL') || env('VITE_SUPABASE_URL');
}

function getSupabaseClient() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function timingSafeEqual(left = '', right = '') {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySlackSignature(request, rawBody) {
  const signingSecret = env('SLACK_SIGNING_SECRET');
  if (!signingSecret) return { ok: false, status: 'missing_signing_secret', message: 'SLACK_SIGNING_SECRET is missing. Slack approval requests cannot be verified.' };
  const signature = request.headers['x-slack-signature'];
  const timestamp = request.headers['x-slack-request-timestamp'];
  const requestTime = Number(timestamp || 0);
  if (!signature || !timestamp || !Number.isFinite(requestTime)) return { ok: false, status: 'invalid_signature', message: 'Slack signature headers are missing.' };
  if (Math.abs(Math.floor(Date.now() / 1000) - requestTime) > 300) return { ok: false, status: 'stale_signature', message: 'Slack request timestamp is outside the allowed verification window.' };
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;
  if (!timingSafeEqual(expected, String(signature))) return { ok: false, status: 'invalid_signature', message: 'Invalid Slack signature.' };
  return { ok: true };
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value = '') {
  return String(value).replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char] || char);
}

function normalizeLeadPayload(payload = {}) {
  return {
    id: normalizeText(payload.id, 'Draft lead'),
    buyerName: normalizeText(payload.buyer_name, 'Buyer'),
    companyName: normalizeText(payload.company_name, 'Importer company'),
    email: normalizeText(payload.email),
    phone: normalizeText(payload.phone, 'Not provided'),
    destinationCountry: normalizeText(payload.destination_country, 'Not provided'),
    product: normalizeText(payload.product || payload.product_name, 'Requested product'),
    quantity: normalizeText(payload.quantity, 'Not provided'),
    incoterm: normalizeText(payload.incoterm, 'FOB'),
    deadline: normalizeText(payload.deadline, 'Not provided')
  };
}

function customerLeadEmail(lead) {
  const subject = 'Thank you for contacting GOPU Exports';
  const text = [
    `Hello ${lead.buyerName}`,
    '',
    'Thank you for contacting GOPU Exports. We received your enquiry and our team will review the details before sharing any quotation or export commitment.',
    '',
    `Company: ${lead.companyName}`,
    `Product: ${lead.product}`,
    `Quantity: ${lead.quantity}`,
    `Destination: ${lead.destinationCountry}`,
    '',
    'If anything is missing, our team will contact you for clarification. We prefer to confirm product, packing, documents, pricing, and shipment assumptions carefully before sending a buyer-facing quote.',
    '',
    'Regards,',
    'GOPU Exports'
  ].join('\n');
  const html = `<p>Hello ${escapeHtml(lead.buyerName)},</p><p>Thank you for contacting GOPU Exports. We received your enquiry and our team will review the details before sharing any quotation or export commitment.</p><ul><li><strong>Company:</strong> ${escapeHtml(lead.companyName)}</li><li><strong>Product:</strong> ${escapeHtml(lead.product)}</li><li><strong>Quantity:</strong> ${escapeHtml(lead.quantity)}</li><li><strong>Destination:</strong> ${escapeHtml(lead.destinationCountry)}</li></ul><p>If anything is missing, our team will contact you for clarification. We prefer to confirm product, packing, documents, pricing, and shipment assumptions carefully before sending a buyer-facing quote.</p><p>Regards,<br/>GOPU Exports</p>`;
  return { subject, text, html };
}

function adminLeadEmail(lead) {
  const subject = `New GOPU lead: ${lead.companyName}`;
  const text = [
    'New lead submitted in GOPU OS.',
    '',
    `Lead ID: ${lead.id}`,
    `Buyer: ${lead.buyerName}`,
    `Company: ${lead.companyName}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone}`,
    `Destination: ${lead.destinationCountry}`,
    `Product: ${lead.product}`,
    `Quantity: ${lead.quantity}`,
    `Incoterm: ${lead.incoterm}`,
    `Deadline: ${lead.deadline}`,
    '',
    'Next action: COO should verify buyer details before pricing, shipment promises, or buyer-facing documents.'
  ].join('\n');
  const html = `<p>New lead submitted in GOPU OS.</p><ul><li><strong>Lead ID:</strong> ${escapeHtml(lead.id)}</li><li><strong>Buyer:</strong> ${escapeHtml(lead.buyerName)}</li><li><strong>Company:</strong> ${escapeHtml(lead.companyName)}</li><li><strong>Email:</strong> ${escapeHtml(lead.email)}</li><li><strong>Phone:</strong> ${escapeHtml(lead.phone)}</li><li><strong>Destination:</strong> ${escapeHtml(lead.destinationCountry)}</li><li><strong>Product:</strong> ${escapeHtml(lead.product)}</li><li><strong>Quantity:</strong> ${escapeHtml(lead.quantity)}</li><li><strong>Incoterm:</strong> ${escapeHtml(lead.incoterm)}</li><li><strong>Deadline:</strong> ${escapeHtml(lead.deadline)}</li></ul><p>Next action: COO should verify buyer details before pricing, shipment promises, or buyer-facing documents.</p>`;
  return { subject, text, html };
}

async function sendResendEmail(apiKey, message) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'GOPU-Lead-Email/1.0'
    },
    body: JSON.stringify(message)
  });
  return { ok: response.ok, status: response.status };
}

function formatSlackText(alert) {
  return [
    '━━━━━━━━━━━━━━',
    'GOPU OS ALERT',
    '',
    `Priority: ${alert.priority}`,
    `Type: ${alert.type}`,
    `Reference: ${alert.reference}`,
    `Buyer: ${alert.buyer}`,
    `Status: ${alert.status}`,
    `ETA: ${alert.eta}`,
    '',
    'Action Required:',
    alert.actionRequired,
    '━━━━━━━━━━━━━━'
  ].join('\n');
}

async function readRawBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body;
}

async function readBody(request) {
  const body = await readRawBody(request);
  if (!body) return {};
  return JSON.parse(body);
}

function parseSlackApprovalPayload(rawBody = '', contentType = '') {
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    const payload = params.get('payload');
    return payload ? JSON.parse(payload) : Object.fromEntries(params.entries());
  }
  return rawBody ? JSON.parse(rawBody) : {};
}

function getStableHash(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeApprovalRequest(payload = {}) {
  return {
    approvalId: normalizeText(payload.approval_id || payload.approvalId || `slack-approval-${Date.now()}`),
    title: normalizeText(payload.title, 'Founder approval required'),
    summary: normalizeText(payload.summary || payload.description, 'Founder approval is required before this workflow can continue.'),
    requestedBy: normalizeText(payload.requested_by || payload.requestedBy, 'GOPU OS'),
    riskLevel: normalizeText(payload.risk_level || payload.riskLevel, 'Medium'),
    module: normalizeText(payload.module, 'Founder Approval'),
    relatedTable: normalizeText(payload.related_table || payload.relatedTable, 'slack_approval_requests'),
    relatedRecordId: normalizeText(payload.related_record_id || payload.relatedRecordId, ''),
    amount: normalizeText(payload.amount, 'Not specified'),
    reason: normalizeText(payload.reason, 'Approval required by governance policy.')
  };
}

function buildSlackApprovalBlocks(approval) {
  const baseValue = {
    approval_id: approval.approvalId,
    module: approval.module,
    related_table: approval.relatedTable,
    related_record_id: approval.relatedRecordId,
    risk_level: approval.riskLevel
  };

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'GOPU OS Founder Approval', emoji: false }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${approval.title}*\n${approval.summary}`
      }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Requested by*\n${approval.requestedBy}` },
        { type: 'mrkdwn', text: `*Risk*\n${approval.riskLevel}` },
        { type: 'mrkdwn', text: `*Amount*\n${approval.amount}` },
        { type: 'mrkdwn', text: `*Module*\n${approval.module}` }
      ]
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Reason: ${approval.reason}` }]
    },
    {
      type: 'actions',
      block_id: `gopu_approval_${approval.approvalId}`.slice(0, 255),
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve', emoji: false },
          style: 'primary',
          action_id: 'gopu_approval_approve',
          value: JSON.stringify({ ...baseValue, decision: 'approved' })
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject', emoji: false },
          style: 'danger',
          action_id: 'gopu_approval_reject',
          value: JSON.stringify({ ...baseValue, decision: 'rejected' })
        }
      ]
    }
  ];
}

async function upsertSlackIntegrationStatus(status, details = {}) {
  const client = getSupabaseClient();
  if (!client) return { ok: false, status: 'not_configured', message: 'Supabase server env is missing.' };

  const row = {
    platform_key: 'slack',
    platform_name: 'Slack',
    logo_key: 'slack',
    provider: 'slack',
    status,
    runtime: details.runtime || 'server_api',
    error_message: details.error_message || '',
    last_sync_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    metadata: {
      webhook_configured: Boolean(env('SLACK_WEBHOOK_URL')),
      bot_token_configured: Boolean(env('SLACK_BOT_TOKEN')),
      channel_configured: Boolean(env('SLACK_CHANNEL_ID')),
      signing_secret_configured: Boolean(env('SLACK_SIGNING_SECRET')),
      last_event: details.event || '',
      last_decision: details.decision || '',
      last_approval_id: details.approval_id || ''
    }
  };

  const result = await client.from('platform_integrations').upsert(row, { onConflict: 'platform_key' }).select('platform_key,status,error_message,metadata').maybeSingle();
  if (result.error) return { ok: false, status: 'db_write_failed', message: result.error.message };
  return { ok: true, row: result.data };
}

async function auditLogExists(idempotencyKey) {
  const client = getSupabaseClient();
  if (!client || !idempotencyKey) return false;
  const result = await client
    .from('audit_logs')
    .select('id')
    .eq('metadata->>idempotency_key', idempotencyKey)
    .limit(1);
  return !result.error && Array.isArray(result.data) && result.data.length > 0;
}

async function writeApprovalAuditLog(decision, details = {}) {
  const client = getSupabaseClient();
  if (!client) return { ok: false, status: 'not_configured', message: 'Supabase server env is missing.' };

  if (await auditLogExists(details.idempotency_key)) {
    return { ok: true, status: 'duplicate', message: 'Audit log already exists for this approval action.' };
  }

  const row = {
    tenant_id: details.tenant_id || demoTenantId,
    action_type: decision === 'approved' ? 'Approval approved' : 'Approval rejected',
    module: details.module || 'Founder Approval',
    related_table: details.related_table || 'slack_approval_requests',
    related_id: details.related_record_id || null,
    actor: details.actor || 'Slack Founder Action',
    description: `Founder approval ${decision} from Slack for ${details.approval_id || 'approval request'}.`,
    previous_value: { approval_status: 'pending' },
    new_value: { approval_status: decision },
    risk_level: details.risk_level || 'Medium',
    metadata: {
      approval_id: details.approval_id || '',
      idempotency_key: details.idempotency_key || '',
      slack_user_id: details.slack_user_id || '',
      slack_action_id: details.slack_action_id || '',
      slack_response_url_present: Boolean(details.slack_response_url)
    }
  };

  const result = await client.from('audit_logs').insert(row).select('id,action_type,module,created_at').maybeSingle();
  if (result.error) return { ok: false, status: 'db_write_failed', message: result.error.message };
  return { ok: true, status: 'inserted', row: result.data };
}

async function sendSlackBotMessage(message) {
  const botToken = env('SLACK_BOT_TOKEN');
  const channelId = env('SLACK_CHANNEL_ID');
  if (!botToken || !channelId) {
    return { ok: false, status: 'not_configured', message: 'Slack bot token or channel id is not configured.' };
  }
  if (!isValidSlackBotToken(botToken) || !isValidSlackChannelId(channelId)) {
    return { ok: false, status: 'invalid_bot_config', message: 'Slack bot token or channel id is not valid.' };
  }
  const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel: channelId, ...message })
  });
  const slackBody = await slackResponse.json().catch(() => ({}));
  if (!slackResponse.ok || slackBody.ok !== true) {
    return { ok: false, status: 'slack_api_failed', message: slackBody.error || `HTTP ${slackResponse.status}` };
  }
  return { ok: true, status: 'sent', channel: slackBody.channel, ts: slackBody.ts };
}

async function sendSlackApprovalMessage(message) {
  const botResult = await sendSlackBotMessage(message);
  if (botResult.ok) return { ...botResult, delivery_method: 'bot' };

  const webhookUrl = env('SLACK_APPROVAL_WEBHOOK_URL') || env('SLACK_WEBHOOK_URL');
  if (!webhookUrl) return botResult;
  if (!isValidSlackWebhook(webhookUrl)) {
    return { ok: false, status: 'invalid_webhook', message: 'Slack webhook is not a valid incoming webhook URL.' };
  }

  const slackResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
  const responseText = await slackResponse.text().catch(() => '');
  if (!slackResponse.ok || (responseText.trim() && responseText.trim() !== 'ok')) {
    return { ok: false, status: 'webhook_failed', message: `Slack webhook returned HTTP ${slackResponse.status}` };
  }
  return {
    ok: true,
    status: 'sent',
    channel: env('SLACK_CHANNEL_ID') || '',
    ts: '',
    delivery_method: 'webhook',
    bot_fallback_reason: botResult.message || botResult.status
  };
}

async function handleLeadEmail(request, response) {
  let payload;
  try {
    payload = await readBody(request);
  } catch {
    sendJson(response, 400, { ok: false, status: 'invalid_payload', message: 'Invalid lead email payload.' });
    return;
  }

  const apiKey = env('RESEND_API_KEY');
  const from = env('RESEND_FROM_EMAIL');
  const adminEmail = env('LEAD_ADMIN_EMAIL') || env('ADMIN_NOTIFICATION_EMAIL') || env('RESEND_TEST_TO');
  if (!apiKey || !from || !adminEmail) {
    sendJson(response, 200, { ok: false, status: 'not_configured', message: 'Lead email env is not fully configured.' });
    return;
  }

  const lead = normalizeLeadPayload(payload);
  if (!isValidEmail(lead.email)) {
    sendJson(response, 200, { ok: false, status: 'invalid_customer_email', message: 'Customer email is missing or invalid.' });
    return;
  }

  try {
    const customer = customerLeadEmail(lead);
    const admin = adminLeadEmail(lead);
    const [customerResult, adminResult] = await Promise.all([
      sendResendEmail(apiKey, { from, to: [lead.email], ...customer }),
      sendResendEmail(apiKey, { from, to: [adminEmail], ...admin })
    ]);
    sendJson(response, 200, {
      ok: customerResult.ok && adminResult.ok,
      status: customerResult.ok && adminResult.ok ? 'sent' : 'partial_or_failed',
      customer: customerResult,
      admin: adminResult
    });
  } catch (error) {
    console.error('[lead-email] notification failed safely', {
      lead_id: lead.id,
      message: error?.message || 'Unknown lead email failure'
    });
    sendJson(response, 200, { ok: false, status: 'failed', message: 'Lead email failed safely.' });
  }
}

async function handleSlackNotification(request, response) {
  let payload;
  try {
    payload = await readBody(request);
  } catch {
    sendJson(response, 400, { ok: false, status: 'invalid_payload', message: 'Invalid Slack notification payload.' });
    return;
  }

  const alert = normalizePayload(payload);
  const idempotencyKey = normalizeText(payload.idempotency_key || payload.idempotencyKey || `${alert.type}:${alert.reference}:${alert.status}:${alert.source}`);
  if (sentSlackNotificationKeys.has(idempotencyKey)) {
    sendJson(response, 200, { ok: true, status: 'duplicate', message: 'Slack alert already handled for this idempotency key.' });
    return;
  }
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const botToken = env('SLACK_BOT_TOKEN');
  const channelId = env('SLACK_CHANNEL_ID');

  try {
    const text = formatSlackText(alert);
    if (webhookUrl) {
      if (!isValidSlackWebhook(webhookUrl)) {
        sendJson(response, 200, { ok: false, status: 'invalid_webhook', message: 'Slack webhook is not a valid incoming webhook URL.' });
        return;
      }
      const slackResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!slackResponse.ok) {
        throw new Error(`Slack returned HTTP ${slackResponse.status}`);
      }
      const responseText = await slackResponse.text().catch(() => '');
      if (responseText.trim() && responseText.trim() !== 'ok') {
        throw new Error('Slack did not acknowledge the notification.');
      }
    } else {
      if (!botToken || !channelId) {
        sendJson(response, 200, { ok: false, status: 'not_configured', message: 'Slack webhook or bot token/channel is not configured.' });
        return;
      }
      if (!isValidSlackBotToken(botToken) || !isValidSlackChannelId(channelId)) {
        sendJson(response, 200, { ok: false, status: 'invalid_bot_config', message: 'Slack bot token or channel id is not valid.' });
        return;
      }
      const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ channel: channelId, text })
      });
      const slackBody = await slackResponse.json().catch(() => ({}));
      if (!slackResponse.ok || slackBody.ok !== true) {
        throw new Error(`Slack bot API returned ${slackBody.error || `HTTP ${slackResponse.status}`}`);
      }
    }
    sentSlackNotificationKeys.add(idempotencyKey);
    sendJson(response, 200, { ok: true, status: 'sent', message: 'Slack alert sent.' });
  } catch (error) {
    console.error('[slack] notification failed safely', {
      type: alert.type,
      reference: alert.reference,
      message: error?.message || 'Unknown Slack delivery failure'
    });
    sendJson(response, 200, { ok: false, status: 'failed', message: 'Slack alert failed safely.' });
  }
}

async function handleSlackApproval(request, response) {
  let rawBody = '';
  try {
    rawBody = await readRawBody(request);
  } catch {
    sendJson(response, 400, { ok: false, status: 'invalid_payload', message: 'Invalid Slack approval payload.' });
    return;
  }

  const verification = verifySlackSignature(request, rawBody);
  if (!verification.ok) {
    sendJson(response, 401, verification);
    return;
  }

  let payload;
  try {
    payload = parseSlackApprovalPayload(rawBody, String(request.headers['content-type'] || ''));
  } catch {
    sendJson(response, 400, { ok: false, status: 'invalid_payload', message: 'Invalid Slack approval payload.' });
    return;
  }

  const idempotencyKey = normalizeText(
    payload.idempotency_key ||
    payload.actions?.[0]?.action_ts ||
    payload.actions?.[0]?.value ||
    payload.idempotency_key ||
    payload.callback_id ||
    payload.trigger_id ||
    payload.action_ts ||
    payload.container?.message_ts ||
    getStableHash(rawBody)
  );
  if (processedSlackApprovalKeys.has(idempotencyKey)) {
    sendJson(response, 200, { ok: true, status: 'duplicate', message: 'Slack approval already processed.' });
    return;
  }

  const action = payload.actions?.[0] || {};
  const value = safeJsonParse(action.value, {});
  const decision = value.decision || (action.action_id === 'gopu_approval_approve' ? 'approved' : action.action_id === 'gopu_approval_reject' ? 'rejected' : '');
  if (!['approved', 'rejected'].includes(decision)) {
    sendJson(response, 400, { ok: false, status: 'unsupported_action', message: 'Slack approval action is not supported.' });
    return;
  }

  const auditResult = await writeApprovalAuditLog(decision, {
    approval_id: value.approval_id,
    module: value.module || 'Founder Approval',
    related_table: value.related_table || 'slack_approval_requests',
    related_record_id: value.related_record_id || null,
    risk_level: value.risk_level || 'Medium',
    idempotency_key: idempotencyKey,
    slack_user_id: payload.user?.id || '',
    slack_action_id: action.action_id || '',
    slack_response_url: payload.response_url || ''
  });
  if (!auditResult.ok) {
    await upsertSlackIntegrationStatus('error', {
      event: 'approval_action',
      decision,
      approval_id: value.approval_id || '',
      error_message: auditResult.message || 'Audit log write failed.'
    });
    sendJson(response, 200, { ok: false, status: 'audit_failed', message: auditResult.message || 'Audit log write failed.' });
    return;
  }

  processedSlackApprovalKeys.add(idempotencyKey);
  const integrationResult = await upsertSlackIntegrationStatus('live', {
    event: 'approval_action',
    decision,
    approval_id: value.approval_id || ''
  });

  sendJson(response, 200, {
    ok: true,
    status: auditResult.status === 'duplicate' ? 'duplicate' : decision,
    decision,
    audit: auditResult,
    integration: integrationResult,
    message: `Slack approval ${decision}.`
  });
}

async function handleSlackApprovalRequest(request, response) {
  let payload;
  try {
    payload = await readBody(request);
  } catch {
    sendJson(response, 400, { ok: false, status: 'invalid_payload', message: 'Invalid Slack approval request payload.' });
    return;
  }

  const approval = normalizeApprovalRequest(payload);
  const blocks = buildSlackApprovalBlocks(approval);
  const result = await sendSlackApprovalMessage({
    text: `GOPU OS Founder Approval: ${approval.title}`,
    blocks
  });

  const signingSecretConfigured = Boolean(env('SLACK_SIGNING_SECRET'));
  await upsertSlackIntegrationStatus(result.ok && signingSecretConfigured ? 'live' : 'error', {
    event: 'approval_message',
    approval_id: approval.approvalId,
    error_message: result.ok
      ? signingSecretConfigured ? '' : 'SLACK_SIGNING_SECRET is missing. Slack approval actions cannot be verified.'
      : result.message
  });

  if (!result.ok) {
    sendJson(response, 200, { ok: false, status: result.status, message: result.message });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    status: 'sent',
    approval_id: approval.approvalId,
    channel: result.channel,
    ts: result.ts,
    delivery_method: result.delivery_method,
    bot_fallback_reason: result.bot_fallback_reason || '',
    blocks_verified: blocks.some((block) => block.type === 'actions')
  });
}

async function handleOpenAIStatus(_request, response) {
  const status = await getOpenAIStatus();
  sendJson(response, 200, status);
}

async function handleCreativeStatus(_request, response) {
  const status = await getCreativeEngineStatus();
  sendJson(response, 200, status);
}

async function handleSchedulerHealthStatus(request, response) {
  await handleSchedulerHealth(request, {
    setHeader: response.setHeader.bind(response),
    status(statusCode) {
      return {
        json(payload) {
          sendJson(response, statusCode, payload);
        }
      };
    }
  });
}

async function handleContentQualityStatus(request, response) {
  const payload = request.method === 'GET' ? undefined : await readBody(request).catch(() => null);
  await handleContentQualityReview(
    { method: request.method, body: payload },
    {
      setHeader: response.setHeader.bind(response),
      status(statusCode) {
        return {
          json(body) {
            sendJson(response, statusCode, body);
          }
        };
      }
    }
  );
}

async function handleContentQualityGenerateStatus(request, response) {
  const payload = await readBody(request).catch(() => null);
  await handleContentQualityGenerate(
    { method: request.method, body: payload },
    {
      setHeader: response.setHeader.bind(response),
      status(statusCode) {
        return {
          json(body) {
            sendJson(response, statusCode, body);
          }
        };
      }
    }
  );
}

async function handleVercelStatus(_request, response) {
  const status = await getVercelStatus();
  sendJson(response, 200, status);
}

async function handleSupabaseStorageStatus(_request, response) {
  const status = await getSupabaseStorageStatus();
  sendJson(response, 200, status);
}

async function handleSlackStatus(_request, response) {
  const botTokenConfigured = Boolean(env('SLACK_BOT_TOKEN'));
  const channelConfigured = Boolean(env('SLACK_CHANNEL_ID'));
  const channelDisplay = env('SLACK_CHANNEL_NAME_FOR_DISPLAY') || '#all-gopu-os';
  const signingSecretConfigured = Boolean(env('SLACK_SIGNING_SECRET'));
  const approvalWebhookConfigured = Boolean(env('SLACK_APPROVAL_WEBHOOK_URL') || env('SLACK_WEBHOOK_URL'));
  const live = botTokenConfigured && channelConfigured && signingSecretConfigured && approvalWebhookConfigured;

  sendJson(response, 200, {
    platform_key: 'slack',
    platform_name: 'Slack Approval',
    provider: 'slack',
    channel_display: channelDisplay,
    status: live ? 'live' : 'error',
    runtime: 'slack_block_kit',
    error_message: live ? null : 'Missing Slack approval config.',
    last_success_at: live ? new Date().toISOString() : null,
    required_config: {
      bot_token_configured: botTokenConfigured,
      channel_configured: channelConfigured,
      signing_secret_configured: signingSecretConfigured,
      approval_webhook_configured: approvalWebhookConfigured
    },
    source: 'slack_status_endpoint'
  });
}

loadLocalEnv();

const server = http.createServer((request, response) => {
  const routePath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && routePath === '/api/slack/notify') {
    handleSlackNotification(request, response);
    return;
  }
  if (request.method === 'GET' && routePath === '/api/integrations/openai/status') {
    handleOpenAIStatus(request, response);
    return;
  }
  if (request.method === 'GET' && routePath === '/api/integrations/creative/status') {
    handleCreativeStatus(request, response);
    return;
  }
  if (request.method === 'GET' && routePath === '/api/integrations/vercel/status') {
    handleVercelStatus(request, response);
    return;
  }
  if (request.method === 'GET' && routePath === '/api/integrations/supabase/storage/status') {
    handleSupabaseStorageStatus(request, response);
    return;
  }
  if (request.method === 'GET' && routePath === '/api/integrations/slack/status') {
    handleSlackStatus(request, response);
    return;
  }
  if (request.method === 'GET' && routePath === '/api/cmo/scheduler-health') {
    handleSchedulerHealthStatus(request, response);
    return;
  }
  if (request.method === 'POST' && routePath === '/api/learning-centre/start') {
    handleLearningCentreStart(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if (request.method === 'POST' && routePath === '/api/learning-centre/safe-test') {
    handleLearningCentreSafeTest(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if (request.method === 'POST' && routePath === '/api/learning-centre/stop') {
    handleLearningCentreStop(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if (request.method === 'GET' && routePath === '/api/learning-centre/status') {
    handleLearningCentreStatus(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if (request.method === 'GET' && routePath === '/api/learning-centre/setup') {
    handleLearningCentreSetup(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if (request.method === 'GET' && routePath === '/api/learning-centre/findings') {
    handleLearningCentreFindings(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if (request.method === 'GET' && routePath.startsWith('/api/learning-centre/report/')) {
    handleLearningCentreReport(request, (statusCode, payload) => sendJson(response, statusCode, payload, request.headers.origin || ''));
    return;
  }
  if ((request.method === 'GET' || request.method === 'POST') && routePath === '/api/cmo/content-quality/review') {
    handleContentQualityStatus(request, response);
    return;
  }
  if (request.method === 'POST' && routePath === '/api/cmo/content-quality/generate') {
    handleContentQualityGenerateStatus(request, response);
    return;
  }
  if (request.method === 'POST' && routePath === '/api/slack/approval') {
    handleSlackApproval(request, response);
    return;
  }
  if (request.method === 'POST' && routePath === '/api/slack/approval-request') {
    handleSlackApprovalRequest(request, response);
    return;
  }
  if (request.method === 'POST' && routePath === '/api/lead-email/notify') {
    handleLeadEmail(request, response);
    return;
  }
  sendJson(response, 404, { ok: false, status: 'not_found', message: 'Route not found.' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[slack] GOPU OS Slack notification server listening on http://127.0.0.1:${port}`);
});
