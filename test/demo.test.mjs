import assert from 'node:assert/strict';
import test from 'node:test';
import { startDemo } from '../demo/server.mjs';

test('demo login accepts only the published dummy credentials', async () => {
  const demo = await startDemo(0);
  try {
    const bad = await fetch(`${demo.url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'wrong' }),
    });
    assert.equal(bad.status, 401);
    const badBody = await bad.json();
    assert.equal(badBody.error, 'Invalid credentials');

    const good = await fetch(`${demo.url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo123' }),
    });
    assert.equal(good.status, 200);
    const page = await fetch(`${demo.url}/`);
    const html = await page.text();
    assert.match(html, /data-testid="password"/);
    assert.match(html, /type="password"/);
  } finally {
    await demo.close();
  }
});
