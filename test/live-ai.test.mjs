import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const token = process.env.PROXY_AUTH_TOKEN || '';
const providerKey = process.env.AI_API_KEY || '';
const configured = Boolean(token && providerKey);

test('live provider returns a schema-valid plan', {
  skip: configured ? false : 'UNVERIFIED: set PROXY_AUTH_TOKEN and AI_API_KEY, then run node --test test/live-ai.test.mjs. See docs/AI_POLICY.md.',
  timeout: 30000,
}, async () => {
  let output = '';
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const child = spawn(process.execPath, ['server/ai-proxy.mjs'], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => settle.reject(new Error('live proxy did not listen')), 5000);
  const onData = (chunk) => {
    output += chunk;
    const match = output.match(/127\.0\.0\.1:(\d+)/);
    if (!match) return;
    clearTimeout(timer);
    settle.resolve(Number(match[1]));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    clearTimeout(timer);
    settle.reject(new Error(`live proxy exited ${code}`));
  });
  const port = await ready;
  try {
    const body = JSON.stringify({
      prompt: 'Propose one case that navigates to https://example.com and asserts that URL. Do not invent selectors.',
      targetOrigin: 'https://example.com',
      pageEvidence: [],
    });
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    assert.equal(text.includes(providerKey), false);
    assert.equal(output.includes(providerKey), false);
    assert.equal(response.status, 200, `provider path returned ${response.status}`);
    const plan = JSON.parse(text);
    assert.equal(plan.source, 'live');
    assert.ok(Array.isArray(plan.cases) && plan.cases.length > 0);
    assert.equal(Object.hasOwn(plan, 'script'), false);
  } finally {
    child.kill();
  }
});
