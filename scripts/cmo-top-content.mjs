import { loadCmoLearningData } from "./cmo-learning-shared.mjs";

function topScore(finding) {
  const confidence = Number(finding.confidence_score || 0);
  const hasEngagement = finding.engagement_signals && finding.engagement_signals !== "Not recorded" ? 0.1 : 0;
  return confidence + hasEngagement;
}

async function main() {
  const data = await loadCmoLearningData();
  const topContent = [...data.findings]
    .sort((a, b) => topScore(b) - topScore(a))
    .slice(0, 20)
    .map((finding) => ({
      source_url: finding.source_url,
      platform: finding.platform,
      company_name: finding.company_name,
      caption_style: finding.caption_style,
      hashtags_used: finding.hashtags_used,
      visual_style: finding.visual_style,
      engagement_signals: finding.engagement_signals,
      why_performed_well: finding.why_performed_well,
      gopu_learning: finding.gopu_learning,
      avoid: finding.avoid,
      confidence_score: finding.confidence_score,
      recorded_at: finding.recorded_at
    }));

  console.log(JSON.stringify({
    ok: true,
    connected: data.connected,
    schema_missing: data.schema_missing,
    error: data.error,
    count: topContent.length,
    top_content: topContent,
    note: topContent.length ? "Stored research findings only." : "No CMO research findings are recorded yet."
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
