import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const demoTenantId = "11111111-1111-1111-1111-111111111111";

function env(name) {
  return process.env[name]?.trim() || "";
}

function nowIso() {
  return new Date().toISOString();
}

function supabaseUrl() {
  return env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL") || env("VITE_SUPABASE_URL");
}

function getClient(provided) {
  if (provided) return provided;
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase server env.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function text(value, fallback = "") {
  return String(value || fallback).trim();
}

function metadata(row) {
  return row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function truncate(value, max = 2800) {
  const clean = text(value);
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function normalizeHashtags(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  return [];
}

export function cmoSlackActionValue(row, action) {
  return JSON.stringify({
    action,
    run_id: row.run_id,
    content_history_id: row.id,
    tenant_id: row.tenant_id || demoTenantId,
    module: "CMO",
    related_table: "content_history",
    related_record_id: row.id
  });
}

function approvalUrl(row) {
  const base = env("GOPU_OS_BASE_URL") || env("APP_BASE_URL") || env("VERCEL_URL") || "http://127.0.0.1:5173";
  const normalizedBase = base.startsWith("http") ? base : `https://${base}`;
  return `${normalizedBase.replace(/\/$/, "")}/cmo/approvals?run_id=${encodeURIComponent(row.run_id || "")}`;
}

export function buildCmoSlackApprovalBlocks(row, options = {}) {
  const interactive = options.interactive === true;
  const hashtags = normalizeHashtags(row.hashtags || metadata(row).hashtags);
  const caption = row.final_text || row.final_approved_content || row.caption || row.generated_text || "No caption available.";
  const imageUrl = row.poster_url || row.image_url || metadata(row).poster_url || metadata(row).image_url || "";
  const imagePrompt = row.image_prompt || metadata(row).image_prompt || "No image prompt available.";
  const scheduledTime = row.scheduled_for || row.scheduled_at || metadata(row).scheduled_time || metadata(row).scheduled_for || "Not scheduled";
  const status = row.approval_status || "waiting";
  const channelDisplay = env("SLACK_CHANNEL_NAME_FOR_DISPLAY") || "#all-gopu-os";

  const blocks = [
    { type: "header", text: { type: "plain_text", text: "GOPU OS CMO Approval Required" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Run ID*\n${row.run_id || "Unknown"}` },
        { type: "mrkdwn", text: `*Platform*\n${row.platform || "LinkedIn"}` },
        { type: "mrkdwn", text: `*Scheduled time*\n${scheduledTime}` },
        { type: "mrkdwn", text: `*Approval status*\n${status}` },
        { type: "mrkdwn", text: `*Slack channel display*\n${channelDisplay}` }
      ]
    },
    { type: "section", text: { type: "mrkdwn", text: `*Caption*\n${truncate(caption)}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Hashtags*\n${hashtags.length ? hashtags.join(" ") : "No hashtags provided."}` } }
  ];

  if (imageUrl) {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: "GOPU OS CMO generated poster preview"
    });
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Image prompt*\n${truncate(imagePrompt, 1200)}` } });
  }

  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Safety: No public publishing will happen until approved." }] });

  if (interactive) {
    blocks.push({
      type: "actions",
      block_id: `cmo_approval_${row.run_id || row.id}`.slice(0, 255),
      elements: [
        { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: "cmo_approve", value: cmoSlackActionValue(row, "approve") },
        { type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: "cmo_reject", value: cmoSlackActionValue(row, "reject") },
        { type: "button", text: { type: "plain_text", text: "Modify" }, action_id: "cmo_modify", value: cmoSlackActionValue(row, "modify") }
      ]
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "Modify requires Slack bot interactivity. Use GOPU OS UI or CLI fallback." }
    });
    blocks.push({
      type: "actions",
      block_id: `cmo_approval_fallback_${row.run_id || row.id}`.slice(0, 255),
      elements: [
        { type: "button", text: { type: "plain_text", text: "Open GOPU OS approval" }, url: approvalUrl(row) }
      ]
    });
  }

  return blocks;
}

function fallbackText(row) {
  const hashtags = normalizeHashtags(row.hashtags || metadata(row).hashtags).join(" ");
  const caption = row.final_text || row.final_approved_content || row.caption || row.generated_text || "No caption available.";
  return [
    "GOPU OS CMO Approval Required",
    `Run ID: ${row.run_id}`,
    `Platform: ${row.platform || "LinkedIn"}`,
    `Caption: ${truncate(caption, 900)}`,
    `Hashtags: ${hashtags || "None"}`,
    "Safety: No public publishing will happen until approved."
  ].join("\n");
}

async function slackApi(method, body, token = env("SLACK_BOT_TOKEN")) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.ok === true, httpStatus: response.status, data };
}

export async function sendCmoSlackApprovalMessage(row, options = {}) {
  const botToken = env("SLACK_BOT_TOKEN");
  const channelId = env("SLACK_CHANNEL_ID");
  const webhookUrl = env("SLACK_WEBHOOK_URL") || env("SLACK_APPROVAL_WEBHOOK_URL");
  const interactive = Boolean(botToken && channelId && env("SLACK_SIGNING_SECRET"));
  const blocks = buildCmoSlackApprovalBlocks(row, { interactive });

  if (botToken && channelId) {
    const result = await slackApi("chat.postMessage", {
      channel: channelId,
      text: fallbackText(row),
      blocks
    }, botToken);
    if (result.ok) return { ok: true, status: "sent_bot", interactive, channel: channelId, ts: result.data?.ts || "", blocks };
    if (!webhookUrl) return { ok: false, status: result.data?.error || "bot_send_failed", interactive, required_scopes: ["chat:write"], blocks };
  }

  if (!webhookUrl) return { ok: false, status: "not_configured", interactive: false, blocks };
  if (!/^https:\/\/hooks\.slack(?:-gov)?\.com\/services\//i.test(webhookUrl)) return { ok: false, status: "invalid_webhook", interactive: false, blocks };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: fallbackText(row), blocks })
  });
  const responseText = await response.text().catch(() => "");
  return { ok: response.ok && responseText.trim() === "ok", status: response.ok ? "sent_webhook" : "webhook_failed", interactive: false, httpStatus: response.status, blocks };
}

export function verifySlackSignature(headers = {}, rawBody = "") {
  const signingSecret = env("SLACK_SIGNING_SECRET");
  if (!signingSecret) return { ok: false, status: "missing_signing_secret" };
  const signature = String(headers["x-slack-signature"] || headers["X-Slack-Signature"] || "");
  const timestamp = String(headers["x-slack-request-timestamp"] || headers["X-Slack-Request-Timestamp"] || "");
  const requestTime = Number(timestamp);
  if (!signature || !timestamp || !Number.isFinite(requestTime)) return { ok: false, status: "missing_signature_headers" };
  if (Math.abs(Math.floor(Date.now() / 1000) - requestTime) > 300) return { ok: false, status: "stale_signature" };
  const expected = `v0=${crypto.createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return { ok: false, status: "invalid_signature" };
  return { ok: true, status: "verified" };
}

async function writeAudit(client, row, actionType, description, extra = {}) {
  const { error } = await client.from("audit_logs").insert({
    tenant_id: row.tenant_id || demoTenantId,
    action_type: actionType,
    action: actionType,
    module: "CMO Slack Approval",
    related_table: "content_history",
    related_record_id: row.id,
    record_type: "content_history",
    record_id: row.id,
    actor: "Slack Founder Action",
    actor_role: "Founder",
    description,
    notes: description,
    risk_level: extra.risk_level || "Medium",
    metadata: {
      run_id: row.run_id,
      test_mode: metadata(row).test_mode === true,
      no_public_publish: metadata(row).test_mode === true,
      ...extra.metadata
    }
  });
  if (error) throw new Error(`audit_logs insert failed: ${error.message}`);
}

async function readHistory(client, runId, contentHistoryId) {
  let query = client.from("content_history").select("*");
  if (contentHistoryId) query = query.eq("id", contentHistoryId);
  else query = query.eq("run_id", runId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`content_history read failed: ${error.message}`);
  if (!data?.id) throw new Error("Content package not found.");
  return data;
}

async function updateApprovalRows(client, row, patch) {
  const { error } = await client.from("content_approvals").update(patch).eq("content_history_id", row.id);
  if (error) throw new Error(`content_approvals update failed: ${error.message}`);
}

async function sendConfirmation(row, message) {
  const webhookUrl = env("SLACK_WEBHOOK_URL") || env("SLACK_APPROVAL_WEBHOOK_URL");
  if (!webhookUrl || !/^https:\/\/hooks\.slack(?:-gov)?\.com\/services\//i.test(webhookUrl)) return { ok: false, status: "not_configured" };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `GOPU OS CMO Approval Update\nRun ID: ${row.run_id}\n${message}` })
  });
  const body = await response.text().catch(() => "");
  return { ok: response.ok && body.trim() === "ok", status: response.ok ? "sent" : "failed" };
}

export async function processCmoSlackApprovalAction({ client: providedClient, action, runId, contentHistoryId, notes = "", slackUserId = "", triggerId = "", responseUrl = "" } = {}) {
  const client = getClient(providedClient);
  const row = await readHistory(client, runId, contentHistoryId);
  if (metadata(row).test_mode !== true && env("CMO_ALLOW_PRODUCTION_SLACK_APPROVAL") !== "true") {
    throw new Error("Production Slack approval processing is disabled until explicitly enabled.");
  }
  const decidedAt = nowIso();
  const baseMetadata = metadata(row);

  if (action === "approve") {
    const patch = {
      approval_status: "approved",
      publish_status: "queued",
      approved_at: decidedAt,
      approved_at_utc: decidedAt,
      metadata: { ...baseMetadata, current_step: 7, workflow_stage: "publishing", slack_approved_at: decidedAt, slack_user_id: slackUserId, no_public_publish: baseMetadata.test_mode === true }
    };
    const { data, error } = await client.from("content_history").update(patch).eq("id", row.id).select("*").maybeSingle();
    if (error) throw new Error(`content_history approve failed: ${error.message}`);
    await updateApprovalRows(client, data, { approval_status: "approved", status: "Approved", approved_at: decidedAt, approved_at_utc: decidedAt, notes: notes || "Approved from Slack." });
    await writeAudit(client, data, "cmo_slack_approval_approved", "Approved from Slack. Publishing queue unlocked.", { metadata: { slack_user_id: slackUserId } });
    await sendConfirmation(data, "Approved. Publishing queue unlocked.");
    return { ok: true, status: "approved", content_history: data };
  }

  if (action === "reject") {
    const patch = {
      approval_status: "rejected",
      publish_status: "rejected",
      rejected_at: decidedAt,
      rejected_at_utc: decidedAt,
      metadata: { ...baseMetadata, workflow_stage: "rejected", slack_rejected_at: decidedAt, slack_user_id: slackUserId, rejection_reason: notes || "" }
    };
    const { data, error } = await client.from("content_history").update(patch).eq("id", row.id).select("*").maybeSingle();
    if (error) throw new Error(`content_history reject failed: ${error.message}`);
    await updateApprovalRows(client, data, { approval_status: "rejected", status: "Rejected", rejected_at: decidedAt, rejected_at_utc: decidedAt, notes: notes || "Rejected from Slack." });
    await writeAudit(client, data, "cmo_slack_approval_rejected", "Rejected from Slack. Returned to edit queue.", { metadata: { slack_user_id: slackUserId, notes } });
    await sendConfirmation(data, "Rejected. Returned to edit queue.");
    return { ok: true, status: "rejected", content_history: data };
  }

  if (action === "modify") {
    if (triggerId && env("SLACK_BOT_TOKEN")) {
      const view = {
        type: "modal",
        callback_id: "cmo_modify_submit",
        private_metadata: JSON.stringify({ run_id: row.run_id, content_history_id: row.id }),
        title: { type: "plain_text", text: "CMO Modify Request" },
        submit: { type: "plain_text", text: "Submit" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [{
          type: "input",
          block_id: "modify_notes",
          label: { type: "plain_text", text: "What changes are needed?" },
          element: { type: "plain_text_input", action_id: "notes", multiline: true }
        }]
      };
      const modal = await slackApi("views.open", { trigger_id: triggerId, view });
      if (modal.ok) return { ok: true, status: "modal_opened", modal_supported: true };
      return { ok: false, status: modal.data?.error || "modal_failed", modal_supported: true, required_scopes: ["chat:write", "commands/interactivity"] };
    }

    return await processCmoModifyRequest({ client, runId: row.run_id, contentHistoryId: row.id, notes: notes || "Modify requested from Slack fallback.", slackUserId, responseUrl });
  }

  throw new Error(`Unsupported CMO Slack action: ${action}`);
}

export async function processCmoModifyRequest({ client: providedClient, runId, contentHistoryId, notes = "", slackUserId = "" } = {}) {
  const client = getClient(providedClient);
  const row = await readHistory(client, runId, contentHistoryId);
  const decidedAt = nowIso();
  const patch = {
    approval_status: "needs_edit",
    publish_status: "needs_edit",
    rejected_at: decidedAt,
    rejected_at_utc: decidedAt,
    metadata: { ...metadata(row), workflow_stage: "modify_requested", modification_request: notes, slack_user_id: slackUserId }
  };
  const { data, error } = await client.from("content_history").update(patch).eq("id", row.id).select("*").maybeSingle();
  if (error) throw new Error(`content_history modify failed: ${error.message}`);
  await updateApprovalRows(client, data, { approval_status: "needs_edit", status: "Needs Edit", rejected_at: decidedAt, rejected_at_utc: decidedAt, notes: notes || "Modify requested." });
  await writeAudit(client, data, "cmo_slack_approval_modify_requested", "Modify request received.", { metadata: { slack_user_id: slackUserId, modification_request: notes } });
  await sendConfirmation(data, "Modify request received.");
  return { ok: true, status: "needs_edit", content_history: data };
}

export function parseSlackActionPayload(payload = {}) {
  if (payload.type === "view_submission") {
    const privateMeta = JSON.parse(payload.view?.private_metadata || "{}");
    const notes = payload.view?.state?.values?.modify_notes?.notes?.value || "";
    return { action: "modify_submit", runId: privateMeta.run_id, contentHistoryId: privateMeta.content_history_id, notes, slackUserId: payload.user?.id || "" };
  }
  const action = payload.actions?.[0] || {};
  const value = JSON.parse(action.value || "{}");
  const actionId = action.action_id || "";
  const normalized = actionId === "cmo_approve" ? "approve" : actionId === "cmo_reject" ? "reject" : actionId === "cmo_modify" ? "modify" : value.action;
  return { action: normalized, runId: value.run_id, contentHistoryId: value.content_history_id, slackUserId: payload.user?.id || "", triggerId: payload.trigger_id || "", responseUrl: payload.response_url || "" };
}
