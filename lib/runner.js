(function (root) {
  function summarize(results) {
    if (results.some((result) => result.status === 'failed')) return 'failed';
    if (results.some((result) => result.status === 'skipped')) return 'stopped';
    if (results.length > 0 && results.every((result) => result.status === 'passed')) return 'passed';
    return 'stopped';
  }

  async function executeSequence(steps, adapter, options) {
    const settings = options || {};
    const timeoutMs = settings.timeoutMs || 10000;
    const results = [];
    let failed = false;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (settings.shouldStop && settings.shouldStop()) {
        results.push({ index, stepId: step.id, type: step.type, status: 'skipped', message: 'Execution stopped' });
        if (settings.onResult) await settings.onResult(results[results.length - 1], results);
        continue;
      }
      if (failed) {
        results.push({
          index,
          stepId: step.id,
          type: step.type,
          status: 'skipped',
          message: 'Skipped because a previous step failed',
        });
        if (settings.onResult) await settings.onResult(results[results.length - 1], results);
        continue;
      }
      try {
        const actual = await adapter.execute(step, step.timeoutMs || timeoutMs);
        const result = {
          index,
          stepId: step.id,
          type: step.type,
          status: 'passed',
          actual: actual && actual.actual,
        };
        results.push(result);
        if (settings.onResult) await settings.onResult(result, results);
      } catch (error) {
        failed = true;
        const result = {
          index,
          stepId: step.id,
          type: step.type,
          status: 'failed',
          message: (error && error.message) || 'Step failed',
          expected: error && error.expected,
          actual: error && error.actual,
        };
        if (Array.isArray(error && error.repairs) && error.repairs.length) result.repairs = error.repairs;
        results.push(result);
        if (settings.onResult) await settings.onResult(result, results);
      }
    }
    return { status: summarize(results), results };
  }

  const api = { executeSequence, summarize };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
