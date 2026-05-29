import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();

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

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
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

function requireClient() {
  const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  const urlRef = projectRefFromUrl(url);
  const keyRef = projectRefFromJwt(key);
  if (urlRef && keyRef && urlRef !== keyRef) throw new Error(`Supabase env mismatch: URL ref ${urlRef} does not match service role ref ${keyRef}.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  loadLocalEnv();
  const client = requireClient();
  const cleanupKey = argValue("cleanup_key");

  let query = client.from("content_history").select("id,run_id,metadata").eq("metadata->>test_mode", "true").eq("metadata->>realtime_approval_test", "true");
  if (cleanupKey) query = query.eq("metadata->>cleanup_key", cleanupKey);
  const { data: rows, error } = await query;
  if (error) throw new Error(`content_history lookup failed: ${error.message}`);

  const ids = (rows || []).map((row) => row.id);
  if (!ids.length) {
    console.log(JSON.stringify({ ok: true, deleted_content_history: 0, cleanup_key: cleanupKey || "all_realtime_tests" }, null, 2));
    return;
  }

  for (const table of ["content_approvals", "content_links", "content_versions", "content_quality_reviews", "ai_content_memory", "content_metrics"]) {
    const { error: deleteError } = await client.from(table).delete().in("content_history_id", ids);
    if (deleteError) throw new Error(`${table} cleanup failed: ${deleteError.message}`);
  }
  const auditDelete = await client.from("audit_logs").delete().eq("metadata->>test_mode", "true").eq("metadata->>realtime_approval_test", "true");
  if (auditDelete.error) throw new Error(`audit_logs cleanup failed: ${auditDelete.error.message}`);
  const historyDelete = await client.from("content_history").delete().in("id", ids).eq("metadata->>test_mode", "true");
  if (historyDelete.error) throw new Error(`content_history cleanup failed: ${historyDelete.error.message}`);

  console.log(JSON.stringify({
    ok: true,
    cleanup_key: cleanupKey || "all_realtime_tests",
    deleted_content_history: ids.length,
    run_ids: (rows || []).map((row) => row.run_id)
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
