import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const mutex = require('../lib/mutex.js');
const origin = require('../lib/origin.js');
const redact = require('../lib/redact.js');
const schema = require('../lib/schema.js');
const reducer = require('../lib/reducer.js');
const runner = require('../lib/runner.js');
const ai = require('../lib/ai.js');
const selectors = require('../lib/selectors.js');
const code = require('../codegen.js');
const registration = require('../lib/registration.js');

test('serialized writes keep every concurrent event', async () => {
  const withLock = mutex.createMutex();
  let stored = [];
  async function append(item) {
    await withLock(async () => {
      const snapshot = structuredClone(stored);
      await new Promise((resolve) => setTimeout(resolve, 5));
      snapshot.push(item);
      stored = snapshot;
    });
  }
  await Promise.all([1, 2, 3, 4].map((n) => append({ n })));
  assert.deepEqual(stored.map((item) => item.n), [1, 2, 3, 4]);
});

test('the old unlocked storage pattern drops events', async () => {
  let stored = [];
  async function append(item) {
    const snapshot = structuredClone(stored);
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot.push(item);
    stored = snapshot;
  }
  await Promise.all([1, 2, 3, 4].map((n) => append({ n })));
  assert.equal(stored.length, 1);
});

test('recording does not start before a session exists or while paused', () => {
  const ids = sequentialIds();
  const session = reducer.createSession({
    tabId: 7,
    origin: 'http://127.0.0.1:4173',
    url: 'http://127.0.0.1:4173/',
    networkCapture: false,
  }, ids);
  const paused = reducer.reduceEvent(session, { kind: 'status', status: 'paused' }, ids);
  const after = reducer.reduceEvent(paused, { kind: 'ui', step: { type: 'click', selector: { strategy: 'id', value: 'go' } } }, ids);
  assert.equal(after.steps.length, 1);
  assert.equal(reducer.reduceEvent(null, { kind: 'ui', step: { type: 'click' } }, ids), null);
});

test('events stay in order, inputs coalesce, and other tabs or origins are ignored', () => {
  const ids = sequentialIds();
  let session = reducer.createSession({
    tabId: 7,
    origin: 'http://127.0.0.1:4173',
    url: 'http://127.0.0.1:4173/',
    networkCapture: true,
  }, ids);
  const selector = { strategy: 'testid', attr: 'data-testid', value: 'username' };
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'input', selector, value: 'd' } }, ids);
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'input', selector, value: 'demo' } }, ids);
  session = reducer.reduceEvent(session, { kind: 'navigate', url: 'http://127.0.0.1:4173/', tabId: 7 }, ids);
  session = reducer.reduceEvent(session, { kind: 'navigate', url: 'http://127.0.0.1:4173/app.html', tabId: 7 }, ids);
  const beforeDuplicate = session.steps.length;
  session = reducer.reduceEvent(session, { kind: 'navigate', url: 'http://127.0.0.1:4173/app.html', tabId: 7 }, ids);
  assert.equal(session.steps.length, beforeDuplicate);
  session = reducer.reduceEvent(session, { kind: 'navigate', url: 'https://example.com/', tabId: 7 }, ids);
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: { strategy: 'id', value: 'x' } } }, ids);
  const otherTab = reducer.reduceEvent(session, { kind: 'navigate', url: 'http://127.0.0.1:4173/elsewhere', tabId: 9 }, ids);
  assert.equal(otherTab, session);
  assert.deepEqual(session.steps.map((step) => step.type), ['navigate', 'input', 'navigate', 'navigate', 'click']);
  assert.equal(session.steps[1].value, 'demo');
  assert.match(session.warnings.join(' '), /Ignored navigation/);
});

test('passwords and tokens are removed before a step or API call is kept', () => {
  const ids = sequentialIds();
  let session = reducer.createSession({
    tabId: 1,
    origin: 'http://127.0.0.1:4173',
    url: 'http://127.0.0.1:4173/',
    networkCapture: true,
  }, ids);
  session = reducer.reduceEvent(session, {
    kind: 'ui',
    step: {
      type: 'input',
      secret: true,
      paramName: 'password',
      value: 'demo123',
      selector: { strategy: 'testid', value: 'password' },
    },
  }, ids);
  session = reducer.reduceEvent(session, {
    kind: 'api',
    call: {
      method: 'POST',
      url: 'http://127.0.0.1:4173/api/login?token=abc',
      requestBody: JSON.stringify({ username: 'demo', password: 'demo123' }),
      status: 200,
      contentType: 'application/json',
      responseBody: JSON.stringify({ access_token: 'eyJaaaaaaaa.bbbbbbbb.cccc', name: 'Demo' }),
    },
  }, ids);
  const stored = JSON.stringify(session);
  assert.equal(stored.includes('demo123'), false);
  assert.equal(stored.includes('eyJaaaaaaaa'), false);
  assert.equal(session.steps.at(-1).secret, true);
  assert.equal(session.steps.at(-1).value, undefined);
  assert.match(session.apiCalls[0].url, /token=REDACTED/);
  assert.match(session.apiCalls[0].requestBody, /"password":"REDACTED"/);
  assert.doesNotMatch(session.apiCalls[0].responseBody, /eyJ/);
});

test('sensitive fields are recognized without treating usernames as secrets', () => {
  const password = fakeField({ type: 'password', name: 'password', autocomplete: 'current-password' });
  const username = fakeField({ type: 'text', name: 'username' });
  assert.equal(redact.isSensitiveField(password), true);
  assert.equal(redact.paramNameFor(password), 'password');
  assert.equal(redact.isSensitiveField(username), false);
});

test('unsupported pages fail with a specific reason', () => {
  assert.match(origin.unsupportedReason('chrome://version'), /cannot be scripted/);
  assert.match(origin.unsupportedReason('https://chromewebstore.google.com/detail/x'), /Chrome Web Store/);
  assert.equal(origin.unsupportedReason('about:blank'), 'ignore');
  assert.equal(origin.unsupportedReason('http://127.0.0.1:4173/'), '');
});

test('selector prefers a unique test id and warns when text is ambiguous', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <form>
      <input id="user" data-testid="username" name="username">
      <button>Save</button>
      <button>Save</button>
    </form>
  </body>`);
  const { document } = dom.window;
  const input = document.querySelector('input');
  const described = selectors.describeElement(input, document);
  assert.equal(described.strategy, 'testid');
  assert.equal(described.ambiguous, false);
  assert.equal(selectors.queryAll(document, described).length, 1);
  const button = document.querySelectorAll('button')[0];
  const ambiguous = selectors.describeElement(button, document);
  assert.equal(ambiguous.ambiguous, false);
  assert.equal(selectors.queryAll(document, { strategy: 'css', value: ambiguous.uniqueCss, uniqueCss: ambiguous.uniqueCss }).length, 1);
  assert.match(ambiguous.warning || '', /structural CSS|No stable selector/);
});

test('a failed step stays failed and later steps are skipped', async () => {
  const calls = [];
  const outcome = await runner.executeSequence([
    { id: 'a', type: 'click' },
    { id: 'b', type: 'assertText' },
    { id: 'c', type: 'click' },
  ], {
    async execute(step) {
      calls.push(step.id);
      if (step.id === 'b') throw Object.assign(new Error('Text did not match'), { expected: 'Admin', actual: 'Demo' });
      return { actual: 'ok' };
    },
  }, {});
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(outcome.results.map((result) => result.status), ['passed', 'failed', 'skipped']);
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(outcome.results[1].expected, 'Admin');
  assert.equal(outcome.results[1].actual, 'Demo');
});

test('stopping execution does not mark the run passed', async () => {
  let stopped = false;
  const outcome = await runner.executeSequence([
    { id: 'a', type: 'click' },
    { id: 'b', type: 'click' },
  ], { async execute() { return { actual: 'ok' }; } }, { shouldStop: () => stopped });
  stopped = true;
  const stoppedRun = await runner.executeSequence([
    { id: 'a', type: 'click' },
    { id: 'b', type: 'click' },
  ], { async execute() { stopped = true; return { actual: 'ok' }; } }, { shouldStop: () => stopped });
  assert.equal(outcome.status, 'passed');
  assert.equal(stoppedRun.status, 'stopped');
  assert.equal(stoppedRun.results[1].status, 'skipped');
});

test('mock AI plans are schema-valid suggestions and reject executable fields', () => {
  const plan = ai.mockPlan('Test login with valid and invalid credentials, check error messages, and verify navigation.', {
    origin: 'http://127.0.0.1:4173',
  });
  assert.equal(plan.source, 'mock');
  assert.equal(plan.proposed, true);
  assert.equal(plan.cases.length, 2);
  assert.equal(JSON.stringify(plan).includes('demo123'), false);
  assert.equal(JSON.stringify(plan).includes('data-testid'), false);
  const validCase = plan.cases.find((item) => item.steps.some((step) => step.paramName === 'password'));
  assert.equal(plan.cases[0].name.includes('Invalid'), true);
  assert.ok(validCase);
  assert.equal(validCase.steps.some((step) => step.selector), false);
  assert.throws(() => schema.validatePlan({ ...plan, script: 'alert(1)' }), /executable/i);
  assert.throws(() => schema.validatePlan({
    title: 'bad',
    cases: [{ name: 'bad', steps: [{ type: 'eval', id: 'x' }] }],
  }), /unsupported type/i);
});

test('mock AI uses selectors only when the open page has that element', () => {
  const evidence = {
    pageUrl: 'http://127.0.0.1:4173/',
    items: [
      { tag: 'input', type: 'text', testid: 'username', id: 'username', name: 'username', label: 'Username', text: '', role: '' },
      { tag: 'input', type: 'password', testid: 'password', id: 'password', name: 'password', label: 'Password', text: '', role: '' },
      { tag: 'button', type: 'submit', testid: 'submit', id: '', name: '', label: '', text: 'Sign in', role: '' },
      { tag: 'p', type: '', testid: 'error', id: 'error', name: '', label: '', text: '', role: '' },
    ],
  };
  const plan = ai.mockPlan('Test the login page with invalid credentials, verify the error message, and check navigation.', { evidence });
  assert.equal(plan.cases.length, 1);
  const steps = plan.cases[0].steps;
  const used = steps.map((step) => step.selector && step.selector.value).filter(Boolean).sort();
  assert.deepEqual(used, ['error', 'password', 'submit', 'username']);
  assert.equal(steps.some((step) => step.type === 'assertUrl' && step.expected === evidence.pageUrl), true);
  assert.equal(steps.some((step) => step.type === 'assertText' && step.expected === ''), true);
  assert.equal(JSON.stringify(plan).includes('/app'), false);
  assert.equal(JSON.stringify(plan).includes('demo123'), false);
  const grounded = ai.groundPlan({
    title: plan.title,
    summary: plan.summary,
    source: 'mock',
    proposed: true,
    cases: [{
      name: 'edited',
      steps: [{ id: 'a', type: 'click', proposed: true, selector: { strategy: 'testid', attr: 'data-testid', value: 'not-on-page' } }],
    }],
  }, evidence);
  assert.equal(grounded.cases[0].steps[0].selector, undefined);
  const approved = steps.map((step) => (step.type === 'assertText' ? { ...step, expected: 'Wrong message' } : step));
  const playwright = code.renderPlaywright(approved);
  assert.match(playwright, /getByTestId\("error"\)/);
  assert.match(playwright, /getByTestId\("username"\)/);
  assert.match(playwright, /TEST_WRONGPASSWORD/);
  assert.equal(playwright.includes('not-on-page'), false);
  assert.equal(playwright.includes('demo123'), false);
});

test('the login prompt proposes invalid then success, and edits do not swallow locators', () => {
  const evidence = {
    pageUrl: 'http://127.0.0.1:4173/',
    items: [
      { tag: 'input', type: 'text', testid: 'username', id: 'username', name: 'username', label: 'Username', text: '', role: '' },
      { tag: 'input', type: 'password', testid: 'password', id: 'password', name: 'password', label: 'Password', text: '', role: '' },
      { tag: 'button', type: 'submit', testid: 'submit', id: '', name: '', label: '', text: 'Sign in', role: '' },
      { tag: 'p', type: '', testid: 'error', id: 'error', name: '', label: '', text: '', role: '' },
    ],
  };
  const plan = ai.mockPlan('Test the login form, verify invalid credentials show an error, then test a successful login.', { evidence });
  assert.equal(plan.cases.length, 2);
  assert.match(plan.cases[0].name, /Invalid/);
  assert.match(plan.cases[1].name, /Valid/);
  assert.equal(plan.cases[1].steps.find((step) => step.type === 'assertUrl').expected, '');
  assert.equal(JSON.stringify(plan).includes('/app'), false);
  const errorStep = plan.cases[0].steps.find((step) => step.type === 'assertText');
  ai.applyStepEdit(errorStep, 'Assert text equals "Invalid credentials" on data-testid=error');
  assert.equal(errorStep.expected, 'Invalid credentials');
  assert.equal(errorStep.selector.value, 'error');
  const userStep = plan.cases[1].steps.find((step) => step.type === 'input' && !step.secret);
  ai.applyStepEdit(userStep, 'Enter "demo" into data-testid=username');
  assert.equal(userStep.value, 'demo');
  assert.equal(userStep.selector.value, 'username');
  const urlStep = plan.cases[1].steps.find((step) => step.type === 'assertUrl');
  ai.applyStepEdit(urlStep, 'Assert URL equals "http://127.0.0.1:4173/app.html"');
  assert.equal(urlStep.expected, 'http://127.0.0.1:4173/app.html');
  const exported = code.renderPlaywright(plan.cases[1].steps);
  assert.match(exported, /getByTestId\("username"\)/);
  assert.match(exported, /TEST_PASSWORD/);
  assert.equal(exported.includes('demo123'), false);
});

test('the live proxy exits unless its own credentials are set', () => {
  const result = spawnSync(process.execPath, ['server/ai-proxy.mjs'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}`, /PROXY_AUTH_TOKEN/);
  assert.match(`${result.stderr}`, /AI_API_KEY/);
});

test('all four generators keep the page-object flow and parameterize secrets', () => {
  const actions = [
    { type: 'navigate', url: 'https://example.com/login' },
    { type: 'input', selector: { strategy: 'testid', value: 'username-input' }, value: 'alice' },
    { type: 'input', selector: { strategy: 'ariaLabel', value: 'Password' }, secret: true, paramName: 'password' },
    { type: 'click', selector: { strategy: 'text', value: 'Sign in', tag: 'button' } },
    { type: 'assertText', selector: { strategy: 'testid', value: 'welcome' }, expected: 'Welcome', match: 'partial' },
    { type: 'click', selector: { strategy: 'css', value: 'div', fragile: true } },
  ];
  const selenium = code.renderSelenium(actions);
  const playwright = code.renderPlaywright(actions);
  const cypress = code.renderCypress(actions);
  for (const output of [selenium, playwright, cypress]) {
    assert.match(output, /RecordedPage/);
    assert.match(output, /navigateTo/);
    assert.match(output, /alice/);
    assert.equal(output.includes('hunter2'), false);
    assert.equal(output.includes('super-secret'), false);
    assert.match(output, /TEST_PASSWORD/);
    assert.match(output, /FRAGILE SELECTOR/);
    assert.match(output, /Welcome/);
  }
  assert.match(playwright, /@playwright\/test/);
  assert.match(playwright, /getByTestId\("username-input"\)/);
  assert.match(playwright, /getByLabel\("Password"\)/);
  assert.match(playwright, /toContainText/);
  assert.match(selenium, /WebDriverWait/);
  const quoted = code.renderPlaywright([
    { type: 'input', selector: { strategy: 'id', value: 'a"b' }, value: 'say "hi"\nnext' },
  ]);
  assert.match(quoted, /say \\"hi\\"\\nnext/);
  const api = code.renderRestAssured([{
    method: 'POST',
    url: 'https://example.com/api/session?token=secret-token',
    requestBody: JSON.stringify({ password: 'demo123', name: 'Ada' }),
    status: 200,
    contentType: 'application/json',
    responseBody: JSON.stringify({ name: 'Ada', roles: ['admin'] }),
  }, { method: 'TRACE', url: 'https://example.com/admin', status: 200 }]);
  assert.equal(api.includes('demo123'), false);
  assert.equal(api.includes('secret-token'), false);
  assert.match(api, /equalTo\("Ada"\)/);
  assert.match(api, /Skipped unsupported HTTP method/);
});

test('generated names stay short, repeated clicks drop, and validations remain', () => {
  const dom = new JSDOM('<!doctype html><button>Add to cart</button><div><span>x</span></div>');
  const button = selectors.describeElement(dom.window.document.querySelector('button'), dom.window.document);
  const span = selectors.describeElement(dom.window.document.querySelector('span'), dom.window.document);
  assert.equal(button.strategy, 'role');
  assert.equal(button.fragile, false);
  assert.equal(span.strategy, 'css');
  assert.equal(span.fragile, true);
  assert.match(span.warning, /structural CSS/);
  const ids = sequentialIds();
  let session = reducer.createSession({
    tabId: 7,
    origin: 'https://shop.example',
    url: 'https://shop.example/catalog',
    networkCapture: false,
  }, ids);
  const add = { strategy: 'testid', value: 'add-cart', matchCount: 1 };
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: add, recordedAt: 15 } }, ids);
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: add, recordedAt: 15 } }, ids);
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: add, recordedAt: 480 } }, ids);
  const recordedClicks = session.steps.filter((step) => step.type === 'click');
  assert.equal(recordedClicks.length, 2);
  assert.deepEqual(recordedClicks.map((step) => step.recordedAt), [15, 480]);
  const model = code.buildPageModel([
    { type: 'click', selector: add, recordedAt: 15 },
    { type: 'click', selector: add, recordedAt: 15 },
    { type: 'click', selector: add, recordedAt: 480 },
    { type: 'navigate', url: 'https://shop.example/catalog' },
    { type: 'navigate', url: 'https://shop.example/product' },
    { type: 'navigate', url: 'javascript:alert(1)' },
    { type: 'click', selector: { strategy: 'css', value: 'main > div:nth-of-type(2) > span:nth-of-type(3)', fragile: true } },
    { type: 'input', selector: { strategy: 'testid', value: 'password' }, secret: true, paramName: 'password' },
    { type: 'assertText', selector: { strategy: 'testid', value: 'cart' }, expected: 'Notebook is in the cart', match: 'exact' },
    { type: 'assertUrl', expected: 'https://shop.example/product', match: 'exact' },
  ]);
  const names = model.calls.map((call) => call.name);
  assert.deepEqual(names.filter((name) => name.startsWith('click')), ['clickAddCart', 'clickAddCart', 'clickElement']);
  const keptOnPurpose = code.buildPageModel([
    { type: 'click', selector: add },
    { type: 'click', selector: add },
  ]);
  assert.equal(keptOnPurpose.calls.length, 2);
  assert.deepEqual(model.calls.filter((call) => call.name === 'navigateTo').map((call) => call.args[0]), [
    'https://shop.example/catalog',
    'https://shop.example/product',
  ]);
  assert.equal(names.includes('assertTextCart'), true);
  assert.equal(names.includes('assertUrl'), true);
  const playwright = code.renderPlaywright([
    { type: 'navigate', url: 'https://shop.example/catalog' },
    { type: 'navigate', url: 'https://shop.example/product' },
    { type: 'input', selector: { strategy: 'testid', value: 'password' }, secret: true, paramName: 'password' },
    { type: 'assertText', selector: { strategy: 'testid', value: 'cart' }, expected: 'Notebook is in the cart', match: 'exact' },
  ]);
  assert.match(playwright, /toHaveText/);
  assert.match(playwright, /Notebook is in the cart/);
  assert.match(playwright, /TEST_PASSWORD/);
  assert.equal(playwright.includes('demo123'), false);
  assert.equal(playwright.includes('javascript:'), false);
  assert.match(playwright, /https:\/\/shop\.example\/catalog/);
  assert.match(playwright, /https:\/\/shop\.example\/product/);
  const page = code.renderPlaywright([
    { type: 'click', selector: { strategy: 'testid', value: 'save', matchCount: 1 } },
    { type: 'click', selector: { strategy: 'role', value: 'button', name: 'Save', matchCount: 1 } },
    { type: 'click', selector: { strategy: 'css', value: 'main > div:nth-of-type(4)', uniqueCss: 'main > div:nth-of-type(4)', fragile: true, warning: 'No stable selector was unique. Using a structural CSS path.' } },
    { type: 'click', selector: { strategy: 'testid', value: 'save', matchCount: 2, ambiguous: true, uniqueCss: 'form > button:nth-of-type(2)' } },
  ]);
  const methodNames = [...page.matchAll(/async (click\w+)\(/g)].map((match) => match[1]);
  assert.deepEqual(methodNames, ['clickSave', 'clickSave2', 'clickElement', 'clickElement2']);
  assert.equal(new Set(methodNames).size, methodNames.length);
  assert.match(page, /async clickSave\(\) \{\n\s+await this\.page\.getByTestId\("save"\)\.click/);
  assert.match(page, /async clickSave2\(\) \{\n\s+await this\.page\.getByRole\("button", \{ name: "Save", exact: true \}\)\.click/);
  assert.match(page, /async clickElement\(\) \{\n\s+await this\.page\.locator\("main > div:nth-of-type\(4\)"\)\.click[\s\S]*structural CSS path/);
  assert.match(page, /async clickElement2\(\) \{\n\s+await this\.page\.locator\("form > button:nth-of-type\(2\)"\)\.click[\s\S]*structural CSS path/);
  assert.equal([...page.matchAll(/getByTestId\("save"\)/g)].length, 1);
});

test('smart locators rank verified candidates and leave failures failed', async () => {
  const dom = new JSDOM(`<!doctype html><body>
    <main>
      <label for="user">Username</label>
      <input id="user" data-testid="username" name="username" value="demo123">
      <button data-testid="add-cart">Add to cart</button>
      <button data-testid="add-cart">Add to cart</button>
      <section data-testid="notebook"><button type="button">Add to cart</button></section>
      <section data-testid="pen"><button type="button">Add to cart</button></section>
      <button id="ember4821">Save draft</button>
      <div><span>x</span></div>
      <button data-testid="only-save">Save</button>
      <button>Save</button>
    </main>
  </body>`);
  const { document } = dom.window;
  const user = selectors.describeElement(document.querySelector('#user'), document);
  assert.equal(user.strategy, 'testid');
  assert.equal(user.ambiguous, false);
  assert.equal(selectors.queryAll(document, user)[0], document.querySelector('#user'));
  assert.equal(JSON.stringify(user).includes('demo123'), false);
  assert.equal(user.fingerprint.tag, 'input');
  assert.ok(user.candidates.some((candidate) => candidate.strategy === 'role' && candidate.verified === 'accessibility'));

  const duplicate = selectors.describeElement(document.querySelectorAll('[data-testid="add-cart"]')[0], document);
  const duplicateTestid = duplicate.candidates.find((candidate) => candidate.strategy === 'testid');
  assert.equal(duplicate.strategy === 'testid', false);
  assert.equal(duplicateTestid.unique, false);
  assert.ok(duplicateTestid.matchCount > 1);

  const notebook = document.querySelector('[data-testid="notebook"] button');
  const pen = document.querySelector('[data-testid="pen"] button');
  const scoped = selectors.describeElement(notebook, document);
  assert.equal(scoped.strategy, 'css');
  assert.equal(scoped.tier, 'verified-scoped');
  assert.equal(scoped.fragile, false);
  assert.equal(selectors.queryAll(document, scoped)[0], notebook);
  assert.notEqual(selectors.queryAll(document, scoped)[0], pen);
  const roleBackup = scoped.candidates.find((candidate) => candidate.strategy === 'role');
  assert.equal(roleBackup.unique, false);

  const dynamic = selectors.describeElement(document.querySelector('#ember4821'), document);
  assert.equal(dynamic.strategy, 'role');
  assert.equal(dynamic.candidates.some((candidate) => candidate.strategy === 'id'), false);
  assert.match(dynamic.explanation, /not a Playwright/);

  const bare = selectors.describeElement(document.querySelector('span'), document);
  assert.equal(bare.strategy, 'css');
  assert.equal(bare.tier, 'structural');
  assert.match(bare.warning, /structural CSS/);

  const changed = selectors.describeElement(document.querySelector('[data-testid="only-save"]'), document);
  changed.fingerprint = { tag: 'button', role: 'button', name: 'Save' };
  document.querySelector('[data-testid="only-save"]').removeAttribute('data-testid');
  const report = selectors.suggestRepairs(changed, document);
  assert.equal(report.primaryCount, 0);
  assert.equal(changed.strategy, 'testid');
  const safe = report.suggestions.filter((item) => item.status === 'safe');
  const unsafe = report.suggestions.filter((item) => item.status === 'unsafe');
  assert.ok(safe.length >= 1);
  assert.ok(unsafe.some((item) => item.strategy === 'role' && /will not be clicked/.test(item.reason)));
  const repaired = selectors.applyCandidate(changed, safe[0]);
  assert.equal(selectors.queryAll(document, repaired).length, 1);
  assert.equal(selectors.queryAll(document, changed).length, 0);
  assert.equal(selectors.applyCandidate(changed, unsafe[0]), changed);

  const mismatch = selectors.suggestRepairs({
    strategy: 'testid',
    value: 'missing',
    fingerprint: { tag: 'button', role: 'button', name: 'Save' },
    candidates: [
      { strategy: 'testid', value: 'missing' },
      { strategy: 'label', value: 'Username', tier: 'verified-contract', rank: 1, verified: 'dom' },
    ],
  }, document);
  assert.equal(mismatch.suggestions[0].status, 'unsafe');
  assert.match(mismatch.suggestions[0].reason, /Tag changed/);

  const legacy = schema.sanitizeSelector({ strategy: 'testid', value: 'username', matchCount: 1 });
  assert.equal(legacy.strategy, 'testid');
  assert.equal(legacy.value, 'username');
  assert.equal(legacy.candidates[0].verified, 'recorded');
  assert.match(legacy.candidates[0].explanation, /before backup/);

  const ids = sequentialIds();
  let session = reducer.createSession({ tabId: 1, origin: 'https://shop.example', url: 'https://shop.example/', networkCapture: false }, ids);
  const add = { strategy: 'testid', value: 'add-cart', matchCount: 1 };
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: add, recordedAt: 10 } }, ids);
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: add, recordedAt: 10 } }, ids);
  session = reducer.reduceEvent(session, { kind: 'ui', step: { type: 'click', selector: add, recordedAt: 90 } }, ids);
  assert.equal(session.steps.filter((step) => step.type === 'click').length, 2);

  const generated = code.renderPlaywright([
    { type: 'click', selector: scoped },
    { type: 'input', selector: { strategy: 'testid', value: 'password' }, secret: true, paramName: 'password' },
  ]);
  const selenium = code.renderSelenium([{ type: 'click', selector: scoped }]);
  const cypress = code.renderCypress([{ type: 'click', selector: scoped }]);
  assert.match(generated, /locator\("\[data-testid=\\"notebook\\"\] button"\)/);
  assert.equal(generated.includes('nth-of-type'), false);
  assert.match(generated, /TEST_PASSWORD/);
  assert.match(selenium, /By\.cssSelector\("\[data-testid=\\"notebook\\"\] button"\)/);
  assert.match(cypress, /\[data-testid=\\"notebook\\"\] button/);
  assert.equal(generated.includes('%'), false);

  const outcome = await runner.executeSequence([
    { id: 'a', type: 'click' },
    { id: 'b', type: 'assertText' },
  ], {
    async execute() {
      throw Object.assign(new Error('Element not found before timeout'), {
        repairs: [{ status: 'safe', strategy: 'role', value: 'button', reason: 'Unique match.' }],
      });
    },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.results[0].status, 'failed');
  assert.equal(outcome.results[0].repairs[0].status, 'safe');
  assert.equal(outcome.results[1].status, 'skipped');
});

test('page summaries stay small and plans do not keep secrets or remote code', () => {
  const dom = new JSDOM(`<!doctype html><html><head><title>Demo bank</title></head><body>
    <h1>Demo bank</h1>
    <form id="login">
      <label for="username">Username</label>
      <input id="username" data-testid="username" name="username" value="demo123">
      <label for="password">Password</label>
      <input id="password" data-testid="password" name="password" type="password" value="demo123">
      <button data-testid="submit" type="submit">Sign in</button>
      <p data-testid="error" hidden>Invalid credentials</p>
    </form>
    <p>This paragraph is not an interactive control and should stay out of the summary.</p>
    <div role="alert">Invalid credentials</div>
  </body></html>`, { url: 'http://127.0.0.1:4173/' });
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  try {
    const summary = ai.compactSummary(ai.collectPageEvidence());
    const encoded = JSON.stringify(summary);
    assert.equal(encoded.includes('demo123'), false);
    assert.equal(encoded.includes('not an interactive control'), false);
    assert.match(summary.purpose, /Demo bank/);
    const password = summary.items.find((item) => item.testid === 'password');
    assert.equal(password.type, 'password');
    assert.equal(password.form, 'login');
    assert.ok(password.locators.some((locator) => locator.strategy === 'testid' && locator.value === 'password'));
    assert.ok(summary.messages.some((message) => message.text === 'Invalid credentials'));
    assert.ok(summary.items.length <= 24);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }

  const evidence = {
    pageUrl: 'http://127.0.0.1:4173/',
    items: [{ tag: 'input', type: 'password', testid: 'password', name: 'password', label: 'Password' }],
  };
  const first = ai.planCacheKey('Test login', evidence);
  const second = ai.planCacheKey('Test login', evidence);
  const changed = ai.planCacheKey('Test checkout', evidence);
  assert.equal(first, second);
  assert.notEqual(first, changed);
  const unsafe = ai.groundPlan({
    title: 'Unsafe',
    summary: 'Review',
    source: 'live',
    cases: [{
      name: 'Unsafe',
      steps: [
        { id: 'go', type: 'navigate', url: 'javascript:alert(1)' },
        { id: 'password', type: 'input', value: 'demo123', selector: { strategy: 'testid', value: 'password' } },
      ],
    }],
  }, evidence);
  assert.equal(unsafe.cases[0].steps[0].url, undefined);
  assert.equal(unsafe.cases[0].steps[1].secret, true);
  assert.equal(JSON.stringify(unsafe).includes('demo123'), false);
  assert.equal(JSON.stringify(unsafe).includes('javascript:'), false);
});

test('a second recording updates the existing recorder instead of registering it twice', () => {
  const files = ['lib/id.js', 'content.js'];
  const first = registration.desiredScripts('https://www.google.com', false, files, 'injected/network.js');
  const registered = [{ id: 'asg-recorder', ...first[0] }, { id: 'unrelated-script', matches: ['<all_urls>'] }];
  const next = registration.desiredScripts('https://www.flipkart.com', false, files, 'injected/network.js');
  const plan = registration.planRegistration(registered, next);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.insert.map((script) => script.id), []);
  assert.deepEqual(plan.update.map((script) => script.id), ['asg-recorder']);
  assert.deepEqual(plan.update[0].matches, ['https://www.flipkart.com/*']);
  assert.equal(plan.remove.includes('asg-network'), false);
  assert.equal(plan.remove.includes('unrelated-script'), false);

  const withNetwork = registration.planRegistration(registered, registration.desiredScripts('https://www.flipkart.com', true, files, 'injected/network.js'));
  assert.deepEqual(withNetwork.remove, []);
  assert.deepEqual(withNetwork.insert.map((script) => script.id), ['asg-network']);

  const turnedOff = registration.planRegistration(
    [...registered, { id: 'asg-network', matches: ['https://www.google.com/*'], js: ['injected/network.js'], world: 'MAIN', runAt: 'document_start' }],
    next
  );
  assert.deepEqual(turnedOff.remove, ['asg-network']);
  assert.equal(registration.configMatches(next[0], next[0]), true);
});

function sequentialIds() {
  let n = 0;
  return { id: () => `id${n += 1}`, now: () => 1_000 + n };
}

function fakeField(values) {
  return {
    type: values.type,
    name: values.name,
    id: values.id || '',
    getAttribute(name) {
      if (name === 'type') return values.type;
      if (name === 'autocomplete') return values.autocomplete || '';
      if (name === 'aria-label') return values.aria || '';
      if (name === 'name') return values.name || '';
      if (name === 'id') return values.id || '';
      return '';
    },
  };
}
