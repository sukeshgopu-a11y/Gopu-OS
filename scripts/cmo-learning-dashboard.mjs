import { loadCmoLearningData } from "./cmo-learning-shared.mjs";

async function main() {
  const data = await loadCmoLearningData();
  console.log(JSON.stringify({
    ok: true,
    dashboard: {
      connected: data.connected,
      schema_missing: data.schema_missing,
      error: data.error,
      status_cards: data.status_cards,
      top_content_examples_found: data.findings.length,
      follower_goal: data.growth_plan.follower_goal,
      safety: data.growth_plan.warning_rules
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
