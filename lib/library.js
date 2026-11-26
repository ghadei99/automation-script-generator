(function (root) {
  function asList(value) {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
  }

  function recordingStatus(session) {
    const status = session && session.status;
    if (status === 'recording' || status === 'paused' || status === 'stopped') return status;
    return 'idle';
  }

  function dashboardStats(tests, runs, session) {
    const saved = asList(tests);
    const history = asList(runs);
    const latest = history[0] && history[0].status ? {
      id: history[0].id || '',
      testName: history[0].testName || 'Run',
      status: history[0].status,
      startedAt: Number.isFinite(history[0].startedAt) ? history[0].startedAt : null,
    } : null;
    return {
      savedTests: saved.length,
      executions: history.length,
      passed: history.filter((run) => run.status === 'passed').length,
      failed: history.filter((run) => run.status === 'failed').length,
      latest,
      recording: recordingStatus(session),
    };
  }

  function filterTests(tests, query, source) {
    const needle = String(query || '').trim().toLowerCase();
    return asList(tests).filter((test) => {
      if (source === 'ai' && test.source !== 'ai') return false;
      if (source === 'recorded' && test.source === 'ai') return false;
      if (!needle) return true;
      return String(test.name || '').toLowerCase().includes(needle);
    });
  }

  function duplicateTest(test, newId) {
    if (!test || typeof test !== 'object') throw new Error('Saved test not found.');
    const id = typeof newId === 'function' ? newId() : newId;
    if (!id || id === test.id) throw new Error('A duplicate needs a new id.');
    const name = `${String(test.name || 'Untitled test').trim() || 'Untitled test'} copy`.slice(0, 120);
    return {
      id,
      name,
      source: test.source === 'ai' ? 'ai' : 'recorded',
      origin: String(test.origin || ''),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      proposed: test.proposed === true,
      planner: test.planner === 'live' ? 'live' : (test.planner || ''),
      planKey: typeof test.planKey === 'string' ? test.planKey : '',
      steps: JSON.parse(JSON.stringify(test.steps || [])),
      apiCalls: JSON.parse(JSON.stringify(test.apiCalls || [])),
    };
  }

  const api = { dashboardStats, filterTests, duplicateTest, recordingStatus };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
