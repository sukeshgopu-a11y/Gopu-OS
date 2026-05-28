async function learningCentreFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, data: body, error: body.message || `HTTP ${response.status}` };
  return { ok: true, data: body, error: null };
}

export function getLearningCentreStatus() {
  return learningCentreFetch('/api/learning-centre/status');
}

export function getLearningCentreSetup() {
  return learningCentreFetch('/api/learning-centre/setup');
}

export function getLearningCentreFindings(params = {}) {
  const query = new URLSearchParams();
  if (params.role) query.set('role', params.role);
  if (params.since) query.set('since', params.since);
  query.set('limit', String(params.limit || 25));
  return learningCentreFetch(`/api/learning-centre/findings?${query.toString()}`);
}

export function startLearningCentreRun() {
  return learningCentreFetch('/api/learning-centre/start', { method: 'POST' });
}

export function runSafeLearningCentreTest() {
  return learningCentreFetch('/api/learning-centre/safe-test', { method: 'POST' });
}

export function stopLearningCentreRun() {
  return learningCentreFetch('/api/learning-centre/stop', { method: 'POST' });
}

export function getLearningCentreReport(runId) {
  return learningCentreFetch(`/api/learning-centre/report/${encodeURIComponent(runId)}`);
}
