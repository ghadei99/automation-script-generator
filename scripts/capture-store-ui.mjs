import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';
import { createPackage, inspectPackage } from './package-extension.mjs';

const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = path.resolve('store/screenshots');
const checks = [];

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}`);
}

async function openController(browser, extensionId) {
  const bootstrap = await browser.newPage();
  bootstrap.on('dialog', (dialog) => dialog.accept());
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  try {
    await bootstrap.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await bootstrap.goto(popupUrl, { waitUntil: 'domcontentloaded' });
  }
  const created = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Controller did not open')), 8000);
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
    width: 1280,
    height: 800,
  }));
  const page = await (await created).page();
  page.on('dialog', (dialog) => dialog.accept());
  await page.waitForSelector('#nav');
  await bootstrap.close();
  return page;
}

async function shot(page, name) {
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name) });
}

const demo = await startDemo(0);
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  enableExtensions: true,
  args: ['--no-first-run', '--disable-default-apps'],
});

try {
  const extensionId = await browser.installExtension(process.cwd());
  const site = await browser.newPage();
  await site.goto(demo.url, { waitUntil: 'domcontentloaded' });
  const page = await openController(browser, extensionId);
  await page.waitForFunction((url) => (document.getElementById('targetLabel') || {}).textContent.includes(url), {}, demo.url);
  await page.waitForFunction(() => document.querySelector('h2') && document.querySelector('h2').textContent === 'Recorder');
  await shot(page, '01-recorder.png');
  record('Recorder screen is idle before Start', true, 'Screenshot 01-recorder.png');

  await page.evaluate(() => document.querySelector('[data-view="ai"]').click());
  await page.waitForSelector('#aiModePill');
  const mode = await page.$eval('#aiModePill', (node) => node.textContent);
  await shot(page, '03-mock-ai.png');
  record('Development controller labels Mock AI', mode === 'Mock AI', mode);

  await page.evaluate(() => document.querySelector('[data-view="results"]').click());
  await page.evaluate(() => chrome.storage.local.set({
    runs: [{
      id: 'report-shot',
      testName: 'Demo login <script>',
      status: 'failed',
      startedAt: Date.parse('2026-11-26T06:00:00.000Z'),
      finishedAt: Date.parse('2026-11-26T06:00:04.000Z'),
      results: [
        { index: 0, type: 'navigate', status: 'passed', actual: 'http://127.0.0.1/' },
        {
          index: 1,
          type: 'assertText',
          status: 'failed',
          message: 'Text did not match',
          expected: 'Welcome',
          actual: 'Invalid credentials',
          screenshotError: 'Screenshot unavailable. Permission was not granted.',
        },
        { index: 2, type: 'assertUrl', status: 'skipped', message: 'Skipped because a previous step failed' },
      ],
    }],
  }));
  await page.waitForFunction(() => document.body.innerText.includes('Screenshot unavailable'));
  const summary = await page.evaluate(() => document.querySelector('main').innerText);
  await shot(page, '02-results.png');
  record(
    'Results summary shows counts, failure, skip, and missing screenshot',
    summary.includes('1 passed') && summary.includes('1 failed') && summary.includes('1 skipped')
      && summary.includes('Expected: Welcome') && summary.includes('Actual: Invalid credentials')
      && summary.includes('Screenshot unavailable') && summary.includes('failed'),
    'Screenshot 02-results.png',
  );

  const downloads = await page.evaluate(async () => {
    const saved = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      const url = create.call(URL, blob);
      saved.push(blob.text());
      return url;
    };
    URL.revokeObjectURL = () => {};
    document.querySelectorAll('button').forEach((button) => {
      if (button.textContent === 'Download HTML Report' || button.textContent === 'Export result JSON') button.click();
    });
    return Promise.all(saved);
  });
  const html = downloads.find((item) => item.includes('<!DOCTYPE html')) || '';
  const jsonText = downloads.find((item) => item.trim().startsWith('{')) || '';
  const json = jsonText ? JSON.parse(jsonText) : null;
  record(
    'HTML report downloads offline and escapes the test name',
    html.includes('Screenshot unavailable') && html.includes('Invalid credentials')
      && html.includes('&lt;script&gt;') && !html.includes('<script') && !html.includes('<link'),
    html ? 'HTML report captured from the Results button' : 'No HTML download',
  );
  record(
    'JSON report keeps the failure and omits screenshot bytes',
    !!json && json.schemaVersion === 1 && json.status === 'failed'
      && json.steps[1].expected === 'Welcome' && json.steps[1].actual === 'Invalid credentials'
      && json.steps[1].screenshot === 'unavailable' && json.steps[1].screenshotData == null
      && json.steps[2].status === 'skipped',
    json ? `${json.counts.passed} passed, ${json.counts.failed} failed, ${json.counts.skipped} skipped` : 'No JSON download',
  );
  await mkdir(path.resolve('test-results'), { recursive: true });
  await writeFile(path.resolve('test-results/report-sample.html'), html);
  await writeFile(path.resolve('test-results/report-sample.json'), jsonText);

  const packed = await createPackage();
  const inspected = await inspectPackage(packed.zipPath);
  const storeId = await browser.installExtension(inspected.directory);
  const storePage = await openController(browser, storeId);
  await storePage.evaluate(() => document.querySelector('[data-view="ai"]').click());
  await storePage.waitForFunction(() => document.body.innerText.includes('Live AI is not included in this package'));
  const storeText = await storePage.evaluate(() => document.body.innerText);
  await shot(storePage, '04-store-no-live-ai.png');
  record(
    'Packaged extension loads and does not offer Live AI',
    storeText.includes('Mock AI') && storeText.includes('Live AI is not included in this package') && !storeText.includes('Live proxy'),
    `Screenshot 04-store-no-live-ai.png from ${packed.zipPath}`,
  );
} catch (error) {
  record('Store UI capture', false, error.stack || error.message);
} finally {
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  await demo.close();
}

const failed = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} UI checks passed`);
process.exit(failed.length ? 1 : 0);
