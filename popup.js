const views = ['recorder', 'steps', 'run', 'results', 'export', 'ai', 'settings'];
let view = 'recorder';
let model = { session: null, tests: [], runs: [], activeRun: null, settings: defaultSettings() };
let targetTab = null;
let errorText = '';
let selectedStep = 0;
let selectedTestId = '';
let selectedRunId = '';
let exportFramework = 'playwright';
let aiPlan = null;
let dirty = false;

function defaultSettings() {
  return {
    stepTimeoutMs: 10000,
    navigationTimeoutMs: 20000,
    aiMode: 'mock',
    aiProxyUrl: '',
    aiProxyToken: '',
  };
}

function h(tag, attrs) {
  const node = document.createElement(tag);
  const children = Array.from(arguments).slice(2);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'disabled') {
      node.disabled = !!value;
      return;
    }
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = !!value;
    else node.setAttribute(key, value === true ? '' : value);
  });
  children.flat().forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function statusOf() {
  if (model.activeRun && model.activeRun.status === 'running') return ['running', 'Running'];
  if (model.session && model.session.status === 'recording') return ['recording', 'Recording'];
  if (model.session && model.session.status === 'paused') return ['paused', 'Paused'];
  if (model.activeRun && model.activeRun.status) return [model.activeRun.status, model.activeRun.status];
  if (model.session && model.session.status === 'stopped') return ['stopped', 'Stopped'];
  return ['idle', 'Idle'];
}

function updateChrome() {
  const [kind, label] = statusOf();
  const pill = document.getElementById('statusPill');
  pill.className = `pill ${kind}`;
  pill.textContent = label;
  const target = document.getElementById('targetLabel');
  if (!targetTab) target.textContent = 'No browser tab is available.';
  else target.textContent = targetTab.url || 'Blank tab';
  document.querySelectorAll('#nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  const bar = document.getElementById('errorBar');
  bar.hidden = !errorText;
  bar.textContent = errorText;
}

function selectorText(selector) {
  if (!selector) return 'no selector';
  if (selector.strategy === 'role' && selector.name) return `${selector.value} "${selector.name}"`;
  if (selector.strategy === 'testid') return `${selector.attr || 'data-testid'}=${selector.value}`;
  return selector.value || selector.uniqueCss || selector.strategy;
}

function stepSummary(step) {
  switch (step.type) {
    case 'navigate': return `Navigate ${step.url || ''}`;
    case 'click': return `Click ${selectorText(step.selector)}`;
    case 'dblclick': return `Double-click ${selectorText(step.selector)}`;
    case 'input': return step.secret ? `Enter secret {{${step.paramName}}} into ${selectorText(step.selector)}` : `Enter "${step.value || ''}" into ${selectorText(step.selector)}`;
    case 'select': return `Choose "${step.value || ''}" in ${selectorText(step.selector)}`;
    case 'checkbox': return `Set ${selectorText(step.selector)} ${step.checked ? 'checked' : 'unchecked'}`;
    case 'radio': return `Select radio ${selectorText(step.selector)}`;
    case 'submit': return `Submit ${selectorText(step.selector)}`;
    case 'wait': return `Wait for ${selectorText(step.selector)}`;
    case 'assertVisible': return `Assert visible ${selectorText(step.selector)}`;
    case 'assertExists': return `Assert exists ${selectorText(step.selector)}`;
    case 'assertText': return `Assert text ${step.match === 'partial' ? 'contains' : 'equals'} "${step.expected || ''}" on ${selectorText(step.selector)}`;
    case 'assertUrl': return `Assert URL ${step.match === 'partial' ? 'contains' : 'equals'} "${step.expected || step.url || ''}"`;
    default: return step.type;
  }
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) throw new Error((response && response.message) || 'Request failed');
  return response;
}

async function reload() {
  const response = await send({ type: 'app:get' });
  model = {
    session: response.session,
    tests: response.tests || [],
    runs: response.runs || [],
    activeRun: response.activeRun,
    settings: { ...defaultSettings(), ...(response.settings || {}) },
  };
  if (!selectedTestId && model.tests[0]) selectedTestId = model.tests[0].id;
  if (!selectedRunId && model.runs[0]) selectedRunId = model.runs[0].id;
  if (model.session && selectedStep >= model.session.steps.length) selectedStep = Math.max(0, model.session.steps.length - 1);
}

async function refreshTarget() {
  let next = null;
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    next = ((win && win.tabs) || []).find((tab) => tab.active) || null;
  } catch (error) {
    next = null;
  }
  const previousId = targetTab && targetTab.id;
  const previousUrl = targetTab && targetTab.url;
  targetTab = next;
  const changed = (next && next.id) !== previousId || (next && next.url) !== previousUrl;
  if (changed && view === 'recorder' && !dirty) {
    render();
    return;
  }
  const label = document.getElementById('targetLabel');
  if (label && !dirty) {
    label.textContent = targetTab ? (targetTab.url || 'Blank tab') : 'No browser tab is available.';
  }
}

function render() {
  updateChrome();
  const main = document.getElementById('main');
  main.replaceChildren();
  const builders = { recorder: renderRecorder, steps: renderSteps, run: renderRun, results: renderResults, export: renderExport, ai: renderAi, settings: renderSettings };
  main.append((builders[view] || renderRecorder)());
}

function renderRecorder() {
  const session = model.session;
  const reason = targetTab && targetTab.url ? ASG.unsupportedReason(targetTab.url) : 'Open an http or https page in a normal browser window.';
  const blocked = !!(reason && reason !== 'ignore');
  const box = h('section', {},
    h('h2', {}, 'Recorder'),
    h('p', { class: 'muted' }, 'Recording starts only when you press Start, and only in the browser tab shown above.'),
    blocked ? h('div', { class: 'card failed' }, reason) : h('div', { class: 'card' }, targetTab ? `Ready to record ${ASG.originOf(targetTab.url) || 'this page'}.` : 'Open a site in Chrome, then come back here.'),
    h('div', { class: 'row' },
      h('button', { class: 'primary', id: 'startButton', disabled: !targetTab || blocked, onclick: startRecording }, 'Start'),
      h('button', { class: 'warn', disabled: !session || session.status !== 'recording', onclick: () => sessionCommand('session:pause') }, 'Pause'),
      h('button', { disabled: !session || session.status !== 'paused', onclick: () => sessionCommand('session:resume') }, 'Resume'),
      h('button', { class: 'danger', disabled: !session || (session.status !== 'recording' && session.status !== 'paused'), onclick: () => sessionCommand('session:stop') }, 'Stop'),
      h('button', { disabled: !session, onclick: discardSession }, 'Discard draft')
    ),
    h('label', { class: 'inline' },
      h('input', {
        type: 'checkbox',
        id: 'networkCapture',
        checked: !!(session && session.networkCapture && (session.status === 'recording' || session.status === 'paused')),
        disabled: session && (session.status === 'recording' || session.status === 'paused'),
      }),
      'Capture API calls for this site (off by default, redacted)'
    )
  );
  if (session) {
    box.append(h('div', { class: 'card' },
      h('strong', {}, `${session.steps.length} steps`),
      ` on ${session.origin || 'unknown origin'} · ${session.status}`,
      session.networkCapture ? ' · network capture on' : ' · network capture off'
    ));
    (session.warnings || []).forEach((warning) => box.append(h('div', { class: 'card' }, warning)));
  } else {
    box.append(h('div', { class: 'card muted' }, 'No draft yet. Nothing is being recorded.'));
  }
  return box;
}

async function startRecording() {
  errorText = '';
  if (!targetTab || !targetTab.url) {
    errorText = 'Open a normal browser tab before recording.';
    updateChrome();
    return;
  }
  const reason = ASG.unsupportedReason(targetTab.url);
  if (reason && reason !== 'ignore') {
    errorText = reason;
    updateChrome();
    return;
  }
  const pattern = ASG.originPattern(targetTab.url);
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (error) {
    errorText = error.message || 'Chrome did not show the site permission prompt.';
    updateChrome();
    return;
  }
  if (!granted) {
    errorText = `Site permission is required to record ${ASG.originOf(targetTab.url)}.`;
    updateChrome();
    return;
  }
  if (model.session && model.session.steps && model.session.steps.length && model.session.status !== 'recording') {
    const proceed = window.confirm('Starting a new recording replaces the current draft. Save it first if you still need it.');
    if (!proceed) return;
  }
  try {
    const networkCapture = document.getElementById('networkCapture').checked;
    await send({ type: 'session:start', tabId: targetTab.id, networkCapture });
    await reload();
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

async function sessionCommand(type) {
  errorText = '';
  try {
    await send({ type });
    await reload();
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

async function discardSession() {
  if (!window.confirm('Discard the current draft? Saved tests stay.')) return;
  await sessionCommand('session:discard');
}

function renderSteps() {
  const session = model.session;
  const wrap = h('section', {}, h('h2', {}, 'Test steps'));
  if (!session || !session.steps || !session.steps.length) {
    wrap.append(h('div', { class: 'card muted' }, 'Record a workflow or load a saved test. Steps show up here for review.'));
    wrap.append(savedTestLoader());
    return wrap;
  }
  const list = h('div', { class: 'list' });
  session.steps.forEach((step, index) => {
    const button = h('button', {
      class: `step${index === selectedStep ? ' selected' : ''}`,
      onclick: () => { selectedStep = index; render(); },
    }, h('span', { class: 'muted' }, String(index + 1)), h('span', {}, stepSummary(step)));
    if (step.warning || (step.selector && step.selector.warning)) button.append(h('small', {}, step.warning || step.selector.warning));
    list.append(button);
  });
  const editor = renderStepEditor(session.steps[selectedStep], selectedStep);
  wrap.append(h('div', { class: 'split' }, h('div', {}, list, stepToolbar()), editor));
  wrap.append(h('div', { class: 'row' },
    h('input', { type: 'text', id: 'testName', placeholder: 'Test name', value: 'Recorded test' }),
    h('button', { class: 'primary', onclick: saveDraft }, 'Save test')
  ));
  wrap.append(savedTestLoader());
  return wrap;
}

function stepToolbar() {
  return h('div', { class: 'row' },
    h('button', { onclick: () => moveStep(-1) }, 'Move up'),
    h('button', { onclick: () => moveStep(1) }, 'Move down'),
    h('button', { class: 'danger', onclick: deleteStep }, 'Delete'),
    h('button', { onclick: () => addAssertion('assertVisible') }, 'Assert visible'),
    h('button', { onclick: () => addAssertion('assertText') }, 'Assert text'),
    h('button', { onclick: () => addAssertion('assertUrl') }, 'Assert URL'),
    h('button', { onclick: () => addAssertion('assertExists') }, 'Assert exists'),
    h('button', { onclick: () => addAssertion('wait') }, 'Wait for element')
  );
}

function renderStepEditor(step) {
  if (!step) return h('div', { class: 'card muted' }, 'Select a step.');
  const fields = [h('strong', {}, step.type), step.proposed ? h('div', { class: 'card' }, 'Proposed. This step has not been executed.') : null];
  if (step.type === 'navigate' || step.type === 'assertUrl') {
    fields.push(labeled('URL or expected text', h('input', {
      type: 'text', value: step.type === 'navigate' ? (step.url || '') : (step.expected || ''),
      onchange: (event) => updateSelected(step.type === 'navigate' ? { url: event.target.value } : { expected: event.target.value }),
    })));
  }
  if (step.type === 'assertUrl' || step.type === 'assertText') {
    fields.push(labeled('Match', h('select', {
      onchange: (event) => updateSelected({ match: event.target.value }),
    }, h('option', { value: 'exact', selected: step.match !== 'partial' }, 'Exact'), h('option', { value: 'partial', selected: step.match === 'partial' }, 'Partial'))));
  }
  if (step.type === 'assertText') {
    fields.push(labeled('Expected text', h('input', {
      type: 'text', value: step.expected || '',
      onchange: (event) => updateSelected({ expected: event.target.value }),
    })));
  }
  if ((step.type === 'input' || step.type === 'select') && !step.secret) {
    fields.push(labeled('Value', h('input', {
      type: 'text', value: step.value || '',
      onchange: (event) => updateSelected({ value: event.target.value }),
    })));
  }
  if (step.secret) fields.push(h('div', { class: 'card' }, `Secret parameter {{${step.paramName}}}. The recorded value was not stored.`));
  if (step.type === 'checkbox') {
    fields.push(labeled('Checked', h('input', {
      type: 'checkbox', checked: !!step.checked,
      onchange: (event) => updateSelected({ checked: event.target.checked }),
    })));
  }
  if (step.selector) {
    fields.push(labeled('CSS override', h('input', {
      type: 'text', value: step.selector.uniqueCss || '',
      onchange: (event) => updateSelected({ selector: { ...step.selector, uniqueCss: event.target.value, strategy: event.target.value ? step.selector.strategy : step.selector.strategy } }),
    })));
    if (step.selector.ambiguous || step.selector.fragile) {
      fields.push(h('div', { class: 'card' }, step.selector.warning || 'This selector needs review.'));
    }
  }
  return h('div', { class: 'card stack' }, ...fields);
}

function labeled(text, field) {
  return h('label', { class: 'stack' }, text, field);
}

function savedTestLoader() {
  if (!model.tests.length) return h('div', { class: 'card muted' }, 'No saved tests yet.');
  return h('div', { class: 'card row' },
    h('select', { id: 'loadTest', onchange: (event) => { selectedTestId = event.target.value; } },
      ...model.tests.map((test) => h('option', { value: test.id, selected: test.id === selectedTestId }, test.name))),
    h('button', { onclick: loadSelectedTest }, 'Load into draft')
  );
}

async function mutateSteps(mutator) {
  const steps = (model.session.steps || []).map((step) => ({ ...step, selector: step.selector ? { ...step.selector } : undefined }));
  mutator(steps);
  await send({ type: 'steps:update', steps });
  await reload();
  render();
}

function updateSelected(patch) {
  return mutateSteps((steps) => {
    steps[selectedStep] = { ...steps[selectedStep], ...patch };
  }).catch((error) => { errorText = error.message; updateChrome(); });
}

function moveStep(direction) {
  const next = selectedStep + direction;
  if (!model.session || next < 0 || next >= model.session.steps.length) return;
  mutateSteps((steps) => {
    const [item] = steps.splice(selectedStep, 1);
    steps.splice(next, 0, item);
  }).then(() => { selectedStep = next; }).catch((error) => { errorText = error.message; updateChrome(); });
}

function deleteStep() {
  if (!model.session || model.session.steps.length < 2) {
    errorText = 'A draft needs at least one step. Discard the draft to remove it.';
    updateChrome();
    return;
  }
  mutateSteps((steps) => { steps.splice(selectedStep, 1); })
    .then(() => { selectedStep = Math.max(0, selectedStep - 1); })
    .catch((error) => { errorText = error.message; updateChrome(); });
}

function addAssertion(type) {
  const current = model.session.steps[selectedStep];
  const step = {
    id: `assert-${Date.now()}`,
    type,
    selector: type === 'assertUrl' ? undefined : (current && current.selector ? { ...current.selector } : undefined),
    expected: type === 'assertText' ? ((current && current.textSnapshot) || '') : type === 'assertUrl' ? (model.session.origin || '') : undefined,
    match: type === 'assertText' || type === 'assertUrl' ? 'partial' : undefined,
  };
  mutateSteps((steps) => { steps.splice(selectedStep + 1, 0, step); })
    .then(() => { selectedStep += 1; })
    .catch((error) => { errorText = error.message; updateChrome(); });
}

async function saveDraft() {
  errorText = '';
  try {
    const name = document.getElementById('testName').value;
    const response = await send({ type: 'tests:save', name });
    selectedTestId = response.test.id;
    await reload();
    view = 'run';
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

async function loadSelectedTest() {
  const select = document.getElementById('loadTest');
  try {
    await send({ type: 'session:load', id: select.value });
    selectedStep = 0;
    await reload();
    view = 'steps';
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

function renderRun() {
  const wrap = h('section', {}, h('h2', {}, 'Run tests'), h('p', { class: 'muted' }, 'Runs use the browser tab shown above. A failed step stays failed.'));
  const options = [];
  if (model.session && model.session.steps && model.session.steps.length) options.push({ id: 'draft', name: 'Current draft' });
  model.tests.forEach((test) => options.push({ id: test.id, name: test.source === 'ai' ? `${test.name} (AI proposal)` : test.name }));
  if (!options.length) {
    wrap.append(h('div', { class: 'card muted' }, 'Save a test or keep a draft before running.'));
    return wrap;
  }
  if (!options.some((option) => option.id === selectedTestId)) selectedTestId = options[0].id;
  const chosen = selectedTestId === 'draft'
    ? { steps: model.session.steps, source: 'recorded', proposed: false }
    : model.tests.find((test) => test.id === selectedTestId) || { steps: [] };
  wrap.append(h('div', { class: 'row' },
    h('select', { id: 'runChoice', onchange: (event) => { selectedTestId = event.target.value; render(); } },
      ...options.map((option) => h('option', { value: option.id, selected: option.id === selectedTestId }, option.name))),
    h('button', { class: 'primary', id: 'runButton', onclick: runChosen }, 'Run'),
    h('button', { class: 'danger', id: 'stopRun', onclick: () => send({ type: 'run:stop' }) }, 'Stop execution')
  ));
  if (chosen.proposed || chosen.source === 'ai') {
    wrap.append(h('div', { class: 'card' }, 'This is an AI proposal. Running it checks the steps; it does not make the proposal a passing test by itself.'));
  }
  const secrets = ASG.listSecretParams(chosen.steps || []);
  if (secrets.length) {
    wrap.append(h('div', { class: 'card stack' },
      h('strong', {}, 'Runtime secrets'),
      h('p', { class: 'muted' }, 'These values are sent only for this run and are not written to extension storage.'),
      ...secrets.map((name) => labeled(name, h('input', { type: 'password', 'data-param': name, autocomplete: 'off' })))
    ));
  }
  wrap.append(renderActiveRun());
  return wrap;
}

function renderActiveRun() {
  const run = model.activeRun;
  if (!run) return h('div', { class: 'card muted' }, 'No run yet.');
  const box = h('div', { class: 'card' }, h('strong', {}, `${run.testName || 'Run'} · ${run.status}`));
  if (run.error) box.append(h('div', { class: 'failed' }, run.error));
  (run.results || []).forEach((result) => {
    const line = h('div', { class: result.status }, `${result.index + 1}. ${result.type} · ${result.status}`);
    if (result.message) line.append(document.createTextNode(` — ${result.message}`));
    if (result.expected != null) line.append(h('div', {}, `Expected: ${result.expected}`));
    if (result.actual != null) line.append(h('div', {}, `Actual: ${result.actual}`));
    if (result.screenshot && String(result.screenshot).startsWith('data:image/')) {
      const image = new Image();
      image.alt = 'Failure screenshot';
      image.src = result.screenshot;
      image.style.maxWidth = '100%';
      line.append(image);
    } else if (result.screenshotError) line.append(h('div', { class: 'muted' }, result.screenshotError));
    box.append(line);
  });
  return box;
}

async function runChosen() {
  errorText = '';
  if (!targetTab) {
    errorText = 'Open the application tab you want to run against.';
    updateChrome();
    return;
  }
  const params = {};
  document.querySelectorAll('[data-param]').forEach((input) => { params[input.dataset.param] = input.value; });
  try {
    await send({
      type: 'run:start',
      draft: selectedTestId === 'draft',
      testId: selectedTestId === 'draft' ? undefined : selectedTestId,
      tabId: targetTab.id,
      params,
    });
    await reload();
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

function renderResults() {
  const wrap = h('section', {}, h('h2', {}, 'Results'));
  if (!model.runs.length) {
    wrap.append(h('div', { class: 'card muted' }, 'Execution history is empty. Runs appear here after you execute a test.'));
    return wrap;
  }
  const list = h('div', { class: 'list' });
  model.runs.forEach((run) => {
    list.append(h('button', {
      class: `step${run.id === selectedRunId ? ' selected' : ''}`,
      onclick: () => { selectedRunId = run.id; render(); },
    }, h('span', { class: run.status }, run.status), h('span', {}, `${run.testName || 'Run'} · ${new Date(run.startedAt).toLocaleString()}`)));
  });
  const run = model.runs.find((item) => item.id === selectedRunId) || model.runs[0];
  wrap.append(h('div', { class: 'split' }, list, runDetail(run)));
  return wrap;
}

function runDetail(run) {
  const box = h('div', { class: 'card stack' },
    h('strong', {}, run.testName || 'Run'),
    h('div', {}, `Status: ${run.status}`),
    run.error ? h('div', { class: 'failed' }, run.error) : null,
    h('button', { onclick: () => download(`run-${run.id}.json`, JSON.stringify(run, null, 2)) }, 'Export result JSON')
  );
  (run.results || []).forEach((result) => {
    const line = h('div', { class: result.status }, `${result.index + 1}. ${result.status} ${result.type}`);
    if (result.message) line.append(h('div', {}, result.message));
    if (result.expected != null) line.append(h('div', {}, `Expected: ${result.expected}`));
    if (result.actual != null) line.append(h('div', {}, `Actual: ${result.actual}`));
    if (result.screenshot && String(result.screenshot).startsWith('data:image/')) {
      const image = new Image();
      image.alt = 'Failure screenshot';
      image.src = result.screenshot;
      image.style.maxWidth = '100%';
      line.append(image);
    } else if (result.screenshotError) line.append(h('div', { class: 'muted' }, result.screenshotError));
    box.append(line);
  });
  return box;
}

function renderExport() {
  const wrap = h('section', {}, h('h2', {}, 'Code export'));
  const sourceSteps = model.session && model.session.steps && model.session.steps.length
    ? model.session.steps
    : ((model.tests.find((test) => test.id === selectedTestId) || model.tests[0] || {}).steps || []);
  const apiCalls = (model.session && model.session.apiCalls) || [];
  if (!sourceSteps.length && exportFramework !== 'restassured') {
    wrap.append(h('div', { class: 'card muted' }, 'Record or load a test to generate code.'));
    return wrap;
  }
  const code = generated(exportFramework, sourceSteps, apiCalls);
  wrap.append(h('div', { class: 'row' },
    h('select', { id: 'framework', onchange: (event) => { exportFramework = event.target.value; render(); } },
      h('option', { value: 'playwright', selected: exportFramework === 'playwright' }, 'Playwright TypeScript'),
      h('option', { value: 'selenium', selected: exportFramework === 'selenium' }, 'Selenium Java'),
      h('option', { value: 'cypress', selected: exportFramework === 'cypress' }, 'Cypress JavaScript'),
      h('option', { value: 'restassured', selected: exportFramework === 'restassured' }, 'REST Assured Java')),
    h('button', { onclick: () => navigator.clipboard.writeText(code) }, 'Copy'),
    h('button', { class: 'primary', onclick: () => downloadFiles(exportFramework, code) }, 'Download')
  ));
  wrap.append(h('textarea', { readonly: 'readonly' }, code));
  wrap.append(h('p', { class: 'muted' }, 'Secrets are environment parameters, not literals. Playwright is the output aimed at a direct local run.'));
  return wrap;
}

function generated(framework, steps, apiCalls) {
  if (framework === 'selenium') return CodeGen.renderSelenium(steps);
  if (framework === 'cypress') return CodeGen.renderCypress(steps);
  if (framework === 'restassured') return CodeGen.renderRestAssured(apiCalls);
  return CodeGen.renderPlaywright(steps);
}

function downloadFiles(framework, code) {
  const parts = code.split(/\/\/ ==== (.+?) ====\n/).filter(Boolean);
  if (parts.length < 2) {
    download(`${framework}.txt`, code);
    return;
  }
  for (let index = 0; index < parts.length; index += 2) {
    const name = parts[index].trim();
    const body = parts[index + 1] || '';
    if (name && body) download(name, body);
  }
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderAi() {
  const wrap = h('section', {},
    h('h2', {}, 'AI assistant'),
    h('p', { class: 'muted' }, 'Proposals are editable suggestions. They are not passing tests, and this extension does not execute model output as JavaScript.')
  );
  const mode = (model.settings && model.settings.aiMode) || 'mock';
  wrap.append(h('div', { class: 'card' }, mode === 'live' && model.settings.aiProxyUrl
    ? `Live proxy: ${model.settings.aiProxyUrl}`
    : 'Mock mode is active. No provider is called unless you save a proxy URL and choose Live in Settings.'));
  wrap.append(h('textarea', { id: 'aiPrompt' }, 'Test login with valid and invalid credentials, check error messages, and verify navigation.'));
  wrap.append(h('div', { class: 'row' }, h('button', { class: 'primary', id: 'aiGenerate', onclick: generatePlan }, 'Generate proposal')));
  if (!aiPlan) return wrap;
  wrap.append(h('div', { class: 'card' }, h('strong', {}, 'Proposed, not executed. '), aiPlan.summary || ''));
  aiPlan.cases.forEach((testCase, caseIndex) => {
    const box = h('div', { class: 'card stack' }, h('strong', {}, testCase.name));
    testCase.steps.forEach((step, stepIndex) => {
      box.append(h('label', { class: 'stack' }, `${stepIndex + 1}. ${step.type}`, h('input', {
        type: 'text',
        value: stepSummary(step),
        onchange: (event) => editAiStep(caseIndex, stepIndex, event.target.value),
      })));
      if (step.warning) box.append(h('div', { class: 'muted' }, step.warning));
      if (!step.selector && step.type !== 'navigate' && step.type !== 'assertUrl') {
        box.append(h('div', { class: 'muted' }, 'No selector from the open page.'));
      }
    });
    box.append(h('button', { class: 'primary', onclick: () => saveAiCase(caseIndex) }, 'Approve and save'));
    wrap.append(box);
  });
  return wrap;
}

function editAiStep(caseIndex, stepIndex, summary) {
  const step = aiPlan.cases[caseIndex].steps[stepIndex];
  if (step.type === 'navigate' || step.type === 'assertUrl') step.expected = summary;
  if (step.type === 'navigate') step.url = summary.replace(/^Navigate\s+/, '') || step.url;
  if (step.type === 'assertText') {
    const match = summary.match(/"([^"]*)"/);
    if (match) step.expected = match[1];
  }
  if (step.type === 'input' && !step.secret) {
    const match = summary.match(/^Enter "(.*)"/);
    if (match) step.value = match[1];
  }
}

async function generatePlan() {
  errorText = '';
  try {
    const prompt = document.getElementById('aiPrompt').value;
    const origin = (targetTab && targetTab.url) || (model.session && model.session.origin) || '';
    const response = await send({
      type: 'ai:plan',
      prompt,
      origin,
      tabId: targetTab ? targetTab.id : null,
      mode: model.settings.aiMode,
    });
    aiPlan = response.plan;
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

async function saveAiCase(caseIndex) {
  const testCase = aiPlan.cases[caseIndex];
  try {
    const response = await send({
      type: 'tests:create',
      test: { name: testCase.name, source: 'ai', origin: (targetTab && ASG.originOf(targetTab.url)) || '', steps: testCase.steps },
    });
    selectedTestId = response.test.id;
    await reload();
    view = 'steps';
    await send({ type: 'session:load', id: response.test.id });
    await reload();
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

function renderSettings() {
  const settings = model.settings || defaultSettings();
  return h('section', {},
    h('h2', {}, 'Settings'),
    labeled('Step timeout (ms)', h('input', { id: 'stepTimeout', type: 'number', value: String(settings.stepTimeoutMs) })),
    labeled('Navigation timeout (ms)', h('input', { id: 'navTimeout', type: 'number', value: String(settings.navigationTimeoutMs) })),
    labeled('AI mode', h('select', { id: 'aiMode' },
      h('option', { value: 'mock', selected: settings.aiMode !== 'live' }, 'Mock (no network)'),
      h('option', { value: 'live', selected: settings.aiMode === 'live' }, 'Live proxy'))),
    labeled('AI proxy URL', h('input', { id: 'aiProxyUrl', type: 'url', value: settings.aiProxyUrl || '', placeholder: 'https://your-proxy.example/plan' })),
    labeled('Proxy access token', h('input', { id: 'aiProxyToken', type: 'password', value: settings.aiProxyToken || '', autocomplete: 'off' })),
    h('p', { class: 'muted' }, 'The token stays in extension storage and is sent only to the proxy URL you enter. This extension does not embed a provider key.'),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: saveSettings }, 'Save settings'))
  );
}

async function saveSettings() {
  errorText = '';
  try {
    await send({
      type: 'settings:set',
      settings: {
        stepTimeoutMs: Number(document.getElementById('stepTimeout').value),
        navigationTimeoutMs: Number(document.getElementById('navTimeout').value),
        aiMode: document.getElementById('aiMode').value,
        aiProxyUrl: document.getElementById('aiProxyUrl').value,
        aiProxyToken: document.getElementById('aiProxyToken').value,
      },
    });
    await reload();
    render();
  } catch (error) {
    errorText = error.message;
    updateChrome();
  }
}

document.getElementById('nav').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  view = button.dataset.view;
  errorText = '';
  render();
});

document.addEventListener('focusin', (event) => {
  if (event.target.matches('input, textarea, select')) dirty = true;
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || !active.matches || !active.matches('input, textarea, select')) dirty = false;
  }, 200);
});

chrome.storage.onChanged.addListener(() => {
  reload().then(() => {
    if (!dirty) render();
    else updateChrome();
  }).catch((error) => {
    errorText = error.message;
    updateChrome();
  });
});

reload().then(async () => {
  await refreshTarget();
  render();
}).catch((error) => {
  errorText = error.message;
  render();
});

setInterval(() => { refreshTarget().catch(() => {}); }, 1500);
