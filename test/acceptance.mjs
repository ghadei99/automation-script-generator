import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const extensionPath = process.cwd();
const report = {
  chrome: '',
  extensionId: '',
  demoUrl: '',
  scenarios: [],
  extensionErrors: [],
};

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function typeInto(page, selector, text) {
  await page.locator(selector).click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 20 });
  await delay(300);
}

const demo = await startDemo(0);
report.demoUrl = demo.url;
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  enableExtensions: true,
  args: ['--no-first-run', '--disable-default-apps'],
});

try {
  const version = await browser.version();
  report.chrome = version;
  const extensionId = await browser.installExtension(extensionPath);
  report.extensionId = extensionId;
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'service_worker') return;
    const worker = await target.worker();
    worker?.on('console', (message) => {
      if (message.type() === 'error') report.extensionErrors.push(message.text());
    });
  });

  const extensionPage = await browser.newPage();
  extensionPage.on('pageerror', (error) => report.extensionErrors.push(error.message));
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await extensionPage.evaluate(() => {
    globalThis.__keepAlive = chrome.runtime.connect({ name: 'acceptance' });
  });

  const send = (message) => extensionPage.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  const storage = () => extensionPage.evaluate(() => chrome.storage.local.get(null));
  const tabIdByPrefix = (prefix) => extensionPage.evaluate(async (start) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith(start));
    return tab ? tab.id : null;
  }, prefix);
  const waitForRun = async () => {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const data = await storage();
      if (data.activeRun && data.activeRun.status && data.activeRun.status !== 'running') return data.activeRun;
      await delay(250);
    }
    throw new Error('Timed out waiting for the run to finish');
  };

  const uiText = await extensionPage.evaluate(() => document.body.innerText);
  record('Extension window opens', uiText.includes('Browser Test Recorder') && uiText.includes('IDLE'), uiText.split('\n').slice(0, 8).join(' | '));

  const app = await browser.newPage();
  app.on('pageerror', (error) => report.extensionErrors.push(`demo: ${error.message}`));
  await app.goto(demo.url, { waitUntil: 'domcontentloaded' });
  await app.locator('[data-testid="password"]').fill('should-not-record');
  await delay(400);
  const before = await storage();
  const beforeJson = JSON.stringify(before);
  record(
    'No recording before Start',
    !before.session && !beforeJson.includes('should-not-record'),
    before.session ? 'A session existed before Start' : 'No session and the typed password was not stored',
  );

  const demoTabId = await tabIdByPrefix(demo.url);
  const started = await send({ type: 'session:start', tabId: demoTabId, networkCapture: true });
  record('Start recording on the selected tab', !!started.ok, started.ok ? `origin ${started.session.origin}` : started.message);

  await typeInto(app, '[data-testid="username"]', 'demo');
  await typeInto(app, '[data-testid="password"]', 'demo123');
  await app.locator('[data-testid="remember"]').click();
  await app.locator('[data-testid="submit"]').click();
  await app.waitForSelector('[data-testid="welcome"]', { timeout: 10000 });
  await delay(800);

  const during = await storage();
  const duringCount = during.session.steps.length;
  const other = await browser.newPage();
  await other.goto(`${demo.url}/`, { waitUntil: 'domcontentloaded' });
  await other.locator('[data-testid="submit"]').click();
  await delay(500);
  const afterOther = await storage();
  record(
    'Recording stays on the selected tab',
    afterOther.session.steps.length === duringCount,
    `steps before other tab: ${duringCount}; after: ${afterOther.session.steps.length}`,
  );

  await send({ type: 'session:stop' });
  const stopped = await storage();
  const session = stopped.session;
  const persisted = JSON.stringify({ steps: session.steps, apiCalls: session.apiCalls });
  report.recordedStepTypes = session.steps.map((step) => step.type);
  report.apiCallCount = session.apiCalls.length;
  record(
    'Passwords are not persisted',
    !persisted.includes('demo123') && !persisted.includes('should-not-record') && session.steps.some((step) => step.secret)
      && session.steps.some((step) => step.type === 'input' && step.value === 'demo'),
    session.steps.map((step) => `${step.type}${step.secret ? `:{{${step.paramName}}}` : step.value ? `:${step.value}` : ''}`).join(', '),
  );
  const loginCall = session.apiCalls.find((call) => String(call.url).includes('/api/login'));
  record(
    'Network capture is redacted',
    !!loginCall && !JSON.stringify(loginCall).includes('demo123') && String(loginCall.requestBody).includes('REDACTED'),
    loginCall ? loginCall.requestBody : 'no login call captured',
  );

  const failingSteps = session.steps.concat([{
    id: 'bad-welcome',
    type: 'assertText',
    selector: { strategy: 'testid', attr: 'data-testid', value: 'welcome' },
    expected: 'Welcome, Admin',
    match: 'exact',
  }]);
  await send({ type: 'steps:update', steps: failingSteps });
  const failedStart = await send({
    type: 'run:start',
    draft: true,
    tabId: demoTabId,
    params: { password: 'demo123' },
  });
  record('Run starts', !!failedStart.ok, failedStart.ok ? failedStart.run.status : failedStart.message);
  const failedRun = failedStart.ok ? await waitForRun() : null;
  const failedStep = failedRun && failedRun.results.find((result) => result.status === 'failed');
  const skippedAfterFailure = failedRun && failedRun.results.some((result, index) => failedStep && index > failedStep.index && result.status !== 'skipped');
  record(
    'Incorrect assertion fails',
    !!failedRun && failedRun.status === 'failed' && failedStep && failedStep.expected === 'Welcome, Admin' && failedStep.actual === 'Welcome, Demo',
    failedStep ? `${failedStep.message}; expected ${failedStep.expected}; actual ${failedStep.actual}` : (failedRun && failedRun.error) || 'no failure step',
  );
  record(
    'Failed step keeps evidence and does not become a pass',
    !!failedStep && failedStep.status === 'failed' && !skippedAfterFailure && (Boolean(failedStep.screenshot) || Boolean(failedStep.screenshotError)),
    failedStep ? (failedStep.screenshot ? `screenshot ${failedStep.screenshot.length} chars` : failedStep.screenshotError) : 'no failure step',
  );
  record(
    'Navigation replay reaches the app before the assertion',
    !!failedRun && failedRun.results.some((result) => result.status === 'passed' && result.type === 'navigate'),
    failedRun ? failedRun.results.map((result) => `${result.type}:${result.status}`).join(', ') : 'run did not finish',
  );

  const passingSteps = session.steps
    .filter((step, index) => !(step.type === 'navigate' && index === session.steps.length - 1))
    .concat([{
      id: 'good-welcome',
      type: 'assertText',
      selector: { strategy: 'testid', attr: 'data-testid', value: 'welcome' },
      expected: 'Welcome, Demo',
      match: 'exact',
    }]);
  await send({ type: 'steps:update', steps: passingSteps });
  const passStart = await send({ type: 'run:start', draft: true, tabId: demoTabId, params: { password: 'demo123' } });
  const passedRun = passStart.ok ? await waitForRun() : null;
  const welcomeText = await app.evaluate(() => {
    const node = document.querySelector('[data-testid="welcome"]');
    return node ? node.textContent : document.body.innerText.slice(0, 200);
  }).catch((error) => error.message);
  record(
    'Recorded workflow replays successfully',
    !!passedRun && passedRun.status === 'passed' && passedRun.results.every((result) => result.status === 'passed') && welcomeText.includes('Welcome, Demo'),
    `${passedRun ? passedRun.results.map((result) => `${result.type}:${result.status}`).join(', ') : passStart.message}; page: ${welcomeText}`,
  );

  const generated = await extensionPage.evaluate((steps) => ({
    playwright: CodeGen.renderPlaywright(steps),
    selenium: CodeGen.renderSelenium(steps),
    cypress: CodeGen.renderCypress(steps),
  }), passingSteps);
  record(
    'Generators still emit page objects without the password',
    !!generated.playwright
      && generated.playwright.includes('RecordedPage')
      && generated.selenium.includes('RecordedPage')
      && generated.cypress.includes('RecordedPage')
      && generated.playwright.includes('TEST_PASSWORD')
      && !generated.playwright.includes('demo123')
      && !generated.selenium.includes('demo123')
      && !generated.cypress.includes('demo123'),
    generated.playwright ? 'Playwright, Selenium, and Cypress generated' : 'no steps to generate',
  );

  const planResponse = await extensionPage.evaluate(async (origin) => chrome.runtime.sendMessage({
    type: 'ai:plan',
    mode: 'mock',
    origin,
    prompt: 'Test login with valid and invalid credentials, check error messages, and verify navigation.',
  }), demo.url);
  const plan = planResponse.plan;
  if (plan && plan.cases && plan.cases[0]) {
    const textStep = plan.cases[0].steps.find((step) => step.type === 'assertText');
    if (textStep) textStep.expected = 'Welcome, Admin';
  }
  const aiSaved = planResponse.ok ? await extensionPage.evaluate(async (draft) => chrome.runtime.sendMessage({
    type: 'tests:create',
    test: { name: draft.name, source: 'ai', origin: draft.origin, steps: draft.steps },
  }), { name: plan.cases[0].name, origin: demo.url, steps: plan.cases[0].steps }) : planResponse;
  const runsAfterAi = await extensionPage.evaluate(() => chrome.storage.local.get('runs'));
  record(
    'Mock AI plan is proposed, editable, and not executed',
    !!planResponse.ok && plan.source === 'mock' && plan.proposed === true && aiSaved.ok && aiSaved.test.source === 'ai'
      && !(runsAfterAi.runs || []).some((run) => run.testId === aiSaved.test.id),
    planResponse.ok ? `${plan.cases.length} cases, source ${plan.source}` : planResponse.message,
  );

  const versionPage = await browser.newPage();
  let unsupportedDetail = '';
  try {
    await versionPage.goto('chrome://version');
    const versionTabId = await extensionPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => (item.url || '').startsWith('chrome://version'));
      return tab && tab.id;
    });
    const blocked = await extensionPage.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: 'session:start', tabId }), versionTabId);
    unsupportedDetail = blocked.message || JSON.stringify(blocked);
    record('Unsupported pages are rejected', blocked.ok === false && /cannot be scripted|http or https/i.test(blocked.message || ''), unsupportedDetail);
  } catch (error) {
    record('Unsupported pages are rejected', false, error.message);
  }

  record(
    'No uncaught extension errors',
    report.extensionErrors.length === 0,
    report.extensionErrors.join(' | ') || 'none',
  );

  try {
    const saved = await send({ type: 'tests:save', name: 'Login demo' });
    await extensionPage.evaluate(() => {
      if (globalThis.__keepAlive) globalThis.__keepAlive.disconnect();
    });
    const cdp = await withTimeout(browser.target().createCDPSession(), 5000, 'CDP session');
    await withTimeout(cdp.send('Target.setDiscoverTargets', { discover: true }), 5000, 'discover targets');
    const targets = await withTimeout(cdp.send('Target.getTargets'), 5000, 'list targets');
    const worker = targets.targetInfos.find((target) => target.type === 'service_worker' && target.url.includes(extensionId));
    if (!worker) throw new Error('Service worker target was not found');
    await withTimeout(cdp.send('Target.closeTarget', { targetId: worker.targetId }), 5000, 'close service worker');
    await delay(1000);
    const fresh = await browser.newPage();
    await withTimeout(fresh.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' }), 8000, 'reopen extension');
    const afterRestart = await withTimeout(fresh.evaluate(() => chrome.runtime.sendMessage({ type: 'app:get' })), 8000, 'read tests after restart');
    const reloadedTest = (afterRestart.tests || []).find((test) => test.name === 'Login demo');
    record(
      'Saved test survives service worker restart',
      !!saved.ok && !!reloadedTest && reloadedTest.steps.length === passingSteps.length,
      reloadedTest
        ? `${reloadedTest.steps.length} steps after the service worker was terminated and started again`
        : 'test missing after service worker restart',
    );
  } catch (error) {
    record('Saved test survives service worker restart', false, error.message);
  }

  report.failedRun = failedRun ? {
    status: failedRun.status,
    error: failedRun.error,
    results: failedRun.results.map((result) => ({
      type: result.type,
      status: result.status,
      message: result.message,
      expected: result.expected,
      actual: result.actual,
      screenshotCaptured: Boolean(result.screenshot),
      screenshotError: result.screenshotError || null,
    })),
  } : null;
  report.passedRun = passedRun ? {
    status: passedRun.status,
    results: passedRun.results.map((result) => ({ type: result.type, status: result.status })),
  } : null;
} catch (error) {
  record('Acceptance harness', false, error.stack || error.message);
} finally {
  await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  await writeFile(path.join(process.cwd(), 'test-results', 'acceptance.json'), JSON.stringify(report, null, 2));
  await Promise.race([browser.close(), delay(5000)]);
  await demo.close();
}

const failed = report.scenarios.filter((scenario) => !scenario.pass);
console.log(`\n${report.scenarios.length - failed.length}/${report.scenarios.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
