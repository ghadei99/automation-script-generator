import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const library = require('../lib/library.js');

const recorded = { id: 'rec-1', name: 'Login flow', source: 'recorded', steps: [{ type: 'navigate', url: 'http://127.0.0.1/' }] };
const ai = { id: 'ai-1', name: 'AI login', source: 'ai', steps: [{ type: 'click' }, { type: 'assertText' }] };

test('dashboard statistics come only from stored tests and runs', () => {
  const stats = library.dashboardStats(
    [recorded, ai],
    [
      { id: 'run-new', testName: 'Login flow', status: 'failed', startedAt: 20 },
      { id: 'run-old', testName: 'AI login', status: 'passed', startedAt: 10 },
      { id: 'run-stop', testName: 'Login flow', status: 'stopped', startedAt: 5 },
    ],
    { status: 'recording' },
  );
  assert.equal(stats.savedTests, 2);
  assert.equal(stats.executions, 3);
  assert.equal(stats.passed, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.latest.status, 'failed');
  assert.equal(stats.latest.testName, 'Login flow');
  assert.equal(stats.recording, 'recording');
});

test('an empty library and history do not invent a result', () => {
  const stats = library.dashboardStats(null, [], null);
  assert.deepEqual(stats, {
    savedTests: 0,
    executions: 0,
    passed: 0,
    failed: 0,
    latest: null,
    recording: 'idle',
  });
});

test('search matches the test name and filters recorded tests from AI tests', () => {
  const tests = [recorded, ai, { id: 'other', name: 'Checkout', source: 'recorded', steps: [] }];
  assert.deepEqual(library.filterTests(tests, 'login', 'all').map((test) => test.id), ['rec-1', 'ai-1']);
  assert.deepEqual(library.filterTests(tests, 'LOGIN', 'recorded').map((test) => test.id), ['rec-1']);
  assert.deepEqual(library.filterTests(tests, '', 'ai').map((test) => test.id), ['ai-1']);
  assert.deepEqual(library.filterTests(tests, 'missing', 'all'), []);
});

test('a duplicate keeps the steps and receives a new id', () => {
  const copy = library.duplicateTest(recorded, 'rec-2');
  assert.equal(copy.id, 'rec-2');
  assert.notEqual(copy.id, recorded.id);
  assert.equal(copy.name, 'Login flow copy');
  assert.deepEqual(copy.steps, recorded.steps);
  assert.equal(recorded.id, 'rec-1');
  copy.steps[0].url = 'http://changed/';
  assert.equal(recorded.steps[0].url, 'http://127.0.0.1/');
  assert.throws(() => library.duplicateTest(recorded, 'rec-1'), /new id/);
});

test('renaming and deleting are separate from the stored run history', () => {
  const tests = [recorded, ai];
  const runs = [{ id: 'run-1', testId: 'rec-1', status: 'passed' }];
  const renamed = tests.map((test) => (test.id === 'rec-1' ? { ...test, name: 'Member login' } : test));
  const removed = renamed.filter((test) => test.id !== 'ai-1');
  assert.equal(renamed.find((test) => test.id === 'rec-1').name, 'Member login');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].id, 'rec-1');
  assert.equal(runs[0].testId, 'rec-1');
  assert.equal(runs[0].status, 'passed');
});
