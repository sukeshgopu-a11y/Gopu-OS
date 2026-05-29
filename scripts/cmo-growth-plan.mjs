import { growthPlan, loadCmoLearningData } from "./cmo-learning-shared.mjs";

async function main() {
  let statusCards = null;
  try {
    const data = await loadCmoLearningData();
    statusCards = {
      connected: data.connected,
      schema_missing: data.schema_missing,
      error: data.error,
      ...data.status_cards
    };
  } catch (error) {
    statusCards = { warning: `Learning data unavailable: ${error?.message || String(error)}` };
  }

  console.log(JSON.stringify({
    ok: true,
    follower_goal: growthPlan.follower_goal,
    goal_note: growthPlan.goal_note,
    strategy: growthPlan.strategy,
    warning_rules: growthPlan.warning_rules,
    current_learning_status: statusCards
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
