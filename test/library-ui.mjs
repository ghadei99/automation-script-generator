import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const report = { scenarios: [] };
let acceptDelete = false;

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}`);
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
  const page = await browser.newPage();
  page.on('dialog', (dialog) => {
    const message = dialog.message();
    if (message.startsWith('Delete "')) {
      if (acceptDelete) dialog.accept();
      else dialog.dismiss();
      return;
    }
    dialog.accept();
  });
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav');
  const send = (message) => page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  const stored = () => page.evaluate(() => chrome.storage.local.get(['tests', 'runs', 'session']));

  const home = await page.evaluate(() => document.body.innerText);
  record(
    'Empty dashboard does not invent results',
    home.includes('Saved tests') && home.includes('No executions yet.') && /idle/i.test(home),
    'Home showed zero history',
  );
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  const empty = await page.evaluate(() => document.body.innerText);
  record('Empty library explains how to add a test', empty.includes('No saved tests yet.'), empty.includes('No saved tests yet.') ? 'Empty state shown' : empty.slice(0, 180));

  const login = await send({
    type: 'tests:create',
    test: { name: 'Member login', source: 'recorded', origin: demo.url, steps: [{ type: 'navigate', url: demo.url }] },
  });
  const proposal = await send({
    type: 'tests:create',
    test: { name: 'AI login', source: 'ai', origin: demo.url, steps: [{ type: 'navigate', url: demo.url }, { type: 'navigate', url: `${demo.url}/app.html` }] },
  });
  await page.evaluate((run) => chrome.storage.local.set({ runs: [run] }), {
    id: 'kept-run',
    testId: login.test.id,
    testName: 'Member login',
    status: 'failed',
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    results: [{ index: 0, type: 'navigate', status: 'failed', message: 'Text did not match' }],
  });
  await page.evaluate(() => document.querySelector('[data-view="home"]').click());
  await page.waitForFunction(() => document.body.innerText.includes('Member login'));
  const dashboard = await page.evaluate(() => document.body.innerText);
  record(
    'Dashboard counts the stored tests and the failed run',
    dashboard.includes('Member login') && /failed/i.test(dashboard) && !dashboard.includes('No executions yet.'),
    'Latest stored run is visible',
  );

  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  await page.waitForSelector('#librarySearch');
  await page.focus('#librarySearch');
  await page.keyboard.type('member');
  await page.keyboard.press('Tab');
  const filtered = await page.evaluate(() => ({
    text: document.getElementById('libraryList').innerText,
    focus: document.activeElement && document.activeElement.id,
  }));
  record(
    'Search and keyboard focus keep the matching test',
    filtered.text.includes('Member login') && !filtered.text.includes('AI login') && filtered.focus === 'libraryFilter',
    `focus ${filtered.focus}`,
  );
  await page.evaluate(() => {
    const input = document.getElementById('librarySearch');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.select('#libraryFilter', 'ai');
  const aiOnly = await page.$eval('#libraryList', (node) => node.innerText);
  record('AI filter hides recorded tests', aiOnly.includes('AI login') && !aiOnly.includes('Member login'), aiOnly);
  await page.select('#libraryFilter', 'all');

  const renameInput = await page.$(`[data-rename="${login.test.id}"]`);
  await renameInput.click({ clickCount: 3 });
  await page.keyboard.type('Member sign-in');
  await page.evaluate((id) => {
    const card = document.querySelector(`[data-rename="${id}"]`).closest('article');
    [...card.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Rename').click();
  }, login.test.id);
  await page.waitForFunction(() => document.body.innerText.includes('Member sign-in'));
  const renamed = await stored();
  record(
    'Rename keeps the test id',
    renamed.tests.some((test) => test.id === login.test.id && test.name === 'Member sign-in'),
    login.test.id,
  );

  await page.evaluate((id) => {
    const card = document.querySelector(`[data-rename="${id}"]`).closest('article');
    [...card.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Duplicate').click();
  }, login.test.id);
  await page.waitForFunction(() => document.body.innerText.includes('Member sign-in copy'));
  const duplicated = await stored();
  const copy = duplicated.tests.find((test) => test.name === 'Member sign-in copy');
  record(
    'Duplicate gets a new id and keeps the original run',
    !!copy && copy.id !== login.test.id && duplicated.tests.some((test) => test.id === login.test.id)
      && duplicated.runs.some((run) => run.id === 'kept-run' && run.status === 'failed'),
    copy ? copy.id : 'missing copy',
  );

  acceptDelete = false;
  await page.evaluate((id) => {
    const card = document.querySelector(`[data-rename="${id}"]`).closest('article');
    [...card.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Delete').click();
  }, copy.id);
  await page.waitForFunction(() => document.body.innerText.includes('Member sign-in copy'));
  const kept = await stored();
  record('Delete confirmation can be cancelled', kept.tests.some((test) => test.id === copy.id), 'Copy remains');

  acceptDelete = true;
  await page.evaluate((id) => {
    const card = document.querySelector(`[data-rename="${id}"]`).closest('article');
    [...card.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Delete').click();
  }, copy.id);
  await page.waitForFunction(() => !document.body.innerText.includes('Member sign-in copy'));
  const afterDelete = await stored();
  record(
    'Confirmed delete removes the copy and keeps history',
    !afterDelete.tests.some((test) => test.id === copy.id)
      && afterDelete.tests.some((test) => test.id === login.test.id)
      && afterDelete.runs.some((run) => run.id === 'kept-run'),
    'Original test and failed run remain',
  );

  const site = await browser.newPage();
  await site.goto(demo.url, { waitUntil: 'domcontentloaded' });
  const tabId = await page.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith(url));
    return tab ? tab.id : null;
  }, demo.url);
  const started = await send({ type: 'session:start', tabId, networkCapture: false });
  const beforeSteps = started.session.steps.length;
  await page.bringToFront();
  await page.evaluate(() => document.querySelector('[data-view="home"]').click());
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  const during = await stored();
  record(
    'Navigation while recording keeps the session',
    during.session && during.session.status === 'recording' && during.session.steps.length === beforeSteps,
    during.session ? during.session.status : 'no session',
  );
  await send({ type: 'session:stop' });
} catch (error) {
  record('Library UI', false, error.stack || error.message);
} finally {
  await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 4000))]);
  await demo.close();
}

const failed = report.scenarios.filter((item) => !item.pass);
console.log(`${report.scenarios.length - failed.length}/${report.scenarios.length} library UI checks passed`);
process.exit(failed.length ? 1 : 0);
