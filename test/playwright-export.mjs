import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { startDemo } from '../demo/server.mjs';

const require = createRequire(import.meta.url);
require('../lib/schema.js');
const ai = require('../lib/ai.js');
const code = require('../codegen.js');

const password = 'demo123';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.resolve('test-results/playwright-export');
const report = { passRun: null, failRun: null, passwordLeaked: false };

function redact(text) {
  return String(text).split(password).join('[redacted]');
}

function splitExport(rendered) {
  const files = {};
  const parts = rendered.split(/\/\/ ==== (.+?) ====\n/);
  for (let index = 1; index < parts.length; index += 2) files[parts[index]] = parts[index + 1];
  return files;
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

function runRunner(spec) {
  return new Promise((resolve) => {
    const child = spawn(path.resolve('node_modules/.bin/playwright'), [
      'test',
      spec,
      '--config',
      'playwright.config.ts',
    ], {
      cwd: root,
      env: {
        ...process.env,
        TEST_PASSWORD: password,
        CHROME_PATH: chromePath,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

const demo = await startDemo(0);
try {
  const pageUrl = `${demo.url}/`;
  const appUrl = `${demo.url}/app.html`;
  const evidence = {
    pageUrl,
    items: [
      { tag: 'input', type: 'text', testid: 'username', id: 'username', name: 'username', label: 'Username', text: '', role: '' },
      { tag: 'input', type: 'password', testid: 'password', id: 'password', name: 'password', label: 'Password', text: '', role: '' },
      { tag: 'button', type: 'submit', testid: 'submit', id: '', name: '', label: '', text: 'Sign in', role: '' },
      { tag: 'p', type: '', testid: 'error', id: 'error', name: '', label: '', text: '', role: '' },
    ],
  };
  const plan = ai.mockPlan('Test the login form, verify invalid credentials show an error, then test a successful login.', { evidence });
  const success = plan.cases.find((item) => /Valid/.test(item.name));
  ai.applyStepEdit(success.steps.find((step) => step.type === 'input' && !step.secret), 'Enter "demo" into data-testid=username');
  ai.applyStepEdit(success.steps.find((step) => step.type === 'assertUrl'), `Assert URL equals "${appUrl}"`);
  const rendered = code.renderPlaywright(success.steps);
  const files = splitExport(rendered);
  if (!files['RecordedPage.ts'] || !files['recorded.spec.ts']) {
    throw new Error(`Export did not contain the Playwright files. Keys: ${Object.keys(files).join(', ')}`);
  }
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'RecordedPage.ts'), files['RecordedPage.ts']);
  await writeFile(path.join(root, 'recorded.spec.ts'), files['recorded.spec.ts']);
  await writeFile(path.join(root, 'recorded-fail.spec.ts'), files['recorded.spec.ts'].replace(appUrl, `${demo.url}/not-the-app`));
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

  const passed = await runRunner('recorded.spec.ts');
  const failed = await runRunner('recorded-fail.spec.ts');
  const leaked = passed.output.includes(password)
    || failed.output.includes(password)
    || await filesContain(root, password);
  report.passRun = { code: passed.code, output: redact(passed.output) };
  report.failRun = { code: failed.code, output: redact(failed.output) };
  report.passwordLeaked = leaked;
  await mkdir(path.resolve('test-results'), { recursive: true });
  await writeFile(path.resolve('test-results/playwright-export.json'), JSON.stringify(report, null, 2));
  console.log(redact(passed.output));
  console.log(redact(failed.output));
  if (passed.code !== 0) throw new Error('The exported login test did not pass.');
  if (failed.code === 0) throw new Error('The deliberately wrong assertion passed.');
  if (leaked) throw new Error('The demo password appeared in the Playwright output or files.');
  console.log('PASS exported login test');
  console.log('PASS deliberate assertion failure');
  console.log('PASS password absent from output and files');
} finally {
  await demo.close();
}
