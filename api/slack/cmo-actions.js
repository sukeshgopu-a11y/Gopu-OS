import { parseSlackActionPayload, processCmoModifyRequest, processCmoSlackApprovalAction, verifySlackSignature } from "../../lib/cmoSlackApproval.mjs";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseBody(rawBody, contentType = "") {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payload = params.get("payload");
    return payload ? JSON.parse(payload) : Object.fromEntries(params.entries());
  }
  return rawBody ? JSON.parse(rawBody) : {};
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      endpoint: "cmo_slack_actions",
      signing_secret_configured: Boolean(process.env.SLACK_SIGNING_SECRET),
      bot_token_configured: Boolean(process.env.SLACK_BOT_TOKEN),
      channel_configured: Boolean(process.env.SLACK_CHANNEL_ID),
      channel_display: process.env.SLACK_CHANNEL_NAME_FOR_DISPLAY || "#all-gopu-os",
      required_scopes: ["chat:write", "commands/interactivity", "channels:read optional", "groups:read optional"]
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, status: "method_not_allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  const verification = verifySlackSignature(req.headers || {}, rawBody);
  if (!verification.ok) {
    res.status(401).json({ ok: false, status: verification.status });
    return;
  }

  let payload;
  try {
    payload = parseBody(rawBody, String(req.headers["content-type"] || ""));
  } catch {
    res.status(400).json({ ok: false, status: "invalid_payload" });
    return;
  }

  try {
    const parsed = parseSlackActionPayload(payload);
    if (parsed.action === "modify_submit") {
      const result = await processCmoModifyRequest(parsed);
      res.status(200).json({ ok: result.ok, status: result.status, message: "Modify request received." });
      return;
    }
    const result = await processCmoSlackApprovalAction(parsed);
    res.status(200).json({
      ok: result.ok,
      status: result.status,
      message: result.status === "approved"
        ? "Approved. Publishing queue unlocked."
        : result.status === "rejected"
          ? "Rejected. Returned to edit queue."
          : result.status === "modal_opened"
            ? "Modify modal opened."
            : "CMO Slack action processed."
    });
  } catch (error) {
    res.status(200).json({ ok: false, status: "failed_safe", message: error?.message || "CMO Slack action failed safely." });
  }
}
