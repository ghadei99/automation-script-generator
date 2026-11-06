import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const require = createRequire(import.meta.url);
const code = require('../codegen.js');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const report = { scenarios: [] };

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  process.stderr.write(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function filesContain(dir, needle) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await filesContain(full, needle)) return true;
    } else if ((await readFile(full)).includes(needle)) return true;
  }
  return false;
}

const demo = await startDemo(0);
const shopUrl = `${demo.url}/shop.html`;
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  enableExtensions: true,
  args: ['--no-first-run', '--disable-default-apps'],
});

try {
  const extensionId = await browser.installExtension(process.cwd());
  const extensionPage = await browser.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const send = (message) => extensionPage.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  const shop = await browser.newPage();
  await shop.goto(shopUrl, { waitUntil: 'domcontentloaded' });
  const tabId = await extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    return tab ? tab.id : null;
  }, shopUrl);
  const started = await send({ type: 'session:start', tabId, networkCapture: false });
  if (!started.ok) throw new Error(started.message || 'recording did not start');
  await shop.locator('[data-testid="product-notebook"]').click();
  await shop.waitForSelector('[data-testid="product-name"]');
  await delay(300);
  await shop.locator('[data-testid="add-cart"]').click();
  await shop.waitForFunction(() => document.body.innerText.includes('Notebook is in the cart'));
  await delay(300);
  await send({ type: 'session:stop' });
  const recorded = await extensionPage.evaluate(() => chrome.storage.local.get(['session']));
  const steps = recorded.session.steps;
  const urls = steps.filter((step) => step.type === 'navigate').map((step) => step.url);
  const addStep = steps.find((step) => step.type === 'click' && step.selector && step.selector.value === 'add-cart');
  record(
    'Recording keeps the shop and the product navigation',
    urls.some((url) => url.includes('/shop.html')) && urls.some((url) => url.includes('/product.html?sku=notebook'))
      && addStep
      && addStep.selector.strategy === 'testid'
      && addStep.selector.fingerprint
      && addStep.selector.fingerprint.tag === 'button'
      && Array.isArray(addStep.selector.candidates)
      && addStep.selector.candidates.length > 1
      && !JSON.stringify(addStep).includes('demo123'),
    urls.join(' | '),
  );

  await extensionPage.evaluate(() => document.querySelector('[data-view="steps"]').click());
  await extensionPage.waitForSelector('.step-title');
  const ui = await extensionPage.evaluate(() => {
    const titles = [...document.querySelectorAll('.step-title')].map((node) => node.textContent);
    const clicked = [...document.querySelectorAll('.step')].find((node) => node.innerText.includes('add-cart'));
    if (clicked) clicked.click();
    return {
      titles,
      numbers: [...document.querySelectorAll('.step-index')].map((node) => node.textContent),
      icons: [...document.querySelectorAll('.step-icon')].map((node) => node.textContent),
      locator: document.querySelector('.locator') ? document.querySelector('.locator').textContent : '',
      backups: document.body.innerText.includes('Backup locators'),
    };
  });
  record(
    'Step list stays concise and the editor shows the locator',
    ui.titles.length === steps.length
      && ui.titles.every((title) => !title.includes('nth-of-type') && title.length < 120)
      && ui.numbers[0] === '01'
      && ui.icons.length === steps.length
      && /Strategy:/.test(ui.locator)
      && /CSS:/.test(ui.locator)
      && /Verification:/.test(ui.locator)
      && /Reliability:/.test(ui.locator)
      && ui.backups,
    `${ui.titles.join(' / ')} :: ${ui.locator.split('\n')[0]}`,
  );

  const ai = await extensionPage.evaluate(() => {
    document.querySelector('[data-view="ai"]').click();
    return {
      mode: document.getElementById('aiModePill').textContent,
      promptClass: document.getElementById('aiPrompt').className,
    };
  });
  record(
    'AI assistant shows Mock AI in a short prompt',
    ai.mode === 'Mock AI' && ai.promptClass.includes('prompt'),
    `${ai.mode} ${ai.promptClass}`,
  );

  const replay = await send({ type: 'run:start', draft: true, tabId, params: {} });
  if (!replay.ok) throw new Error(replay.message || 'replay did not start');
  const start = Date.now();
  let run = null;
  while (Date.now() - start < 20000) {
    const data = await extensionPage.evaluate(() => chrome.storage.local.get(['activeRun']));
    if (data.activeRun && data.activeRun.status && data.activeRun.status !== 'running') {
      run = data.activeRun;
      break;
    }
    await delay(200);
  }
  const pageText = await shop.evaluate(() => document.body.innerText);
  record(
    'Replay reaches the cart message',
    run && run.status === 'passed' && pageText.includes('Notebook is in the cart'),
    run ? `${run.status}; ${pageText.split('\n').slice(0, 4).join(' | ')}` : 'no run',
  );

  const withAssertion = steps.concat([{
    id: 'assert-cart',
    type: 'assertText',
    selector: { strategy: 'testid', attr: 'data-testid', value: 'cart' },
    expected: 'Notebook is in the cart',
    match: 'exact',
  }]);
  await send({ type: 'steps:update', steps: withAssertion });
  const rendered = code.renderPlaywright(withAssertion);
  const root = path.resolve('test-results/shop-playwright');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const parts = rendered.split(/\/\/ ==== (.+?) ====\n/);
  for (let index = 1; index < parts.length; index += 2) {
    await writeFile(path.join(root, parts[index]), parts[index + 1]);
  }
  await writeFile(path.join(root, 'playwright.config.ts'), `
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: 'line',
  outputDir: 'output',
  use: {
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { executablePath: process.env.CHROME_PATH },
  },
});
`);
  const executed = await new Promise((resolve) => {
    const child = spawn(path.resolve('node_modules/.bin/playwright'), ['test', 'recorded.spec.ts', '--config', 'playwright.config.ts'], {
      cwd: root,
      env: { ...process.env, CHROME_PATH: chromePath, TEST_PASSWORD: 'demo123' },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
  const leaked = executed.output.includes('demo123') || await filesContain(root, 'demo123');
  record(
    'Exported Playwright shop test executes without secrets',
    executed.code === 0
      && rendered.includes('Notebook is in the cart')
      && rendered.includes(shopUrl)
      && rendered.includes('/product.html?sku=notebook')
      && !rendered.includes('demo123')
      && !leaked,
    executed.code === 0 ? 'official runner passed' : executed.output.slice(-800),
  );
} finally {
  await mkdir(path.resolve('test-results'), { recursive: true });
  await writeFile(path.resolve('test-results/shop.json'), JSON.stringify(report, null, 2));
  await browser.close().catch(() => {});
  await demo.close();
  const failed = report.scenarios.filter((item) => !item.pass);
  console.log(`${report.scenarios.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length || report.scenarios.length < 5) process.exitCode = 1;
}
