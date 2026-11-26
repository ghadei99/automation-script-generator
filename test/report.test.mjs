import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const reportApi = require('../lib/report.js');
const build = require('../lib/build.js');

const jpeg = `data:image/jpeg;base64,${'A'.repeat(120)}==`;

function run(partial) {
  return {
    testName: 'Demo login',
    status: 'passed',
    startedAt: Date.parse('2026-11-26T06:00:00.000Z'),
    finishedAt: Date.parse('2026-11-26T06:00:04.000Z'),
    results: [],
    ...partial,
  };
}

test('a successful run reports its name, time, counts, and status', () => {
  const report = reportApi.buildReport(run({
    results: [
      { index: 0, type: 'navigate', status: 'passed', actual: 'http://127.0.0.1/' },
      { index: 1, type: 'click', status: 'passed', actual: 'clicked' },
    ],
  }));
  assert.equal(report.testName, 'Demo login');
  assert.equal(report.status, 'passed');
  assert.equal(report.startedAt, '2026-11-26T06:00:00.000Z');
  assert.equal(report.durationMs, 4000);
  assert.deepEqual(report.counts, { passed: 2, failed: 0, skipped: 0, total: 2 });
  const html = reportApi.renderReportHtml(report);
  assert.match(html, /Demo login/);
  assert.match(html, /2 passed, 0 failed, 0 skipped, 2 total/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<link/i);
});

test('a failed assertion keeps the real expected and actual values', () => {
  const report = reportApi.buildReport(run({
    status: 'failed',
    results: [{
      index: 0,
      type: 'assertText',
      status: 'failed',
      message: 'Text did not match',
      expected: 'Not the real error',
      actual: 'Invalid credentials',
    }],
  }));
  assert.equal(report.status, 'failed');
  assert.equal(report.steps[0].status, 'failed');
  assert.equal(report.steps[0].expected, 'Not the real error');
  assert.equal(report.steps[0].actual, 'Invalid credentials');
  assert.match(reportApi.renderReportHtml(report), /Not the real error/);
  assert.match(reportApi.renderReportHtml(report), /Invalid credentials/);
});

test('skipped steps stay skipped and are counted', () => {
  const report = reportApi.buildReport(run({
    status: 'failed',
    results: [
      { index: 0, type: 'click', status: 'failed', message: 'Element was not found' },
      { index: 1, type: 'assertUrl', status: 'skipped', message: 'Skipped because a previous step failed' },
    ],
  }));
  assert.equal(report.counts.skipped, 1);
  assert.equal(report.steps[1].status, 'skipped');
  assert.equal(report.status, 'failed');
});

test('a missing screenshot is reported as unavailable and is not invented', () => {
  const report = reportApi.buildReport(run({
    status: 'failed',
    results: [{
      index: 0,
      type: 'assertText',
      status: 'failed',
      message: 'Text did not match',
      screenshot: null,
      screenshotError: 'Screenshot unavailable. Either the <all_urls> or activeTab permission is required.',
    }],
  }));
  assert.equal(report.steps[0].screenshot, 'unavailable');
  assert.equal(report.steps[0].screenshotData, null);
  assert.match(reportApi.renderReportHtml(report), /Screenshot unavailable/);
  assert.doesNotMatch(reportApi.renderReportHtml(report), /<img/i);
});

test('missing execution fields produce an unknown report instead of a pass', () => {
  const report = reportApi.buildReport({});
  assert.equal(report.testName, 'Untitled test');
  assert.equal(report.status, 'unknown');
  assert.equal(report.startedAt, null);
  assert.equal(report.finishedAt, null);
  assert.equal(report.durationMs, null);
  assert.deepEqual(report.counts, { passed: 0, failed: 0, skipped: 0, total: 0 });
  assert.match(reportApi.renderReportHtml(report), /Date unavailable/);
  assert.match(reportApi.renderReportHtml(report), /Duration unavailable/);
  const dishonest = reportApi.buildReport({ status: 'failed', results: [{ status: 'passed' }] });
  assert.equal(dishonest.status, 'failed');
  assert.equal(dishonest.steps[0].status, 'passed');
});

test('malicious HTML in names and messages is escaped and cannot execute', () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const report = reportApi.buildReport(run({
    testName: hostile,
    status: 'failed',
    error: hostile,
    results: [{ index: 0, type: hostile, status: 'failed', message: hostile, expected: hostile, actual: hostile }],
  }));
  const html = reportApi.renderReportHtml(report);
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /javascript:/i);
});

test('reports redact secrets, drop request bodies, and omit screenshots unless requested', () => {
  const source = run({
    status: 'failed',
    testName: 'Login',
    error: 'provider rejected Bearer abcdefghijklmnop',
    requestBody: '{"password":"demo123","token":"abcdefghi"}',
    responseBody: 'raw body',
    params: { password: 'demo123' },
    results: [{
      index: 0,
      type: 'input',
      status: 'failed',
      message: 'Field kept demo123 and password=demo123',
      expected: 'eyJaaaaaaaa.bbbbbbbb.cccccccc',
      actual: 'authorization: secret-value',
      screenshot: jpeg,
    }],
  });
  const hidden = reportApi.publicReport(reportApi.buildReport(source, { secrets: ['demo123'] }));
  const text = JSON.stringify(hidden);
  assert.equal(text.includes('demo123'), false);
  assert.equal(text.includes('abcdefghijklmnop'), false);
  assert.equal(text.includes('eyJaaaaaaaa'), false);
  assert.equal(text.includes('requestBody'), false);
  assert.equal(text.includes('responseBody'), false);
  assert.equal(text.includes('secret-value'), false);
  assert.equal(hidden.steps[0].screenshot, 'omitted');
  assert.equal(hidden.steps[0].screenshotData, null);
  assert.equal(text.includes(jpeg), false);

  const shown = reportApi.publicReport(reportApi.buildReport(source, { secrets: ['demo123'], includeEvidence: true }));
  assert.equal(shown.steps[0].screenshot, 'included');
  assert.equal(shown.steps[0].screenshotData, jpeg);
  const html = reportApi.renderReportHtml(reportApi.buildReport(source, { includeEvidence: true, secrets: ['demo123'] }));
  assert.match(html, /<img alt="Failure screenshot"/);
  assert.equal(html.includes('demo123'), false);

  const evil = reportApi.buildReport(run({
    results: [{ status: 'failed', screenshot: 'javascript:alert(1)' }],
  }), { includeEvidence: true });
  assert.equal(evil.steps[0].screenshot, 'none');
  assert.equal(reportApi.renderReportHtml(evil).includes('javascript:'), false);
});

test('the development build keeps remote planning available to the source tree', () => {
  assert.equal(build.storeBuild, false);
});
