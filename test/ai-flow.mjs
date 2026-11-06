import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startDemo } from '../demo/server.mjs';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prompt = 'Test the login page with invalid credentials, verify the error message, and check navigation.';
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
  const site = await browser.newPage();
  await site.goto(demo.url, { waitUntil: 'domcontentloaded' });
  const ui = await openController(browser, extensionId);
  await site.bringToFront();
  await ui.waitForFunction((url) => {
    const label = document.getElementById('targetLabel');
    return !!label && label.textContent.includes(url);
  }, { timeout: 8000 }, demo.url);

  await clickButton(ui, 'AI assistant');
  await ui.locator('#aiPrompt').fill(prompt);
  await clickButton(ui, 'Generate proposal');
  await ui.waitForFunction(() => document.body.innerText.includes('Inspected'), { timeout: 8000 });
  const proposal = await ui.evaluate(() => {
    const fields = [...document.querySelectorAll('input')].map((node) => node.value).join('\n');
    return `${document.body.innerText}\n${fields}`;
  });
  const grounded = proposal.includes('data-testid=username')
    && proposal.includes('data-testid=password')
    && proposal.includes('data-testid=submit')
    && proposal.includes('data-testid=error')
    && !proposal.includes('data-testid=welcome')
    && !proposal.includes('/app');
  const fieldDump = proposal.split('\n').filter((line) => /Enter |Click |Assert |Navigate |selector/.test(line)).join(' || ');
  record(
    'Mock proposal uses only elements from the open page',
    grounded && proposal.includes('Proposed, not executed'),
    grounded ? 'username, password, submit, and error came from the page' : fieldDump,
  );
  const edited = await ui.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((node) => node.value.includes('Assert text'));
    if (!input) return false;
    input.value = 'Assert text equals "Wrong message"';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  if (!edited) throw new Error('The error assertion was not offered for editing');
  await clickButton(ui, 'Approve and save');
  await ui.waitForFunction(() => document.body.innerText.includes('Invalid login shows an error'), { timeout: 8000 });
  record('Approved plan is saved for review', true, 'Approve and save stored the edited proposal');

  await clickButton(ui, 'Run tests');
  await site.bringToFront();
  await ui.waitForFunction((url) => document.getElementById('targetLabel').textContent.includes(url), { timeout: 8000 }, demo.url);
  await ui.locator('[data-param="wrongPassword"]').fill('not-the-password');
  await clickButton(ui, 'Run');
  await ui.waitForFunction(() => document.getElementById('statusPill').textContent === 'failed', { timeout: 20000 });
  const resultText = await ui.evaluate(() => document.body.innerText);
  const failedHonestly = resultText.includes('Expected: Wrong message') && resultText.includes('Actual: Invalid credentials');
  record(
    'Running the approved test fails with the page text',
    failedHonestly,
    failedHonestly ? 'Expected Wrong message. Actual Invalid credentials.' : resultText.slice(0, 700),
  );
  await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  await ui.screenshot({ path: path.join(process.cwd(), 'test-results', 'ai-failed-run.png') });

  const generated = await ui.evaluate(() => {
    return chrome.storage.local.get('tests').then((stored) => {
      const saved = (stored.tests || []).find((item) => item.name === 'Invalid login shows an error and stays here');
      if (!saved) return null;
      return {
        playwright: CodeGen.renderPlaywright(saved.steps),
        selenium: CodeGen.renderSelenium(saved.steps),
        cypress: CodeGen.renderCypress(saved.steps),
        rest: CodeGen.renderRestAssured([]),
      };
    });
  });
  record(
    'Approved test still generates all four frameworks',
    !!generated
      && generated.playwright.includes('getByTestId("error")')
      && generated.playwright.includes('TEST_WRONGPASSWORD')
      && generated.playwright.includes('Wrong message')
      && !generated.playwright.includes('not-the-password')
      && generated.selenium.includes('RecordedPage')
      && generated.cypress.includes('RecordedPage')
      && generated.rest.includes('RestAssured'),
    generated ? 'Playwright, Selenium, Cypress, and REST Assured generated from the saved steps' : 'saved test was missing',
  );
} catch (error) {
  record('AI flow harness', false, error.stack || error.message);
} finally {
  await mkdir(path.join(process.cwd(), 'test-results'), { recursive: true });
  await writeFile(path.join(process.cwd(), 'test-results', 'ai-flow.json'), JSON.stringify(report, null, 2));
  await Promise.race([browser.close(), delay(5000)]);
  await demo.close();
}

const failed = report.scenarios.filter((scenario) => !scenario.pass);
console.log(`\n${report.scenarios.length - failed.length}/${report.scenarios.length} checks passed`);
process.exit(failed.length ? 1 : 0);
