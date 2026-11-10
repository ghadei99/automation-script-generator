import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const schema = require('../lib/schema.js');
require('../lib/selectors.js');
const ai = require('../lib/ai.js');
const runner = require('../lib/runner.js');
const code = require('../codegen.js');

const pageUrl = 'http://127.0.0.1:49854/';

function loginEvidence() {
  return {
    pageUrl,
    items: [
      { tag: 'input', type: 'text', testid: 'username', id: 'username', name: 'username', label: 'Username' },
      { tag: 'input', type: 'password', testid: 'password', id: 'password', name: 'password', label: 'Password' },
      { tag: 'input', type: 'checkbox', testid: 'remember', id: 'remember', name: 'remember', label: 'Remember this browser' },
      { tag: 'button', type: 'submit', testid: 'submit', text: 'Sign in' },
      { tag: 'p', testid: 'error', id: 'error' },
    ],
  };
}

const capturedPlan = {
  title: 'Login',
  summary: 'Two cases',
  source: 'live',
  cases: [
    {
      name: 'Invalid Login Shows Error Message',
      steps: [
        { type: 'navigate', url: pageUrl },
        { type: 'input', value: 'invalidUser' },
        { type: 'input', secret: true, paramName: 'password' },
        { type: 'submit' },
        { type: 'wait' },
        { type: 'assertVisible' },
        { type: 'assertText', expected: '' },
      ],
    },
    {
      name: 'Successful Login',
      steps: [
        { type: 'navigate', url: pageUrl },
        { type: 'input', value: 'validUser' },
        { type: 'input', secret: true, paramName: 'password', value: 'demo123' },
        { type: 'checkbox', checked: false },
        { type: 'submit' },
      ],
    },
  ],
};

function bindCaptured() {
  const validated = schema.validatePlan(capturedPlan);
  return ai.bindPlan(validated, loginEvidence());
}

function step(plan, caseName, type, predicate) {
  const testCase = plan.cases.find((item) => item.name === caseName);
  return testCase.steps.find((item) => item.type === type && (!predicate || predicate(item)));
}

test('a valid elementRef resolves to the verified locator and an invented selector is discarded', () => {
  const plan = ai.bindPlan({
    title: 'Refs',
    summary: '',
    source: 'live',
    cases: [{
      name: 'One',
      steps: [{
        type: 'input',
        elementRef: 'field_username',
        value: 'demo',
        selector: { strategy: 'css', value: 'body > input:nth-of-type(1)' },
      }],
    }],
  }, loginEvidence());
  const input = plan.cases[0].steps[0];
  assert.equal(input.elementRef, 'field_username');
  assert.equal(input.selector.strategy, 'testid');
  assert.equal(input.selector.value, 'username');
  assert.equal(input.unresolved, false);
  assert.equal(JSON.stringify(input).includes('nth-of-type'), false);
});

test('a missing selector binds the one semantic match and leaves duplicates unresolved', () => {
  const plan = bindCaptured();
  const username = step(plan, 'Invalid Login Shows Error Message', 'input', (item) => !item.secret);
  const password = step(plan, 'Invalid Login Shows Error Message', 'input', (item) => item.secret);
  const submit = step(plan, 'Invalid Login Shows Error Message', 'submit');
  assert.equal(username.selector.value, 'username');
  assert.equal(password.selector.value, 'password');
  assert.equal(password.secret, true);
  assert.equal(password.value, undefined);
  assert.equal(submit.selector.value, 'submit');

  const ambiguous = ai.bindPlan({
    title: 'Duplicate',
    summary: '',
    source: 'live',
    cases: [{ name: 'Duplicate', steps: [{ type: 'input', value: 'person@example.com' }] }],
  }, {
    pageUrl,
    items: [
      { tag: 'input', type: 'text', label: 'Email', testid: 'email-a' },
      { tag: 'input', type: 'text', label: 'Email', testid: 'email-b' },
    ],
  });
  const email = ambiguous.cases[0].steps[0];
  assert.equal(email.selector, undefined);
  assert.equal(email.unresolved, true);
  assert.deepEqual(email.review.matches.map((item) => item.ref).sort(), ['field_email_a', 'field_email_b']);
  assert.match(email.warning, /More than one element/);
});

test('an invented elementRef and a structural locator stay unresolved', () => {
  const invented = ai.bindPlan({
    title: 'Invented',
    summary: '',
    source: 'live',
    cases: [{
      name: 'Invented',
      steps: [{ type: 'input', elementRef: 'field_nope', selector: { strategy: 'css', value: '#username' } }],
    }],
  }, loginEvidence());
  assert.equal(invented.cases[0].steps[0].selector, undefined);
  assert.equal(invented.cases[0].steps[0].unresolved, true);
  assert.match(invented.cases[0].steps[0].warning, /not on the open page/);

  const structural = ai.bindPlan({
    title: 'Structural',
    summary: '',
    source: 'live',
    cases: [{ name: 'Structural', steps: [{ type: 'click', elementRef: 'button_submit' }] }],
  }, {
    pageUrl,
    items: [{
      ref: 'button_submit',
      tag: 'button',
      type: 'submit',
      text: 'Sign in',
      locators: [{ strategy: 'css', value: 'main > div:nth-of-type(4)', tier: 'structural', unique: true, rank: 4 }],
    }],
  });
  assert.equal(structural.cases[0].steps[0].selector, undefined);
  assert.equal(structural.cases[0].steps[0].unresolved, true);
});

test('an expected heading wins over a container that merely contains that text', () => {
  const plan = ai.bindPlan({
    title: 'Welcome',
    summary: '',
    source: 'live',
    cases: [{ name: 'Welcome', steps: [{ type: 'assertText', expected: 'Welcome, Demo' }] }],
  }, {
    pageUrl: `${pageUrl}app.html`,
    items: [
      { tag: 'main', testid: 'main', text: 'Welcome, Demo Enable notifications Load profile' },
      { tag: 'h1', testid: 'welcome', text: 'Welcome, Demo' },
    ],
  });
  const assertion = plan.cases[0].steps[0];
  assert.equal(assertion.unresolved, false);
  assert.equal(assertion.selector.value, 'welcome');
  const duplicate = ai.bindPlan({
    title: 'Duplicate heading',
    summary: '',
    source: 'live',
    cases: [{ name: 'Duplicate', steps: [{ type: 'assertText', expected: 'Welcome, Demo' }] }],
  }, {
    pageUrl: `${pageUrl}app.html`,
    items: [
      { tag: 'h1', testid: 'welcome-a', text: 'Welcome, Demo' },
      { tag: 'h1', testid: 'welcome-b', text: 'Welcome, Demo' },
    ],
  });
  assert.equal(duplicate.cases[0].steps[0].selector, undefined);
  assert.equal(duplicate.cases[0].steps[0].unresolved, true);
});

test('a locator that is not on the page after navigation is unresolved', () => {
  const first = ai.bindPlan({
    title: 'Login',
    summary: '',
    source: 'live',
    cases: [{ name: 'Login', steps: [{ type: 'input', elementRef: 'field_username', value: 'demo' }] }],
  }, loginEvidence());
  assert.equal(first.cases[0].steps[0].selector.value, 'username');
  const rebound = ai.bindPlan(first, {
    pageUrl: `${pageUrl}app.html`,
    items: [{ tag: 'h1', testid: 'welcome', text: 'Welcome, Demo' }],
  });
  const input = rebound.cases[0].steps[0];
  assert.equal(input.selector, undefined);
  assert.equal(input.unresolved, true);
  assert.match(input.warning, /not on the open page/);
});

test('the captured provider plan binds both login cases without keeping a secret or an empty assertion', () => {
  const plan = bindCaptured();
  const invalid = plan.cases[0];
  const success = plan.cases[1];
  assert.equal(invalid.steps.find((item) => item.type === 'wait').unresolved, true);
  assert.equal(invalid.steps.find((item) => item.type === 'assertVisible').unresolved, true);
  const assertion = invalid.steps.find((item) => item.type === 'assertText');
  assert.equal(assertion.selector.value, 'error');
  assert.equal(assertion.unresolved, true);
  assert.equal(success.steps.find((item) => item.type === 'checkbox').selector.value, 'remember');
  assert.equal(JSON.stringify(plan).includes('demo123'), false);
  assert.match(ai.approvalBlock(invalid.steps, 'approval'), /before approval/);
  ai.applyStepEdit(assertion, 'Assert text equals "Invalid credentials" on data-testid=error');
  invalid.steps.splice(invalid.steps.findIndex((item) => item.type === 'wait'), 1);
  invalid.steps.splice(invalid.steps.findIndex((item) => item.type === 'assertVisible'), 1);
  assert.equal(ai.approvalBlock(invalid.steps, 'approval'), '');
  const stored = schema.sanitizeSteps(invalid.steps);
  assert.equal(stored.find((item) => item.type === 'assertText').unresolved, undefined);
  assert.equal(schema.sanitizeSteps([{
    type: 'input',
    elementRef: 'field_username',
    value: 'demo',
    selector: { strategy: 'css', value: 'body > input' },
    review: { candidates: [{ strategy: 'testid', value: 'username', ref: 'field_username' }] },
  }])[0].selector, undefined);
});

test('unresolved steps fail before execution and a resolved assertion keeps the actual mismatch', async () => {
  let calls = 0;
  const blocked = await runner.executeSequence([
    { id: 'missing', type: 'input', unresolved: true, warning: 'Choose a username field.' },
    { id: 'later', type: 'click' },
  ], { async execute() { calls += 1; return { actual: 'ok' }; } });
  assert.equal(calls, 0);
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.results[0].actual, 'unresolved');
  assert.equal(blocked.results[1].status, 'skipped');

  const recorded = await runner.executeSequence([
    { id: 'recorded', type: 'click', selector: { strategy: 'testid', value: 'submit' } },
  ], { async execute() { calls += 1; return { actual: 'clicked' }; } });
  assert.equal(calls, 1);
  assert.equal(recorded.status, 'passed');

  const mismatch = await runner.executeSequence([
    { id: 'assert', type: 'assertText', expected: 'Not the real error', selector: { strategy: 'testid', value: 'error' } },
  ], {
    async execute() {
      throw Object.assign(new Error('Text did not match'), {
        expected: 'Not the real error',
        actual: 'Invalid credentials',
      });
    },
  });
  assert.equal(mismatch.results[0].status, 'failed');
  assert.equal(mismatch.results[0].expected, 'Not the real error');
  assert.equal(mismatch.results[0].actual, 'Invalid credentials');
});

test('resolved login steps export Playwright with semantic locators and a password parameter', () => {
  const plan = bindCaptured();
  const success = plan.cases[1].steps.map((item) => (item.type === 'input' && !item.secret ? { ...item, value: 'demo' } : item));
  const playwright = code.renderPlaywright(success);
  assert.match(playwright, /getByTestId\("username"\)/);
  assert.match(playwright, /getByTestId\("password"\)/);
  assert.match(playwright, /getByTestId\("submit"\)/);
  assert.match(playwright, /TEST_PASSWORD/);
  assert.equal(playwright.includes('demo123'), false);
  assert.equal(playwright.includes('nth-of-type'), false);
});

test('the provider summary has element refs and no selectors or typed secrets', () => {
  const dom = new JSDOM(`<!doctype html><body>
    <form id="login">
      <label for="username">Username</label>
      <input id="username" data-testid="username" name="username" value="demo123">
      <label for="password">Password</label>
      <input id="password" data-testid="password" name="password" type="password" value="demo123">
      <button data-testid="submit" type="submit">Sign in</button>
    </form>
  </body>`, { url: pageUrl });
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.CSS = dom.window.CSS;
  try {
    const summary = ai.providerSummary(ai.collectPageEvidence());
    const encoded = JSON.stringify(summary);
    assert.equal(encoded.includes('demo123'), false);
    assert.equal(encoded.includes('locators'), false);
    assert.equal(encoded.includes('data-testid'), false);
    assert.ok(summary.items.some((item) => item.ref === 'field_username' && item.label === 'Username'));
    assert.ok(summary.items.some((item) => item.ref === 'field_password' && item.type === 'password'));
    assert.ok(summary.items.some((item) => item.ref === 'button_submit'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});
