import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const report = { scenarios: [] };

function record(name, pass, detail) {
  report.scenarios.push({ name, pass, detail });
  process.stderr.write(`${pass ? 'PASS' : 'FAIL'} ${name}\n  ${detail}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launch(extra = {}) {
  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    enableExtensions: true,
    args: ['--no-first-run', '--disable-default-apps'],
    ...extra,
  });
}

async function tabId(extensionPage, url) {
  return extensionPage.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === target || item.url === `${target}/`);
    return tab ? tab.id : null;
  }, url);
}

async function readSession(extensionPage) {
  return extensionPage.evaluate(async () => {
    const stored = await chrome.storage.local.get(['session', 'tests']);
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return {
      session: stored.session,
      tests: stored.tests || [],
      scripts: scripts
        .filter((script) => script.id === 'asg-recorder' || script.id === 'asg-network')
        .map((script) => ({ id: script.id, matches: script.matches })),
    };
  });
}

async function checkboxState(extensionPage) {
  return extensionPage.evaluate(() => {
    const box = document.getElementById('networkCapture');
    return {
      checked: !!(box && box.checked),
      disabled: !!(box && box.disabled),
      text: document.body.innerText,
    };
  });
}

async function waitForCheckbox(extensionPage, expected) {
  let last = null;
  const start = Date.now();
  while (Date.now() - start < 4000) {
    last = await checkboxState(extensionPage);
    if (last.checked === expected.checked && last.disabled === expected.disabled && last.text.includes(expected.text)) return last;
    await delay(100);
  }
  throw new Error(`checkbox ${JSON.stringify(expected)}: ${JSON.stringify(last)}`);
}

async function waitForSession(extensionPage, predicate, label) {
  let last = null;
  const start = Date.now();
  while (Date.now() - start < 5000) {
    last = await readSession(extensionPage);
    if (predicate(last)) return last;
    await delay(100);
  }
  throw new Error(`${label}: ${JSON.stringify(last && last.session && { status: last.session.status, origin: last.session.origin, steps: last.session.steps.map((step) => step.type) })}`);
}

const siteA = await startDemo(0);
const siteB = await startDemo(0);
const browser = await launch();
let failed = false;

try {
  report.chrome = await browser.version();
  const extensionId = await browser.installExtension(process.cwd());
  report.extensionId = extensionId;
  const extensionPage = await browser.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const send = (message) => extensionPage.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  await pageA.goto(siteA.url, { waitUntil: 'domcontentloaded' });
  await pageB.goto(siteB.url, { waitUntil: 'domcontentloaded' });
  const idA = await tabId(extensionPage, siteA.url);
  const idB = await tabId(extensionPage, siteB.url);
  if (!idA || !idB) throw new Error(`Missing tab ids A=${idA} B=${idB}`);

  const startedA = await send({ type: 'session:start', tabId: idA, networkCapture: false });
  if (!startedA.ok) throw new Error(startedA.message || 'site A did not start');
  const field = await pageA.evaluate(() => {
    const el = document.querySelector('[data-testid="username"]');
    if (!el) return { missing: true, url: location.href, title: document.title };
    const rect = el.getBoundingClientRect();
    return { url: location.href, width: rect.width, height: rect.height };
  });
  if (!field.width) throw new Error(`username field is not clickable: ${JSON.stringify(field)}`);
  await pageA.bringToFront();
  await pageA.click('[data-testid="username"]');
  const recordedA = await waitForSession(extensionPage, (state) => state.session && state.session.steps.some((step) => step.type === 'click'), 'click on site A');
  await send({ type: 'session:stop' });
  const stoppedA = await waitForSession(extensionPage, (state) => state.session && state.session.status === 'stopped', 'stop site A');
  const draftSteps = stoppedA.session.steps.length;
  const missing = await send({ type: 'session:start', tabId: 2147483646, networkCapture: true });
  const versionPage = await browser.newPage();
  await versionPage.goto('chrome://version');
  const versionId = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith('chrome://version'));
    return tab ? tab.id : null;
  });
  const blocked = versionId
    ? await send({ type: 'session:start', tabId: versionId, networkCapture: true })
    : { ok: false, message: 'chrome://version tab was missing' };
  const example = await browser.newPage();
  let denied = { ok: false, message: 'https://example.com did not open' };
  try {
    await example.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const exampleId = await extensionPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => (item.url || '').startsWith('https://example.com'));
      return tab ? tab.id : null;
    });
    if (exampleId) denied = await send({ type: 'session:start', tabId: exampleId, networkCapture: true });
  } catch (error) {
    denied = { ok: false, message: error.message };
  }
  const preserved = await readSession(extensionPage);
  record(
    'A failed start keeps the original draft',
    missing.ok === false
      && blocked.ok === false
      && denied.ok === false
      && !!versionId
      && preserved.session
      && preserved.session.id === stoppedA.session.id
      && preserved.session.status === 'stopped'
      && preserved.session.origin === siteA.url
      && preserved.session.steps.length === draftSteps
      && preserved.scripts.length === 0,
    [missing.message, blocked.message, denied.message].filter(Boolean).join(' | '),
  );
  await versionPage.close();
  await example.close().catch(() => {});

  try {
    const bootstrap = await browser.newPage();
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
    await bootstrap.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await bootstrap.evaluate(() => chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 1120,
      height: 800,
    }));
    const ui = await (await created).page();
    ui.on('dialog', (dialog) => dialog.dismiss());
    await pageB.bringToFront();
    await ui.waitForFunction((url) => {
      const button = document.getElementById('startButton');
      const label = document.getElementById('targetLabel');
      return !!button && !button.disabled && !!label && label.textContent.includes(url);
    }, { timeout: 8000 }, siteB.url);
    await ui.locator('#startButton').click({ timeout: 8000 });
    await delay(400);
    const cancelled = await readSession(extensionPage);
    record(
      'Cancel keeps the original draft',
      cancelled.session
        && cancelled.session.status === 'stopped'
        && cancelled.session.origin === siteA.url
        && cancelled.session.steps.length === draftSteps,
      `${cancelled.session && cancelled.session.status} ${cancelled.session && cancelled.session.origin} steps=${cancelled.session && cancelled.session.steps.length}`,
    );
    await ui.close();
    await bootstrap.close();
  } catch (error) {
    record('Cancel keeps the original draft', false, error.message);
  }

  const startedB = await send({ type: 'session:start', tabId: idB, networkCapture: false });
  const cross = await readSession(extensionPage);
  const onlyB = cross.scripts.length === 1
    && cross.scripts[0].id === 'asg-recorder'
    && cross.scripts[0].matches.length === 1
    && cross.scripts[0].matches[0] === `${siteB.url}/*`;
  record(
    'Cross-site start replaces the draft and registers only the new origin',
    !!startedB.ok && cross.session.status === 'recording' && cross.session.origin === siteB.url && onlyB
      && !String(startedB.message || '').includes('Duplicate script ID'),
    startedB.ok ? `${cross.session.origin} ${JSON.stringify(cross.scripts)}` : (startedB.message || 'start failed'),
  );
  record(
    'Switching origins with API capture off leaves only the new site',
    !!startedB.ok
      && startedB.session.networkCapture === false
      && cross.scripts.length === 1
      && cross.scripts[0].id === 'asg-recorder'
      && cross.scripts[0].matches.length === 1
      && cross.scripts[0].matches[0] === `${siteB.url}/*`
      && cross.scripts.every((script) => script.matches.every((match) => !match.startsWith(siteA.url))),
    JSON.stringify(cross.scripts),
  );

  await pageA.bringToFront();
  await pageA.click('[data-testid="username"]');
  await pageB.bringToFront();
  await pageB.click('[data-testid="username"]');
  const captured = await waitForSession(
    extensionPage,
    (state) => state.session && state.session.steps.filter((step) => step.type === 'click').length >= 1,
    'click on the new site',
  );
  const clicks = captured.session.steps.filter((step) => step.type === 'click');
  const oldUrls = captured.session.steps.filter((step) => step.url && step.url.startsWith(siteA.url));
  record(
    'Old-site actions are not captured and one click is one event',
    clicks.length === 1 && oldUrls.length === 0 && captured.session.origin === siteB.url,
    `clicks=${clicks.length} oldUrls=${oldUrls.length}`,
  );

  await send({ type: 'session:stop' });
  const again = await send({ type: 'session:start', tabId: idB, networkCapture: false });
  record(
    'Stop then start on the same site',
    !!again.ok && !String(again.message || '').includes('Duplicate script ID'),
    again.ok ? again.session.origin : (again.message || 'start failed'),
  );

  await send({ type: 'session:pause' });
  try {
    const pausedBox = await waitForCheckbox(extensionPage, { checked: false, disabled: true, text: 'network capture off' });
    record(
      'API capture checkbox matches a paused recording',
      pausedBox.checked === false && pausedBox.disabled === true,
      `checked=${pausedBox.checked} disabled=${pausedBox.disabled}`,
    );
  } catch (error) {
    record('API capture checkbox matches a paused recording', false, error.message);
  }
  await send({ type: 'session:resume' });
  await send({ type: 'session:stop' });
  const afterPause = await send({ type: 'session:start', tabId: idB, networkCapture: false });
  record(
    'Pause, resume, stop, then start',
    !!afterPause.ok && afterPause.session.status === 'recording',
    afterPause.ok ? afterPause.session.status : (afterPause.message || 'start failed'),
  );

  await send({ type: 'session:stop' });
  const raced = await Promise.all([
    send({ type: 'session:start', tabId: idB, networkCapture: false }),
    send({ type: 'session:start', tabId: idB, networkCapture: false }),
  ]);
  const duplicate = raced.some((result) => String(result.message || '').includes('Duplicate script ID'));
  record(
    'Two overlapping starts do not register the recorder twice',
    raced.filter((result) => result.ok).length === 1 && !duplicate,
    raced.map((result) => result.ok ? 'ok' : result.message).join(' | '),
  );
  await send({ type: 'session:stop' });
  const afterRace = await send({ type: 'session:start', tabId: idB, networkCapture: false });
  record(
    'Recording can start again after the overlapping attempt',
    !!afterRace.ok,
    afterRace.ok ? afterRace.session.status : (afterRace.message || 'start failed'),
  );

  await pageB.bringToFront();
  await pageB.click('[data-testid="username"]');
  await waitForSession(extensionPage, (state) => state.session && state.session.steps.some((step) => step.type === 'click'), 'click before save');
  await send({ type: 'session:stop' });
  const saved = await send({ type: 'tests:save', name: 'Recorder start regression' });
  const next = await send({ type: 'session:start', tabId: idA, networkCapture: false });
  const kept = await readSession(extensionPage);
  record(
    'A saved test remains when another recording starts',
    !!saved.ok && !!next.ok && kept.tests.some((test) => test.name === 'Recorder start regression') && kept.session.origin === siteA.url,
    kept.tests.map((test) => test.name).join(', ') || (next.message || 'missing test'),
  );

  await pageA.goto(`${siteA.url}/app.html`, { waitUntil: 'domcontentloaded' });
  const moved = await waitForSession(
    extensionPage,
    (state) => state.session && state.session.steps.some((step) => step.type === 'navigate' && step.url && step.url.includes('/app.html')),
    'navigation while recording',
  );
  record(
    'Navigation while recording stays on the selected origin',
    moved.session.origin === siteA.url && moved.session.steps.some((step) => step.url && step.url.includes('/app.html'))
      && moved.session.steps.every((step) => !step.url || step.url.startsWith(siteA.url)),
    moved.session.steps.filter((step) => step.type === 'navigate').map((step) => step.url).join(' | '),
  );

  await send({ type: 'session:stop' });
  const quiet = await send({ type: 'session:start', tabId: idB, networkCapture: false });
  await pageB.evaluate(async (other) => {
    await fetch('/api/profile').catch(() => {});
    await fetch(`${other}/api/profile`).catch(() => {});
  }, siteA.url);
  await delay(400);
  const optedOut = await readSession(extensionPage);
  record(
    'API capture stays off unless it is opted in',
    !!quiet.ok && (optedOut.session.apiCalls || []).length === 0
      && optedOut.scripts.every((script) => script.id !== 'asg-network'),
    `calls=${(optedOut.session.apiCalls || []).length} scripts=${optedOut.scripts.map((script) => script.id).join(',')}`,
  );
  try {
    const offBox = await waitForCheckbox(extensionPage, { checked: false, disabled: true, text: 'network capture off' });
    record(
      'API capture checkbox is off while that recording is active',
      offBox.checked === false && offBox.disabled === true && optedOut.session.networkCapture === false,
      `checked=${offBox.checked} disabled=${offBox.disabled}`,
    );
  } catch (error) {
    record('API capture checkbox is off while that recording is active', false, error.message);
  }

  await send({ type: 'session:stop' });
  const noisy = await send({ type: 'session:start', tabId: idB, networkCapture: true });
  await delay(200);
  await pageB.evaluate(async (other) => {
    await fetch('/api/profile').catch(() => {});
    await fetch(`${other}/api/profile`).catch(() => {});
  }, siteA.url);
  const optedIn = await waitForSession(
    extensionPage,
    (state) => state.session && (state.session.apiCalls || []).some((call) => String(call.url).includes('/api/profile')),
    'same-origin API capture',
  );
  const foreign = (optedIn.session.apiCalls || []).filter((call) => String(call.url).startsWith(siteA.url));
  const networkScript = optedIn.scripts.find((script) => script.id === 'asg-network');
  record(
    'API capture records only the selected origin',
    !!noisy.ok && foreign.length === 0 && networkScript && networkScript.matches.length === 1 && networkScript.matches[0] === `${siteB.url}/*`,
    `calls=${(optedIn.session.apiCalls || []).map((call) => call.url).join(' | ')} matches=${networkScript && networkScript.matches}`,
  );
  try {
    const onBox = await waitForCheckbox(extensionPage, { checked: true, disabled: true, text: 'network capture on' });
    record(
      'API capture checkbox is on while that recording is active',
      onBox.checked === true && onBox.disabled === true && optedIn.session.networkCapture === true
        && networkScript.matches[0] === `${siteB.url}/*`,
      `checked=${onBox.checked} disabled=${onBox.disabled}`,
    );
  } catch (error) {
    record('API capture checkbox is on while that recording is active', false, error.message);
  }

  await send({ type: 'session:stop' });
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const targets = await cdp.send('Target.getTargets');
  const worker = targets.targetInfos.find((target) => target.type === 'service_worker' && target.url.includes(extensionId));
  if (!worker) throw new Error('Service worker target was not found');
  await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  await delay(800);
  const fresh = await browser.newPage();
  await fresh.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  const restarted = await fresh.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => (item.url || '').startsWith(target));
    return chrome.runtime.sendMessage({ type: 'session:start', tabId: tab && tab.id, networkCapture: false });
  }, siteB.url);
  record(
    'Start works after the service worker restarts',
    !!restarted.ok && !String(restarted.message || '').includes('Duplicate script ID'),
    restarted.ok ? restarted.session.status : (restarted.message || 'start failed'),
  );
  await fresh.evaluate(() => chrome.runtime.sendMessage({ type: 'session:stop' }));
} catch (error) {
  failed = true;
  record('Recorder start suite', false, error.stack || error.message);
} finally {
  await browser.close().catch(() => {});
  await siteA.close();
  await siteB.close();
}

const profile = await mkdtemp(path.join(tmpdir(), 'asg-recorder-'));
const first = await launch({ userDataDir: profile });
try {
  const extensionId = await first.installExtension(process.cwd());
  const demo = await startDemo(0);
  try {
    const page = await first.newPage();
    await page.goto(demo.url, { waitUntil: 'domcontentloaded' });
    const extensionPage = await first.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    const started = await extensionPage.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url || item.url === `${url}/`);
      return chrome.runtime.sendMessage({ type: 'session:start', tabId: tab && tab.id, networkCapture: false });
    }, demo.url);
    if (!started.ok) throw new Error(started.message || 'first launch did not start');
    await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'session:stop' }));
    await first.close();
    const second = await launch({ userDataDir: profile });
    try {
      const reloadedId = await second.installExtension(process.cwd());
      const extensionPage2 = await second.newPage();
      await extensionPage2.goto(`chrome-extension://${reloadedId}/popup.html`, { waitUntil: 'domcontentloaded' });
      const site = await second.newPage();
      await site.goto(demo.url, { waitUntil: 'domcontentloaded' });
      const startedAgain = await extensionPage2.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((item) => item.url === url || item.url === `${url}/`);
        return chrome.runtime.sendMessage({ type: 'session:start', tabId: tab && tab.id, networkCapture: false });
      }, demo.url);
      record(
        'Start works after Chrome restarts',
        !!startedAgain.ok && startedAgain.session.origin === demo.url && !String(startedAgain.message || '').includes('Duplicate script ID'),
        startedAgain.ok ? startedAgain.session.origin : (startedAgain.message || 'start failed'),
      );
      await extensionPage2.evaluate(() => chrome.runtime.sendMessage({ type: 'session:stop' }));
    } finally {
      await second.close().catch(() => {});
    }
  } finally {
    await demo.close();
  }
} catch (error) {
  failed = true;
  record('Start works after Chrome restarts', false, error.stack || error.message);
  await first.close().catch(() => {});
} finally {
  await rm(profile, { recursive: true, force: true });
}

const failedCount = report.scenarios.filter((item) => !item.pass).length;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed || failedCount) process.exit(1);
