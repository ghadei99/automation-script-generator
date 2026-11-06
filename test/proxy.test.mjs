import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';

const token = 'unit-token';
const providerKey = 'unit-test-key';

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function startProxy(overrides) {
  let output = '';
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const child = spawn(process.execPath, ['server/ai-proxy.mjs'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => settle.reject(new Error(`proxy did not listen\n${output}`)), 5000);
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
    settle.reject(new Error(`proxy exited ${code}\n${output}`));
  });
  return { child, ready, output: () => output };
}

test('the proxy rejects a non-local provider URL before listening', async () => {
  const proxy = startProxy({
    PROXY_AUTH_TOKEN: token,
    AI_API_KEY: providerKey,
    AI_BASE_URL: 'http://example.com/v1/chat/completions',
  });
  await assert.rejects(proxy.ready, /AI_BASE_URL must be https/);
  assert.equal(proxy.output().includes(providerKey), false);
});

test('the proxy checks auth, redacts evidence, validates the plan, and rate limits', async () => {
  const seen = [];
  const stub = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    seen.push({ authorization: request.headers.authorization || '', body: raw });
    const incoming = JSON.parse(raw);
    const prompt = incoming.messages[1].content;
    const plan = String(prompt).includes('bad-plan')
      ? {
        title: 'Bad',
        cases: [{ name: 'Run', steps: [{ type: 'navigate', url: 'https://example.com', script: 'alert(1)' }] }],
      }
      : {
        title: 'Example',
        summary: 'Navigate',
        cases: [{ name: 'Open', steps: [{ type: 'navigate', url: 'https://example.com' }] }],
      };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  const stubPort = stub.address().port;
  const proxy = startProxy({
    PROXY_AUTH_TOKEN: token,
    AI_API_KEY: providerKey,
    AI_BASE_URL: `http://127.0.0.1:${stubPort}/v1/chat/completions`,
    PORT: '0',
  });
  try {
    const port = await proxy.ready;
    const post = (payload, authorization = `Bearer ${token}`) => new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const request = http.request({
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(authorization ? { authorization } : {}),
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(text); } catch (error) { parsed = { raw: text }; }
          resolve({ status: response.statusCode, body: parsed, text });
        });
      });
      request.on('error', reject);
      request.end(body);
    });

    assert.equal((await post({ prompt: 'nope' }, 'Bearer wrong')).status, 401);
    const empty = await post({ prompt: '' });
    assert.equal(empty.status, 400);
    const huge = await post({ prompt: 'x'.repeat(120_000) });
    assert.equal(huge.status, 413);
    const evidence = await post({
      prompt: 'Check the form',
      pageEvidence: [{ tag: 'input', type: 'password', text: 'Sign in', password: 'demo123', value: 'demo123' }],
    });
    assert.equal(evidence.status, 200);
    assert.equal(evidence.body.source, 'live');
    assert.equal(evidence.body.cases[0].steps[0].type, 'navigate');
    assert.equal(evidence.text.includes(providerKey), false);
    assert.equal(evidence.text.includes('demo123'), false);
    const forwarded = seen.at(-1);
    assert.equal(forwarded.authorization, `Bearer ${providerKey}`);
    assert.equal(forwarded.body.includes(token), false);
    assert.equal(forwarded.body.includes('demo123'), false);
    assert.match(forwarded.body, /Sign in/);
    const rejected = await post({ prompt: 'bad-plan' });
    assert.equal(rejected.status, 502);
    assert.match(rejected.body.error, /executable field/);
    assert.equal(rejected.text.includes('alert(1)'), false);
    assert.equal(rejected.text.includes(providerKey), false);

    let used = 4;
    let limited = false;
    for (let index = 0; index < 10; index += 1) {
      const result = await post({ prompt: 'again' });
      if (result.status === 429) {
        limited = true;
        break;
      }
      used += 1;
    }
    assert.equal(limited, true);
    assert.equal(used, 10);
    assert.equal(proxy.output().includes(providerKey), false);
    assert.equal(proxy.output().includes('demo123'), false);
  } finally {
    proxy.child.kill();
    await new Promise((resolve) => stub.close(resolve));
  }
});
