import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const expectedProjectRef = "ogrmmhlaxfxrtpdzzwti";
const requiredTables = [
  "content_history",
  "content_versions",
  "content_links",
  "content_approvals",
  "content_quality_reviews",
  "ai_content_memory",
  "audit_logs"
];

function loadLocalEnv() {
  for (const file of [".env", ".env.development", ".env.local"]) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) continue;
    for (const row of fs.readFileSync(target, "utf8").split(/\r?\n/)) {
      const match = row.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function env(name) {
  return process.env[name]?.trim() || "";
}

function projectRefFromUrl(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

function projectRefFromJwt(value) {
  if (!value || value.split(".").length !== 3) return "";
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return payload.ref || "";
  } catch {
    return "";
  }
}

function getSupabaseUrl() {
  return env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
}

async function checkRestTable(baseUrl, serviceKey, table) {
  const restUrl = `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}?select=id&limit=1`;
  const response = await fetch(restUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    }
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  const message = body.message || body.hint || "";
  const visible = response.ok;
  const missing = response.status === 404 || /schema cache|Could not find the table|does not exist/i.test(message);
  return {
    table,
    rest_url: restUrl,
    status: response.status,
    visible,
    missing,
    grant_available: response.ok,
    error: response.ok ? "" : message || `HTTP ${response.status}`
  };
}

async function main() {
  loadLocalEnv();
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const frontendRef = projectRefFromUrl(env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL"));
  const serverRef = projectRefFromUrl(supabaseUrl);
  const serviceRoleRef = projectRefFromJwt(serviceKey);

  const result = {
    ok: false,
    active_project_ref: serverRef,
    expected_project_ref: expectedProjectRef,
    frontend_project_ref: frontendRef,
    service_role_project_ref: serviceRoleRef,
    refs_match: false,
    missing_tables: [],
    rest_checks: [],
    blocker: ""
  };

  if (!supabaseUrl) {
    result.blocker = "Missing SUPABASE_URL, VITE_SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL.";
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  if (!serviceKey) {
    result.blocker = "Missing SUPABASE_SERVICE_ROLE_KEY.";
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  result.refs_match = serverRef === expectedProjectRef && serviceRoleRef === expectedProjectRef && (!frontendRef || frontendRef === expectedProjectRef);
  if (!result.refs_match) {
    result.blocker = "Supabase project refs do not all match the active GOPU OS project.";
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  result.rest_checks = await Promise.all(requiredTables.map((table) => checkRestTable(supabaseUrl, serviceKey, table)));
  result.missing_tables = result.rest_checks.filter((check) => check.missing || !check.visible).map((check) => check.table);
  result.ok = result.missing_tables.length === 0;
  if (!result.ok) {
    result.blocker = `Missing or not REST-visible: ${result.missing_tables.join(", ")}`;
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    active_project_ref: projectRefFromUrl(getSupabaseUrl()),
    expected_project_ref: expectedProjectRef,
    blocker: error?.message || String(error)
  }, null, 2));
  process.exit(1);
});
