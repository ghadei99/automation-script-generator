(function (root) {
  const STATUSES = ['passed', 'failed', 'stopped', 'interrupted', 'running'];
  const STEP_STATUSES = ['passed', 'failed', 'skipped'];
  const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  const BEARER = /bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
  const ASSIGNED = /((?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*["']?)([^"',;\s}&]+)/gi;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function redactText(value, secrets) {
    let text = String(value == null ? '' : value);
    const extras = Array.isArray(secrets) ? secrets : [];
    extras.forEach((secret) => {
      const raw = String(secret || '');
      if (raw.length < 4) return;
      text = text.split(raw).join('REDACTED');
    });
    return text.replace(JWT, 'REDACTED').replace(BEARER, 'Bearer REDACTED').replace(ASSIGNED, '$1REDACTED');
  }

  function clip(value, limit) {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  function validScreenshot(value) {
    return typeof value === 'string' && value.length > 100 && value.length < 2000000 && JPEG.test(value);
  }

  function screenshotOf(result, includeEvidence, secrets) {
    const image = result && result.screenshot;
    if (validScreenshot(image) && includeEvidence === true) {
      return { screenshot: 'included', screenshotData: image };
    }
    if (validScreenshot(image)) {
      return {
        screenshot: 'omitted',
        screenshotData: null,
      };
    }
    if (result && result.screenshotError) {
      const detail = clip(redactText(String(result.screenshotError).replace(/^Screenshot unavailable\.?\s*/i, ''), secrets), 500);
      return { screenshot: 'unavailable', screenshotData: null, screenshotDetail: detail };
    }
    return { screenshot: 'none', screenshotData: null, screenshotDetail: '' };
  }

  function buildReport(run, options) {
    const source = run && typeof run === 'object' ? run : {};
    const settings = options || {};
    const secrets = settings.secrets || [];
    const results = Array.isArray(source.results) ? source.results : [];
    const steps = results.map((result, index) => {
      const item = result && typeof result === 'object' ? result : {};
      const shot = screenshotOf(item, settings.includeEvidence, secrets);
      return {
        index: Number.isInteger(item.index) ? item.index : index,
        type: clip(redactText(item.type || 'unknown', secrets), 80),
        status: STEP_STATUSES.includes(item.status) ? item.status : 'unknown',
        message: clip(redactText(item.message || '', secrets), 2000),
        expected: item.expected == null ? null : clip(redactText(item.expected, secrets), 2000),
        actual: item.actual == null ? null : clip(redactText(item.actual, secrets), 2000),
        screenshot: shot.screenshot,
        screenshotData: shot.screenshotData,
        screenshotDetail: shot.screenshotDetail || '',
      };
    });
    const counts = { passed: 0, failed: 0, skipped: 0, total: steps.length };
    steps.forEach((step) => {
      if (step.status === 'passed' || step.status === 'failed' || step.status === 'skipped') counts[step.status] += 1;
    });
    const started = Number.isFinite(source.startedAt) ? source.startedAt : null;
    const finished = Number.isFinite(source.finishedAt) ? source.finishedAt : null;
    return {
      schemaVersion: 1,
      product: 'Browser Test Recorder',
      testName: clip(redactText(source.testName || 'Untitled test', secrets), 200),
      status: STATUSES.includes(source.status) ? source.status : 'unknown',
      startedAt: started == null ? null : new Date(started).toISOString(),
      finishedAt: finished == null ? null : new Date(finished).toISOString(),
      durationMs: started != null && finished != null && finished >= started ? finished - started : null,
      counts,
      error: source.error ? clip(redactText(source.error, secrets), 2000) : null,
      steps,
    };
  }

  function publicReport(report) {
    const source = report || buildReport(null);
    return {
      schemaVersion: source.schemaVersion,
      product: source.product,
      testName: source.testName,
      status: source.status,
      startedAt: source.startedAt,
      finishedAt: source.finishedAt,
      durationMs: source.durationMs,
      counts: source.counts,
      error: source.error,
      steps: (source.steps || []).map((step) => ({
        index: step.index,
        type: step.type,
        status: step.status,
        message: step.message,
        expected: step.expected,
        actual: step.actual,
        screenshot: step.screenshot,
        screenshotData: step.screenshot === 'included' ? step.screenshotData : null,
        screenshotDetail: step.screenshotDetail || '',
      })),
    };
  }

  function screenshotLine(step) {
    if (step.screenshot === 'unavailable') {
      return step.screenshotDetail ? `Screenshot unavailable. ${step.screenshotDetail}` : 'Screenshot unavailable';
    }
    if (step.screenshot === 'omitted') return 'Screenshot omitted. Failure evidence stays out of this report until you choose to include it.';
    if (step.screenshot === 'included') return 'Screenshot included';
    return 'Screenshot not captured';
  }

  function durationLabel(report) {
    if (report.durationMs == null) return 'Duration unavailable';
    return `${(report.durationMs / 1000).toFixed(1)} seconds`;
  }

  function renderReportHtml(report) {
    const source = report || buildReport(null);
    const rows = (source.steps || []).map((step) => {
      const image = step.screenshot === 'included' && validScreenshot(step.screenshotData)
        ? `<img alt="Failure screenshot" src="${step.screenshotData}">`
        : '';
      return `<article class="step">
        <h3><span class="status ${escapeHtml(step.status)}">${escapeHtml(step.status)}</span> ${escapeHtml(step.index + 1)}. ${escapeHtml(step.type)}</h3>
        <p>${escapeHtml(step.message || 'No failure message')}</p>
        <p>Expected: ${escapeHtml(step.expected == null ? 'Not recorded' : step.expected)}</p>
        <p>Actual: ${escapeHtml(step.actual == null ? 'Not recorded' : step.actual)}</p>
        <p>${escapeHtml(screenshotLine(step))}</p>
        ${image}
      </article>`;
    }).join('\n');
    const counts = source.counts || { passed: 0, failed: 0, skipped: 0, total: 0 };
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(source.testName)} report</title>
  <style>
    body { margin: 0; font: 15px/1.45 "Segoe UI", sans-serif; color: #1c2430; background: #f4f6f8; }
    main { max-width: 840px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { margin: 0 0 8px; font-size: 22px; overflow-wrap: anywhere; }
    h3 { margin: 0 0 8px; font-size: 16px; overflow-wrap: anywhere; }
    p { margin: 4px 0; overflow-wrap: anywhere; }
    .card, .step { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 14px; margin: 12px 0; }
    .status { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .passed { background: #dcfae6; color: #067647; }
    .failed, .interrupted { background: #fee4e2; color: #b42318; }
    .skipped, .unknown, .stopped, .running { background: #eef1f4; color: #475467; }
    img { display: block; max-width: 100%; margin-top: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(source.testName)}</h1>
    <section class="card">
      <p>Status: <span class="status ${escapeHtml(source.status)}">${escapeHtml(source.status)}</span></p>
      <p>Started: ${escapeHtml(source.startedAt || 'Date unavailable')}</p>
      <p>Finished: ${escapeHtml(source.finishedAt || 'Date unavailable')}</p>
      <p>${escapeHtml(durationLabel(source))}</p>
      <p>${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.total} total</p>
      <p>${escapeHtml(source.error || 'No execution error')}</p>
    </section>
    ${rows || '<section class="card"><p>No steps were recorded for this run.</p></section>'}
    <p>This file is a record of the run. It does not change a pass into a fail, or a fail into a pass.</p>
  </main>
</body>
</html>
`;
  }

  const api = { escapeHtml, redactText, buildReport, publicReport, renderReportHtml };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
