import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const password = 'demo123';
const secondSecret = 'second-token';
const report = { chrome: '', scenarios: [] };

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openController(browser, extensionId) {
  const bootstrap = await browser.newPage();
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
  await page.waitForSelector('#nav');
  await bootstrap.close();
  return page;
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

async function waitForFinishedRun(page) {
  const start = Date.now();
  while (Date.now() - start < 25000) {
    const data = await page.evaluate(() => chrome.storage.local.get(['activeRun', 'runs']));
    if (data.activeRun && data.activeRun.status && data.activeRun.status !== 'running') return data;
    await delay(200);
  }
  throw new Error('Timed out waiting for the run to finish');
}

const demo = await startDemo(0);
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  enableExtensions: true,
  args: ['--no-first-run', '--disable-default-apps'],
});

try {
  report.chrome = await browser.version();
  const extensionId = await browser.installExtension(process.cwd());
  const site = await browser.newPage();
  await site.goto(demo.url, { waitUntil: 'domcontentloaded' });
  const ui = await openController(browser, extensionId);
  await site.bringToFront();
  await ui.waitForFunction((url) => document.getElementById('targetLabel').textContent.includes(url), { timeout: 8000 }, demo.url);
  const tabId = await ui.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => (tab.url || '').startsWith(url)).id;
  }, demo.url);
  await ui.evaluate((id) => chrome.runtime.sendMessage({ type: 'session:start', tabId: id, networkCapture: false }), tabId);
  await site.locator('[data-testid="username"]').click({ clickCount: 3 });
  await site.keyboard.type('demo', { delay: 10 });
  await site.locator('[data-testid="password"]').click({ clickCount: 3 });
  await site.keyboard.type(password, { delay: 10 });
  await site.locator('[data-testid="submit"]').click();
  await site.waitForSelector('[data-testid="welcome"]');
  await delay(400);
  await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'session:stop' }));

  await clickButton(ui, 'Run tests');
  await ui.waitForSelector('[data-param="password"]');
  const before = await ui.evaluate(() => chrome.storage.local.get(['runs', 'activeRun']));
  await clickButton(ui, 'Run');
  await delay(300);
  const blocked = await ui.evaluate(() => ({
    error: document.getElementById('errorBar').textContent,
    hidden: document.getElementById('errorBar').hidden,
    runs: 0,
  }));
  const afterBlock = await ui.evaluate(() => chrome.storage.local.get(['runs', 'activeRun']));
  const noRun = (afterBlock.runs || []).length === (before.runs || []).length
    && (afterBlock.activeRun && afterBlock.activeRun.id) === (before.activeRun && before.activeRun.id);
  record(
    'Missing secret does not start replay',
    !blocked.hidden && blocked.error.includes('"password"') && blocked.error.includes('Nothing was run') && noRun,
    blocked.error,
  );

  await ui.evaluate(() => document.querySelector('[data-param="password"]').focus());
  await ui.keyboard.type(password, { delay: 15 });
  await ui.evaluate(() => document.querySelector('[data-param="password"]').blur());
  await delay(350);
  await ui.evaluate(() => chrome.storage.local.set({ settingsProbe: Date.now() }));
  await delay(500);
  const kept = await ui.evaluate((length) => {
    const input = document.querySelector('[data-param="password"]');
    return !!input && input.value.length === length;
  }, password.length);
  record('Secret survives a storage re-render', kept, kept ? `length ${password.length}` : 'the field was cleared');

  await site.bringToFront();
  await delay(400);
  await clickButton(ui, 'Run');
  const success = await waitForFinishedRun(ui);
  const pageText = await site.evaluate(() => document.body.innerText);
  const stored = await ui.evaluate(() => chrome.storage.local.get(null));
  const storedText = JSON.stringify(stored);
  const successRun = success.activeRun;
  record(
    'Successful login reaches the welcome message',
    successRun && successRun.status === 'passed' && pageText.includes('Welcome, Demo') && !storedText.includes(password),
    successRun
      ? `${successRun.results.map((result) => `${result.type}:${result.status}`).join(', ')}; heading shown`
      : 'no run',
  );

  const session = stored.session;
  const extra = session.steps.find((step) => step.secret);
  const withSecond = session.steps.concat([{ ...extra, id: 'api-token', paramName: 'apiToken' }]);
  await ui.evaluate((steps) => chrome.runtime.sendMessage({ type: 'steps:update', steps }), withSecond);
  await clickButton(ui, 'Run tests');
  await ui.waitForSelector('[data-param="apiToken"]');
  const beforeSecond = await ui.evaluate(() => chrome.storage.local.get(['runs', 'activeRun']));
  await clickButton(ui, 'Run');
  await delay(300);
  const secondBlock = await ui.evaluate(() => document.getElementById('errorBar').textContent);
  const afterSecond = await ui.evaluate(() => chrome.storage.local.get(['runs', 'activeRun']));
  const stillSameRun = (afterSecond.runs || []).length === (beforeSecond.runs || []).length
    && afterSecond.activeRun.id === beforeSecond.activeRun.id;
  record(
    'A second missing secret blocks the run',
    secondBlock.includes('"apiToken"') && secondBlock.includes('Nothing was run') && !secondBlock.includes(password) && stillSameRun,
    secondBlock,
  );

  await ui.evaluate(() => document.querySelector('[data-param="apiToken"]').focus());
  await ui.keyboard.type(secondSecret, { delay: 15 });
  await site.bringToFront();
  await delay(300);
  await clickButton(ui, 'Run');
  const both = await waitForFinishedRun(ui);
  const bothText = JSON.stringify(await ui.evaluate(() => chrome.storage.local.get(null)));
  const missing = (both.activeRun.results || []).find((result) => String(result.message || '').includes('Missing runtime value'));
  record(
    'Both secrets are accepted and are not stored',
    !missing && !bothText.includes(password) && !bothText.includes(secondSecret),
    both.activeRun.results.map((result) => `${result.type}:${result.status}`).join(', '),
  );
} finally {
  await browser.close();
  await demo.close();
  const failed = report.scenarios.filter((item) => !item.pass);
  if (failed.length) process.exitCode = 1;
}
