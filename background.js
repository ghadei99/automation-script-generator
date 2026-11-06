importScripts(
  'lib/id.js',
  'lib/mutex.js',
  'lib/origin.js',
  'lib/redact.js',
  'lib/selectors.js',
  'lib/schema.js',
  'lib/reducer.js',
  'lib/ai.js',
  'lib/runner.js'
);

const withLock = ASG.createMutex();
const DEFAULT_SETTINGS = {
  stepTimeoutMs: 10000,
  navigationTimeoutMs: 20000,
  aiMode: 'mock',
  aiProxyUrl: '',
  aiProxyToken: '',
};
const RECORDER_FILES = ['lib/id.js', 'lib/origin.js', 'lib/redact.js', 'lib/selectors.js', 'content.js'];
const SCRIPT_IDS = ['asg-recorder', 'asg-network'];

let session = null;
let activeRun = null;
let stopRequested = false;
let ready = Promise.resolve();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicState() {
  return {
    ok: true,
    recording: !!(session && session.status === 'recording'),
    network: !!(session && session.networkCapture && session.status === 'recording'),
    paused: !!(session && session.status === 'paused'),
    origin: session ? session.origin : '',
    tabId: session ? session.tabId : null,
    status: session ? session.status : 'idle',
  };
}

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

async function getTests() {
  const stored = await chrome.storage.local.get('tests');
  return Array.isArray(stored.tests) ? stored.tests : [];
}

async function getRuns() {
  const stored = await chrome.storage.local.get('runs');
  return Array.isArray(stored.runs) ? stored.runs : [];
}

async function saveSession(next) {
  session = next;
  await chrome.storage.local.set({ session });
  await updateBadge();
  return session;
}

async function updateBadge() {
  if (activeRun && activeRun.status === 'running') {
    await chrome.action.setBadgeBackgroundColor({ color: '#175cd3' });
    await chrome.action.setBadgeText({ text: 'RUN' });
    return;
  }
  if (session && session.status === 'recording') {
    await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
    await chrome.action.setBadgeText({ text: 'REC' });
    return;
  }
  if (session && session.status === 'paused') {
    await chrome.action.setBadgeBackgroundColor({ color: '#b54708' });
    await chrome.action.setBadgeText({ text: '||' });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
}

async function broadcastState() {
  if (!session || session.tabId == null) return;
  try {
    await chrome.tabs.sendMessage(session.tabId, { type: 'recording-state', state: publicState() });
  } catch (error) {
    // The tab may still be loading. The content script asks again on startup.
  }
}

async function hasOriginPermission(url) {
  const pattern = ASG.originPattern(url);
  if (!pattern) return false;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    return chrome.permissions.contains({ origins: [`${parsed.protocol}//${parsed.hostname}/*`] });
  }
  return false;
}

async function registerScripts(current) {
  const pattern = `${current.origin}/*`;
  await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS }).catch(() => {});
  const scripts = [{
    id: 'asg-recorder',
    js: RECORDER_FILES,
    matches: [pattern],
    runAt: 'document_start',
    persistAcrossSessions: false,
  }];
  if (current.networkCapture) {
    scripts.push({
      id: 'asg-network',
      js: ['injected/network.js'],
      matches: [pattern],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: false,
    });
  }
  await chrome.scripting.registerContentScripts(scripts);
}

async function injectNow(tabId, networkCapture) {
  await chrome.scripting.executeScript({ target: { tabId }, files: RECORDER_FILES });
  if (networkCapture) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['injected/network.js'], world: 'MAIN' });
  }
}

function ping(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'ping' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) resolve(false);
      else resolve(true);
    });
  });
}

async function ensureContent(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const reason = ASG.unsupportedReason(tab.url || '');
  if (!tab.url || (reason && reason !== 'ignore')) {
    throw Object.assign(new Error(reason || 'This page cannot be scripted.'), {
      expected: 'http(s) page',
      actual: tab.url || 'unknown',
    });
  }
  if (!(await hasOriginPermission(tab.url))) {
    throw Object.assign(new Error(`Missing permission for ${ASG.originOf(tab.url)}. Start a recording on that site to grant access.`), {
      expected: ASG.originPattern(tab.url),
      actual: 'permission denied',
    });
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await ping(tabId)) return;
    if (attempt === 0) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: RECORDER_FILES });
      } catch (error) {
        throw Object.assign(new Error(error.message || 'Chrome blocked script injection on this page.'), {
          expected: 'content script',
          actual: error.message || 'injection failed',
        });
      }
    }
    await delay(150);
  }
  throw new Error('This page did not load the recorder. Chrome may block scripts here.');
}

async function waitForPossibleNavigation(tabId, previousUrl, timeoutMs) {
  const start = Date.now();
  let sawLoading = false;
  while (Date.now() - start < timeoutMs) {
    let current;
    try {
      current = await chrome.tabs.get(tabId);
    } catch (error) {
      throw Object.assign(new Error('The browser tab closed during execution'), { actual: 'tab closed' });
    }
    if (current.status === 'loading') sawLoading = true;
    if (current.url && current.url !== previousUrl && current.status === 'complete') return current;
    if (sawLoading && current.status === 'complete' && current.url !== previousUrl) return current;
    if (!sawLoading && current.url === previousUrl && Date.now() - start > 500) return null;
    await delay(50);
  }
  return null;
}

async function waitForNavigationEffect(tabId, previousUrl, timeoutMs) {
  const start = Date.now();
  let sawLoading = false;
  while (Date.now() - start < timeoutMs) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (error) {
      throw Object.assign(new Error('The browser tab closed during execution'), { actual: 'tab closed' });
    }
    if (tab.status === 'loading') sawLoading = true;
    if (tab.url && tab.url !== previousUrl && tab.status === 'complete') return tab;
    if (sawLoading && tab.status === 'complete') return tab;
    await delay(100);
  }
  return null;
}

async function navigateTab(tabId, url, timeoutMs) {
  const reason = ASG.unsupportedReason(url);
  if (!url || (reason && reason !== 'ignore')) {
    throw Object.assign(new Error(reason || 'Only http(s) URLs can be opened.'), { expected: 'http(s) URL', actual: String(url || '') });
  }
  if (!(await hasOriginPermission(url))) {
    throw Object.assign(new Error(`Cannot open this URL. Grant access by starting a recording on ${ASG.originOf(url)}.`), {
      expected: ASG.originPattern(url),
      actual: 'permission denied',
    });
  }
  const current = await chrome.tabs.get(tabId);
  if (current.url === url && current.status === 'complete') {
    await ensureContent(tabId);
    return { actual: current.url };
  }
  await chrome.tabs.update(tabId, { url });
  const settled = await waitForNavigationEffect(tabId, current.url, timeoutMs);
  if (!settled) throw Object.assign(new Error('Navigation timed out'), { expected: url, actual: 'timed out' });
  const afterReason = ASG.unsupportedReason(settled.url || '');
  if (afterReason && afterReason !== 'ignore') {
    throw Object.assign(new Error(afterReason), { expected: url, actual: settled.url || '' });
  }
  await ensureContent(tabId);
  return { actual: settled.url || url };
}

function sendToTab(tabId, message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, message: 'Step timed out', expected: `${timeoutMs}ms`, actual: 'timed out' });
    }, timeoutMs + 500);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, channelClosed: true, message: err.message || 'The page did not respond' });
        return;
      }
      resolve(response || { ok: false, message: 'Empty response from the page' });
    });
  });
}

function paramsForStep(step, params) {
  if (!step.secret) return {};
  const name = step.paramName || 'secret';
  return { [name]: params && params[name] != null ? String(params[name]) : '' };
}

async function executeStepOnTab(tabId, step, timeoutMs, params) {
  if (stopRequested) throw Object.assign(new Error('Execution stopped'), { actual: 'stopped' });
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    throw Object.assign(new Error('The browser tab closed during execution'), { actual: 'tab closed' });
  }
  if (step.type === 'navigate') return navigateTab(tabId, step.url, timeoutMs);
  if (step.type === 'assertUrl') {
    const actual = tab.url || '';
    const expected = step.expected || step.url || '';
    if (!expected) {
      throw Object.assign(new Error('Expected URL was not set'), { expected: '', actual });
    }
    const ok = step.match === 'partial' ? actual.includes(expected) : actual === expected;
    if (!ok) throw Object.assign(new Error('URL did not match'), { expected, actual });
    return { actual };
  }
  await ensureContent(tabId);
  const response = await sendToTab(tabId, {
    type: 'execute-step',
    step,
    timeoutMs,
    params: paramsForStep(step, params),
  }, timeoutMs);
  if (response.channelClosed && ['click', 'dblclick', 'submit'].includes(step.type)) {
    const settled = await waitForNavigationEffect(tabId, tab.url, timeoutMs);
    if (settled) {
      await ensureContent(tabId);
      return { actual: settled.url || 'navigated' };
    }
  }
  if (!response.ok) {
    throw Object.assign(new Error(response.message || 'Step failed'), {
      expected: response.expected,
      actual: response.actual,
    });
  }
  if (['click', 'dblclick', 'submit'].includes(step.type)) {
    const moved = await waitForPossibleNavigation(tabId, tab.url, Math.min(timeoutMs, 5000));
    if (moved && moved.url && moved.url !== tab.url) {
      await ensureContent(tabId);
      return { actual: moved.url };
    }
  }
  return { actual: response.actual };
}

async function captureFailure(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await delay(200);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return { screenshot: null, screenshotError: 'Screenshot was not returned by Chrome.' };
    }
    if (dataUrl.length > 900000) {
      return { screenshot: null, screenshotError: 'Screenshot was captured but omitted because it is too large to store.' };
    }
    return { screenshot: dataUrl, screenshotError: null };
  } catch (error) {
    return { screenshot: null, screenshotError: error.message || 'Screenshot permission is not available for this tab.' };
  }
}

async function persistActive() {
  try {
    await chrome.storage.local.set({ activeRun });
  } catch (error) {
    activeRun = {
      ...activeRun,
      results: (activeRun.results || []).map((result) => (result.screenshot
        ? { ...result, screenshot: null, screenshotError: 'Screenshot omitted because extension storage is full.' }
        : result)),
    };
    await chrome.storage.local.set({ activeRun });
  }
}

async function archiveRun() {
  const runs = await getRuns();
  runs.unshift(activeRun);
  await chrome.storage.local.set({ runs: runs.slice(0, 30), activeRun });
}

async function runLoop(steps, tabId, params) {
  const settings = await getSettings();
  try {
    const executed = await ASG.executeSequence(steps, {
      execute(step, timeoutMs) {
        const limit = step.type === 'navigate' ? (settings.navigationTimeoutMs || timeoutMs) : timeoutMs;
        return executeStepOnTab(tabId, step, limit, params);
      },
    }, {
      timeoutMs: settings.stepTimeoutMs || 10000,
      shouldStop: () => stopRequested,
      onResult: async (result) => {
        if (result.status === 'failed') {
          const shot = await captureFailure(tabId);
          result.screenshot = shot.screenshot;
          result.screenshotError = shot.screenshotError;
        }
        activeRun = { ...activeRun, results: [...(activeRun.results || []), result] };
        await persistActive();
        await updateBadge();
      },
    });
    activeRun = {
      ...activeRun,
      status: executed.status,
      finishedAt: Date.now(),
      results: executed.results,
      error: null,
    };
  } catch (error) {
    activeRun = {
      ...activeRun,
      status: 'failed',
      finishedAt: Date.now(),
      error: error.message || 'Execution failed',
    };
  }
  await archiveRun();
  await updateBadge();
}

async function migrateLegacy() {
  const data = await chrome.storage.local.get(['recordedActions', 'recordedApiCalls', 'legacyImported']);
  if (data.legacyImported) return;
  const actions = Array.isArray(data.recordedActions) ? data.recordedActions : [];
  const apiCalls = Array.isArray(data.recordedApiCalls) ? data.recordedApiCalls : [];
  if (actions.length || apiCalls.length) {
    const steps = [];
    actions.forEach((action, index) => {
      if (!action || typeof action !== 'object') return;
      const step = { ...action, id: action.id || ASG.createId() };
      const hint = `${(step.selector && step.selector.value) || ''} ${(step.selector && step.selector.strategy) || ''}`;
      if (step.type === 'input' && /(pass(word|wd)?|secret|token|api[_-]?key)/i.test(hint)) {
        step.secret = true;
        step.paramName = 'password';
        delete step.value;
      }
      try {
        steps.push(ASG.sanitizeStep(step, index));
      } catch (error) {
        // Drop steps the current schema cannot represent.
      }
    });
    const tests = await getTests();
    if (steps.length || apiCalls.length) {
      tests.unshift({
        id: ASG.createId(),
        name: 'Imported recording',
        source: 'recorded',
        origin: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps,
        apiCalls: apiCalls.slice(0, 100).map((call) => ASG.redactApiCall(call)),
        warning: 'Imported from an older always-on recording. Raw legacy storage was deleted. Review every step.',
      });
      await chrome.storage.local.set({ tests });
    }
  }
  await chrome.storage.local.remove(['recordedActions', 'recordedApiCalls']);
  await chrome.storage.local.set({ legacyImported: true });
}

async function loadState() {
  const data = await chrome.storage.local.get(['session', 'activeRun']);
  session = data.session || null;
  activeRun = data.activeRun || null;
  if (activeRun && activeRun.status === 'running') {
    activeRun = {
      ...activeRun,
      status: 'interrupted',
      finishedAt: Date.now(),
      error: 'Execution stopped because the extension service worker restarted. This is not a pass.',
    };
    const runs = await getRuns();
    runs.unshift(activeRun);
    await chrome.storage.local.set({ activeRun, runs: runs.slice(0, 30) });
  }
  await migrateLegacy();
  if (session && (session.status === 'recording' || session.status === 'paused')) {
    try {
      await registerScripts(session);
    } catch (error) {
      session = {
        ...session,
        status: 'paused',
        warnings: [...(session.warnings || []), `Recording paused after reload: ${error.message}`].slice(-20),
      };
      await chrome.storage.local.set({ session });
    }
  }
  await updateBadge();
}

function onNavigation(details) {
  if (!details || details.frameId !== 0 || !session || session.status !== 'recording') return;
  withLock(async () => {
    const next = ASG.reduceEvent(session, { kind: 'navigate', url: details.url, tabId: details.tabId });
    if (next !== session) await saveSession(next);
  }).catch((error) => console.error('navigation record failed', error));
}

chrome.webNavigation.onCommitted.addListener(onNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onNavigation);

chrome.tabs.onRemoved.addListener((tabId) => {
  if (session && session.tabId === tabId && (session.status === 'recording' || session.status === 'paused')) {
    withLock(async () => {
      const paused = ASG.reduceEvent(session, { kind: 'status', status: 'paused' });
      const warnings = [...(paused.warnings || [])];
      if (!warnings.includes('Recording paused because the selected tab closed.')) {
        warnings.push('Recording paused because the selected tab closed.');
      }
      await saveSession({ ...paused, warnings });
    }).catch((error) => console.error(error));
  }
  if (activeRun && activeRun.status === 'running' && activeRun.tabId === tabId) stopRequested = true;
});

async function handleMessage(message, sender) {
  await ready;
  if (!message || typeof message.type !== 'string') return { ok: false, message: 'Unknown message' };

  if (message.type === 'recorder:hello') {
    const tabId = sender.tab && sender.tab.id;
    const url = sender.tab && sender.tab.url;
    const sameTab = !!(session && tabId === session.tabId && url && ASG.originOf(url) === session.origin);
    return {
      ok: true,
      recording: sameTab && session.status === 'recording',
      network: sameTab && session.networkCapture && session.status === 'recording',
      origin: session ? session.origin : '',
      status: session ? session.status : 'idle',
    };
  }

  if (message.type === 'recorder:event' || message.type === 'recorder:api') {
    const tabId = sender.tab && sender.tab.id;
    await withLock(async () => {
      if (!session || session.status !== 'recording' || tabId !== session.tabId) return;
      const url = sender.tab && sender.tab.url;
      if (!url || ASG.originOf(url) !== session.origin) return;
      const event = message.type === 'recorder:api'
        ? { kind: 'api', call: message.call }
        : { kind: 'ui', step: message.step };
      const next = ASG.reduceEvent(session, event);
      if (next !== session) await saveSession(next);
    });
    return { ok: true };
  }

  if (message.type === 'app:get') {
    return {
      ok: true,
      session,
      tests: await getTests(),
      runs: await getRuns(),
      activeRun,
      settings: await getSettings(),
    };
  }

  if (message.type === 'session:start') {
    const tab = await chrome.tabs.get(message.tabId);
    const reason = ASG.unsupportedReason(tab.url || '');
    if (!tab.url || (reason && reason !== 'ignore')) throw new Error(reason || 'Open an http or https page before recording.');
    if (!(await hasOriginPermission(tab.url))) throw new Error(`Permission was not granted for ${ASG.originOf(tab.url)}.`);
    if (session && session.status === 'recording') throw new Error('A recording is already running. Stop it before starting another.');
    const previous = session;
    const next = ASG.createSession({
      tabId: tab.id,
      origin: ASG.originOf(tab.url),
      url: tab.url,
      networkCapture: !!message.networkCapture,
    });
    try {
      await registerScripts(next);
      await saveSession(next);
      await injectNow(tab.id, next.networkCapture);
      await broadcastState();
    } catch (error) {
      await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS }).catch(() => {});
      await saveSession(previous);
      throw new Error(error.message || 'Could not start recording on this page.');
    }
    return { ok: true, session };
  }

  if (message.type === 'session:load') {
    const test = (await getTests()).find((item) => item.id === message.id);
    if (!test) throw new Error('Saved test not found.');
    if (session && session.status === 'recording') throw new Error('Stop the current recording before loading a saved test.');
    await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS }).catch(() => {});
    await saveSession({
      id: ASG.createId(),
      status: 'stopped',
      tabId: null,
      origin: test.origin || '',
      networkCapture: false,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      warnings: test.proposed ? ['This draft came from an AI proposal. Selectors are unverified until you run the test.'] : [],
      steps: ASG.sanitizeSteps(test.steps || []),
      apiCalls: test.apiCalls || [],
      loadedFrom: test.id,
    });
    return { ok: true, session };
  }

  if (message.type === 'session:pause' || message.type === 'session:resume' || message.type === 'session:stop') {
    if (!session) throw new Error('There is no recording session.');
    const status = message.type === 'session:pause' ? 'paused' : message.type === 'session:resume' ? 'recording' : 'stopped';
    if (status === 'recording') {
      const tab = await chrome.tabs.get(session.tabId);
      if (ASG.originOf(tab.url || '') !== session.origin) {
        throw new Error(`The selected tab is no longer on ${session.origin}.`);
      }
      await registerScripts(session);
    }
    await withLock(async () => {
      await saveSession(ASG.reduceEvent(session, { kind: 'status', status }));
    });
    if (status === 'stopped') await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS }).catch(() => {});
    await broadcastState();
    return { ok: true, session };
  }

  if (message.type === 'session:discard') {
    await chrome.scripting.unregisterContentScripts({ ids: SCRIPT_IDS }).catch(() => {});
    await saveSession(null);
    return { ok: true, session: null };
  }

  if (message.type === 'steps:update') {
    if (!session) throw new Error('There is no draft to edit.');
    const steps = ASG.sanitizeSteps(message.steps);
    await withLock(async () => {
      await saveSession({ ...session, steps, updatedAt: Date.now() });
    });
    return { ok: true, session };
  }

  if (message.type === 'tests:save') {
    if (!session || !session.steps || !session.steps.length) throw new Error('Nothing to save.');
    const test = {
      id: ASG.createId(),
      name: String(message.name || 'Untitled test').trim().slice(0, 120) || 'Untitled test',
      source: 'recorded',
      origin: session.origin,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: ASG.sanitizeSteps(session.steps),
      apiCalls: (session.apiCalls || []).map((call) => ASG.redactApiCall(call)),
    };
    const tests = await getTests();
    tests.unshift(test);
    await chrome.storage.local.set({ tests });
    return { ok: true, test };
  }

  if (message.type === 'tests:create') {
    const body = message.test || {};
    const test = {
      id: ASG.createId(),
      name: String(body.name || 'Untitled test').trim().slice(0, 120) || 'Untitled test',
      source: body.source === 'ai' ? 'ai' : 'recorded',
      origin: String(body.origin || ''),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      proposed: body.source === 'ai',
      steps: ASG.sanitizeSteps(body.steps || []),
      apiCalls: [],
    };
    const tests = await getTests();
    tests.unshift(test);
    await chrome.storage.local.set({ tests });
    return { ok: true, test };
  }

  if (message.type === 'tests:rename') {
    const tests = await getTests();
    const test = tests.find((item) => item.id === message.id);
    if (!test) throw new Error('Saved test not found.');
    test.name = String(message.name || test.name).trim().slice(0, 120) || test.name;
    test.updatedAt = Date.now();
    await chrome.storage.local.set({ tests });
    return { ok: true, test };
  }

  if (message.type === 'tests:delete') {
    const tests = (await getTests()).filter((item) => item.id !== message.id);
    await chrome.storage.local.set({ tests });
    return { ok: true };
  }

  if (message.type === 'tests:update') {
    const tests = await getTests();
    const test = tests.find((item) => item.id === message.id);
    if (!test) throw new Error('Saved test not found.');
    test.steps = ASG.sanitizeSteps(message.steps);
    test.updatedAt = Date.now();
    await chrome.storage.local.set({ tests });
    return { ok: true, test };
  }

  if (message.type === 'run:start') {
    if (activeRun && activeRun.status === 'running') throw new Error('A test is already running.');
    let test;
    if (message.draft) {
      if (!session || !session.steps || !session.steps.length) throw new Error('There is no draft to run.');
      test = { id: 'draft', name: 'Draft recording', source: 'recorded', origin: session.origin, steps: session.steps };
    } else {
      test = (await getTests()).find((item) => item.id === message.testId);
      if (!test) throw new Error('Saved test not found.');
    }
    const steps = ASG.sanitizeSteps(test.steps);
    if (!steps.length) throw new Error('This test has no steps.');
    await chrome.tabs.get(message.tabId);
    stopRequested = false;
    activeRun = {
      id: ASG.createId(),
      testId: test.id,
      testName: test.name,
      source: test.source || 'recorded',
      proposed: !!test.proposed,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      tabId: message.tabId,
      paramNames: ASG.listSecretParams(steps),
      results: [],
      error: null,
    };
    await persistActive();
    await updateBadge();
    const params = message.params || {};
    runLoop(steps, message.tabId, params).catch((error) => console.error('run failed', error));
    return { ok: true, run: { ...activeRun, results: [] } };
  }

  if (message.type === 'run:stop') {
    stopRequested = true;
    if (activeRun && activeRun.tabId != null) {
      chrome.tabs.sendMessage(activeRun.tabId, { type: 'cancel-execution' }).catch(() => {});
    }
    return { ok: true };
  }

  if (message.type === 'settings:set') {
    const current = await getSettings();
    const next = {
      ...current,
      stepTimeoutMs: clampTimeout(message.settings && message.settings.stepTimeoutMs, current.stepTimeoutMs),
      navigationTimeoutMs: clampTimeout(message.settings && message.settings.navigationTimeoutMs, current.navigationTimeoutMs),
      aiMode: message.settings && message.settings.aiMode === 'live' ? 'live' : 'mock',
      aiProxyUrl: String((message.settings && message.settings.aiProxyUrl) || '').trim().slice(0, 500),
      aiProxyToken: String((message.settings && message.settings.aiProxyToken) || ''),
    };
    await chrome.storage.local.set({ settings: next });
    return { ok: true, settings: { ...next, aiProxyToken: next.aiProxyToken ? 'stored' : '' } };
  }

  if (message.type === 'ai:plan') {
    const settings = await getSettings();
    const mode = message.mode || settings.aiMode || 'mock';
    const evidence = await pageEvidence(message.tabId);
    const context = {
      origin: message.origin || '',
      pageUrl: (evidence && evidence.pageUrl) || message.origin || '',
      evidence,
    };
    if (mode !== 'live') {
      return { ok: true, mode: 'mock', plan: ASG.mockPlan(message.prompt, context) };
    }
    if (!settings.aiProxyUrl) {
      return { ok: false, message: 'No AI proxy is configured. Use mock mode, or save a proxy URL in Settings.' };
    }
    const plan = await requestLivePlan(message.prompt, context.pageUrl, evidence, settings);
    return { ok: true, mode: 'live', plan: ASG.groundPlan(plan, evidence) };
  }

  return { ok: false, message: 'Unknown message' };
}

function clampTimeout(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1000, Math.min(120000, Math.round(number)));
}

async function pageEvidence(tabId) {
  if (tabId == null) return null;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return null;
  }
  const reason = ASG.unsupportedReason(tab.url || '');
  if (!tab.url || (reason && reason !== 'ignore')) return null;
  if (!(await hasOriginPermission(tab.url))) return null;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: ASG.collectPageEvidence,
    });
    const result = injected && injected.result;
    if (!result || !Array.isArray(result.items)) return null;
    return {
      pageUrl: String(result.pageUrl || tab.url).slice(0, 2000),
      title: String(result.title || '').slice(0, 120),
      items: result.items.slice(0, 60).map((item) => ({
        tag: String(item.tag || '').slice(0, 40),
        type: String(item.type || '').slice(0, 40),
        testid: String(item.testid || '').slice(0, 80),
        id: String(item.id || '').slice(0, 80),
        name: String(item.name || '').slice(0, 80),
        role: String(item.role || '').slice(0, 40),
        label: String(item.label || '').slice(0, 80),
        text: String(item.text || '').slice(0, 80),
        hidden: !!item.hidden,
      })),
    };
  } catch (error) {
    return null;
  }
}

async function requestLivePlan(prompt, origin, evidence, settings) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = { 'content-type': 'application/json' };
    if (settings.aiProxyToken) headers.authorization = `Bearer ${settings.aiProxyToken}`;
    const response = await fetch(settings.aiProxyUrl, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        prompt: String(prompt || '').slice(0, 2000),
        targetOrigin: origin || '',
        pageEvidence: evidence && evidence.items ? evidence.items : [],
      }),
    });
    if (!response.ok) throw new Error(`AI proxy returned HTTP ${response.status}`);
    const body = await response.json();
    return ASG.validatePlan({ ...(body.plan || body), source: 'live' });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI proxy timed out after 20 seconds.');
    throw new Error(error.message || 'AI proxy request failed.');
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onConnect.addListener(() => {
  // An open controller port keeps the service worker alive during a run.
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, message: error.message || 'Request failed' });
  });
  return true;
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('popup.html');
  const existing = await chrome.tabs.query({ url });
  if (existing[0]) {
    await chrome.windows.update(existing[0].windowId, { focused: true });
    await chrome.tabs.update(existing[0].id, { active: true });
    return;
  }
  await chrome.windows.create({ url, type: 'popup', width: 1120, height: 800, focused: true });
});

ready = loadState().catch((error) => console.error('startup failed', error));
