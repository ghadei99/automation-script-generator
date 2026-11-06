import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const report = { chrome: '', extensionId: '', scenarios: [] };

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  process.stderr.write(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function realJpeg(value) {
  return typeof value === 'string' && value.startsWith('data:image/jpeg;base64,/9j/') && value.length > 100;
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
  report.extensionId = extensionId;
  const extensionPage = await browser.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const send = (message) => extensionPage.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  const storage = () => extensionPage.evaluate(() => chrome.storage.local.get(null));
  await send({
    type: 'settings:set',
    settings: { stepTimeoutMs: 1000, navigationTimeoutMs: 8000, aiMode: 'mock', aiProxyUrl: '', aiProxyToken: '' },
  });

  async function failOn(tabId, name) {
    const created = await send({
      type: 'tests:create',
      test: {
        name,
        origin: demo.url,
        steps: [{
          type: 'assertText',
          selector: { strategy: 'testid', value: 'error' },
          expected: 'This message is not on the page',
          match: 'exact',
        }],
      },
    });
    const started = await send({ type: 'run:start', testId: created.test.id, tabId, params: {} });
    if (!started.ok) throw new Error(started.message || 'run did not start');
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const data = await storage();
      const run = (data.runs || []).find((item) => item.testId === created.test.id);
      if (run && run.status && run.status !== 'running') return run;
      await delay(200);
    }
    throw new Error(`Timed out waiting for ${name}`);
  }

  const app = await browser.newPage();
  await app.goto(demo.url, { waitUntil: 'domcontentloaded' });
  const demoTabId = await extensionPage.evaluate(async (start) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith(start));
    return tab ? { id: tab.id, url: tab.url } : null;
  }, demo.url);
  const first = await failOn(demoTabId.id, 'Wrong error text');
  const failed = first.results.find((step) => step.status === 'failed');
  const stored = JSON.stringify(first);
  record(
    'Failed assertion keeps the error and does not invent an image',
    failed
      && failed.status === 'failed'
      && !realJpeg(failed.screenshot)
      && !stored.includes('data:image/')
      && String(failed.screenshotError || '').startsWith('Screenshot unavailable')
      && /activeTab/.test(failed.screenshotError)
      && /Click the extension icon/.test(failed.screenshotError),
    failed ? (failed.screenshotError || 'no screenshot error') : 'no failed step',
  );

  let shown = { text: '', images: [] };
  for (let attempt = 0; attempt < 25; attempt += 1) {
    shown = await extensionPage.evaluate(() => {
      document.querySelector('[data-view="results"]').click();
      return {
        text: document.body.innerText,
        images: [...document.querySelectorAll('img')].map((node) => ({ alt: node.alt, src: node.getAttribute('src') || '' })),
      };
    });
    if (shown.text.includes('Screenshot unavailable') && shown.text.includes('activeTab')) break;
    await delay(200);
  }
  const fakeImage = shown.images.some((image) => image.alt === 'Failure screenshot' && !realJpeg(image.src));
  record(
    'Results show Screenshot unavailable',
    shown.text.includes('Screenshot unavailable') && shown.text.includes('activeTab') && !fakeImage,
    fakeImage ? 'A non-JPEG image was shown' : shown.text.replace(/\s+/g, ' ').slice(0, 400),
  );

  await extensionPage.evaluate(async (tabId, url) => {
    const storedGrants = await chrome.storage.session.get('captureGrants');
    const grants = storedGrants.captureGrants || {};
    grants[String(tabId)] = { url, at: Date.now() };
    await chrome.storage.session.set({ captureGrants: grants });
  }, demoTabId.id, demoTabId.url);
  await app.goto(`${demo.url}/app.html`, { waitUntil: 'domcontentloaded' });
  let grant = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    grant = await extensionPage.evaluate(async (tabId) => {
      const storedGrants = await chrome.storage.session.get('captureGrants');
      return (storedGrants.captureGrants || {})[String(tabId)] || null;
    }, demoTabId.id);
    if (grant && grant.cleared === 'navigation') break;
    await delay(100);
  }
  const navigated = await failOn(demoTabId.id, 'After navigation');
  const navigatedStep = navigated.results.find((step) => step.status === 'failed');
  record(
    'Navigation clears the capture grant',
    grant && grant.cleared === 'navigation'
      && navigatedStep
      && String(navigatedStep.screenshotError || '').includes('navigated')
      && !realJpeg(navigatedStep.screenshot),
    `grant ${JSON.stringify(grant)}; ${navigatedStep ? navigatedStep.screenshotError : 'no failed step'}`,
  );

  const restricted = await browser.newPage();
  await restricted.goto('chrome://version', { waitUntil: 'domcontentloaded' });
  const restrictedId = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith('chrome://version'));
    return tab ? tab.id : null;
  });
  const restrictedRun = await failOn(restrictedId, 'Restricted page');
  const restrictedStep = restrictedRun.results.find((step) => step.status === 'failed');
  record(
    'Browser page capture is refused',
    restrictedStep
      && /chrome:/.test(restrictedStep.screenshotError || '')
      && String(restrictedStep.screenshotError).startsWith('Screenshot unavailable')
      && !realJpeg(restrictedStep.screenshot),
    restrictedStep ? restrictedStep.screenshotError : 'no failed step',
  );

  const external = await browser.newPage();
  await external.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const externalId = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith('https://example.com'));
    return tab ? tab.id : null;
  });
  const externalRun = await failOn(externalId, 'Missing origin');
  const externalStep = externalRun.results.find((step) => step.status === 'failed');
  record(
    'Missing origin permission is reported',
    externalStep
      && /missing or was revoked/.test(externalStep.screenshotError || '')
      && String(externalStep.screenshotError).startsWith('Screenshot unavailable')
      && !realJpeg(externalStep.screenshot),
    externalStep ? externalStep.screenshotError : 'no failed step',
  );
} finally {
  await mkdir(path.resolve('test-results'), { recursive: true });
  await writeFile(path.resolve('test-results/screenshot.json'), JSON.stringify(report, null, 2));
  await browser.close().catch(() => {});
  await demo.close();
  const failed = report.scenarios.filter((item) => !item.pass);
  console.log(`${report.scenarios.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length || !report.scenarios.length) process.exitCode = 1;
}
