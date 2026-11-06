import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prompt = 'Test the login form, verify invalid credentials show an error, then test a successful login.';
const report = { chrome: '', extensionId: '', scenarios: [] };

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button "${text}" was not available`);
}

async function editInCard(page, cardText, current, next) {
  const edited = await page.evaluate((cardText, current, next) => {
    const card = [...document.querySelectorAll('.card')].find((node) => node.innerText.includes(cardText));
    const input = card && [...card.querySelectorAll('input')].find((node) => node.value.includes(current));
    if (!input) return false;
    input.value = next;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, cardText, current, next);
  if (!edited) throw new Error(`Could not edit "${current}" in "${cardText}"`);
}

async function waitForSteps(page, text) {
  await page.waitForFunction((expected) => {
    const heading = document.querySelector('h2');
    return !!heading && heading.textContent === 'Test steps' && document.body.innerText.includes(expected);
  }, { timeout: 8000 }, text);
}

async function approveCard(page, cardText) {
  const approved = await page.evaluate((cardText) => {
    const card = [...document.querySelectorAll('.card')].find((node) => node.innerText.includes(cardText));
    const button = card && [...card.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Approve and save');
    if (!button) return false;
    button.click();
    return true;
  }, cardText);
  if (!approved) throw new Error(`Approve was not available for "${cardText}"`);
}

async function openController(browser, extensionId) {
  const bootstrap = await browser.newPage();
  bootstrap.on('dialog', (dialog) => dialog.accept());
  await bootstrap.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const created = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Controller popup did not open')), 8000);
    const onTarget = async (target) => {
      if (target.type() !== 'page' || !target.url().includes(extensionId)) return;
      clearTimeout(timer);
      browser.off('targetcreated', onTarget);
      resolve(target);
    };
    browser.on('targetcreated', onTarget);
  });
  await bootstrap.evaluate(() => chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 1120,
    height: 800,
  }));
  const page = await (await created).page();
  page.on('dialog', (dialog) => dialog.accept());
  await page.waitForSelector('#nav');
  await bootstrap.close();
  return page;
}

async function runWithSecret(page, param, secret) {
  await clickButton(page, 'Run tests');
  try {
    await page.waitForSelector(`[data-param="${param}"]`, { timeout: 8000 });
  } catch (error) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 500));
    throw new Error(`Secret field ${param} was not shown. ${text}`);
  }
  const started = await page.evaluate((name, value) => {
    const input = document.querySelector(`[data-param="${name}"]`);
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Run');
    if (!input || !button) return false;
    input.value = value;
    button.click();
    return true;
  }, param, secret);
  if (!started) throw new Error(`Could not start the run for ${param}`);
}

async function waitForRun(page, status) {
  await page.waitForFunction((expected) => document.getElementById('statusPill').textContent === expected, { timeout: 25000 }, status);
  return page.evaluate(() => chrome.storage.local.get(['runs', 'tests', 'settings']));
}

const demo = await startDemo(0);
const appUrl = new URL('/app.html', demo.url).href;
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  enableExtensions: true,
  args: ['--no-first-run', '--disable-default-apps'],
});

try {
  report.chrome = await browser.version();
  const extensionId = await browser.installExtension(process.cwd());
  report.extensionId = extensionId;
  const site = await browser.newPage();
  await site.goto(demo.url, { waitUntil: 'domcontentloaded' });
  const ui = await openController(browser, extensionId);
  await site.bringToFront();
  await ui.waitForFunction((url) => document.getElementById('targetLabel').textContent.includes(url), { timeout: 8000 }, demo.url);

  await clickButton(ui, 'AI assistant');
  await ui.locator('#aiPrompt').fill(prompt);
  await clickButton(ui, 'Generate proposal');
  await ui.waitForFunction(() => document.body.innerText.includes('Inspected'), { timeout: 8000 });
  const proposal = await ui.evaluate(() => `${document.body.innerText}\n${[...document.querySelectorAll('input')].map((node) => node.value).join('\n')}`);
  const grounded = proposal.includes('Invalid login')
    && proposal.includes('Valid login')
    && proposal.includes('data-testid=username')
    && proposal.includes('data-testid=password')
    && proposal.includes('data-testid=submit')
    && proposal.includes('data-testid=error')
    && proposal.includes('Assert URL equals ""')
    && !proposal.includes('/app')
    && !proposal.includes('demo123');
  record(
    'Mock plan is editable and grounded in the open page',
    grounded,
    grounded ? 'Invalid case, then success case, with login-page selectors only' : proposal.slice(0, 800),
  );

  await editInCard(ui, 'Invalid login', 'Assert text equals ""', 'Assert text equals "Invalid credentials" on data-testid=error');
  await approveCard(ui, 'Invalid login');
  await waitForSteps(ui, 'Invalid credentials');
  await runWithSecret(ui, 'wrongPassword', 'not-the-password');
  const passedStore = await waitForRun(ui, 'passed');
  const passedRun = passedStore.runs[0];
  record(
    'Correct invalid-login assertions pass',
    passedRun && passedRun.status === 'passed' && passedRun.results.every((result) => result.status === 'passed'),
    passedRun ? passedRun.results.map((result) => `${result.type}:${result.status}`).join(', ') : 'no run',
  );

  await clickButton(ui, 'AI assistant');
  await editInCard(ui, 'Invalid login', 'Invalid credentials', 'Assert text equals "Not the real error" on data-testid=error');
  await approveCard(ui, 'Invalid login');
  await waitForSteps(ui, 'Not the real error');
  await runWithSecret(ui, 'wrongPassword', 'not-the-password');
  const failedStore = await waitForRun(ui, 'failed');
  const failedRun = failedStore.runs[0];
  const failedStep = failedRun && failedRun.results.find((result) => result.status === 'failed');
  const laterSkipped = failedRun && failedRun.results.slice(failedStep.index + 1).every((result) => result.status === 'skipped');
  const evidence = failedStep && (failedStep.screenshot || failedStep.screenshotError);
  record(
    'Incorrect assertion fails with real evidence',
    !!failedStep
      && failedStep.expected === 'Not the real error'
      && failedStep.actual === 'Invalid credentials'
      && laterSkipped
      && !!evidence
      && !(failedStep.screenshot && !String(failedStep.screenshot).startsWith('data:image/')),
    failedStep
      ? `expected ${failedStep.expected}; actual ${failedStep.actual}; evidence ${failedStep.screenshot ? 'screenshot' : failedStep.screenshotError}`
      : 'no failed step',
  );
  await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  await ui.screenshot({ path: path.join(process.cwd(), 'test-results', 'ai-login-failed.png') });

  await clickButton(ui, 'AI assistant');
  await editInCard(ui, 'Valid login', 'Enter "demo-user"', 'Enter "demo" into data-testid=username');
  await editInCard(ui, 'Valid login', 'Assert URL equals ""', `Assert URL equals "${appUrl}"`);
  await approveCard(ui, 'Valid login');
  await waitForSteps(ui, appUrl);
  await runWithSecret(ui, 'password', 'demo123');
  const successStore = await waitForRun(ui, 'passed');
  const successRun = successStore.runs[0];
  const pageText = await site.evaluate(() => document.body.innerText);
  record(
    'Approved successful login passes in the browser',
    successRun && successRun.status === 'passed' && pageText.includes('Welcome, Demo'),
    successRun
      ? `${successRun.results.map((result) => `${result.type}:${result.status}`).join(', ')}; page: ${pageText.split('\n')[0]}`
      : 'no run',
  );

  await clickButton(ui, 'Code export');
  await ui.waitForSelector('textarea');
  const playwright = await ui.evaluate(() => document.querySelector('textarea').value);
  const stored = await ui.evaluate(() => chrome.storage.local.get(null));
  const storedText = JSON.stringify(stored);
  record(
    'Playwright export matches the approved test and stores no secrets',
    playwright.includes("import { test } from '@playwright/test'")
      && playwright.includes('getByTestId("username")')
      && playwright.includes('TEST_PASSWORD')
      && playwright.includes(appUrl)
      && !playwright.includes('demo123')
      && !storedText.includes('demo123')
      && !storedText.includes('not-the-password'),
    'Playwright spec generated from the approved success steps',
  );
  report.runs = {
    passed: passedRun && passedRun.results.map((result) => ({ type: result.type, status: result.status })),
    failed: failedStep && {
      expected: failedStep.expected,
      actual: failedStep.actual,
      message: failedStep.message,
      screenshot: Boolean(failedStep.screenshot),
      screenshotError: failedStep.screenshotError || null,
    },
    success: successRun && successRun.results.map((result) => ({ type: result.type, status: result.status, actual: result.actual })),
  };
} catch (error) {
  record('AI login harness', false, error.stack || error.message);
} finally {
  await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  await writeFile(path.join(process.cwd(), 'test-results', 'ai-login.json'), JSON.stringify(report, null, 2));
  await Promise.race([browser.close(), delay(5000)]);
  await demo.close();
}

const failed = report.scenarios.filter((scenario) => !scenario.pass);
console.log(`\n${report.scenarios.length - failed.length}/${report.scenarios.length} checks passed`);
process.exit(failed.length ? 1 : 0);
