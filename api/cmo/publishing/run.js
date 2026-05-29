import { runCmoPublishingEngine } from '../../../lib/cmoPublishingEngine.mjs';

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
      res.status(400).json({ ok: false, status: 'invalid_payload', message: 'Invalid publishing payload.' });
      return;
    }
  }

  try {
    const result = await runCmoPublishingEngine({
      dryRun: payload.dry_run === true || payload.dryRun === true,
      limit: payload.limit,
      runId: payload.run_id,
      contentHistoryId: payload.content_history_id
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('[cmo-publishing] route failed safely', {
      message: error instanceof Error ? error.message : 'Unknown publishing route error'
    });
    res.status(200).json({
      ok: false,
      status: 'failed_safely',
      message: 'CMO publishing engine failed safely. No unsafe publish was confirmed.'
    });
  }
}
