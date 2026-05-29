import { runCmoAnalyticsEngine } from '../../../lib/cmoAnalyticsEngine.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, status: 'method_not_allowed', message: 'POST required.' });
    return;
  }

  let payload = req.body || {};
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload || '{}');
    } catch {
      res.status(400).json({ ok: false, status: 'invalid_payload', message: 'Invalid analytics payload.' });
      return;
    }
  }

  try {
    const result = await runCmoAnalyticsEngine({
      dryRun: payload.dry_run === true || payload.dryRun === true,
      limit: payload.limit,
      runId: payload.run_id,
      contentHistoryId: payload.content_history_id
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('[cmo-analytics] route failed safely', {
      message: error instanceof Error ? error.message : 'Unknown analytics route error'
    });
    res.status(200).json({
      ok: false,
      status: 'failed_safely',
      message: 'CMO analytics engine failed safely. No production row was corrupted.'
    });
  }
}
