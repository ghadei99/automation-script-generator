import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validatePlan } = require('../lib/schema.js');

const token = process.env.PROXY_AUTH_TOKEN || '';
const providerKey = process.env.AI_API_KEY || '';
const provider = process.env.AI_PROVIDER || 'openai';
const model = process.env.AI_MODEL || 'gpt-4.1-mini';

if (!token || !providerKey) {
  console.error('Refusing to start. Set PROXY_AUTH_TOKEN and AI_API_KEY. This proxy is not deployed by the extension.');
  process.exit(1);
}

function providerUrl() {
  const configured = process.env.AI_BASE_URL || '';
  if (!configured) return 'https://api.openai.com/v1/chat/completions';
  let parsed;
  try {
    parsed = new URL(configured);
  } catch (error) {
    console.error('AI_BASE_URL is not a URL. This proxy is not deployed by the extension.');
    process.exit(1);
  }
  const local = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !local) {
    console.error('AI_BASE_URL must be https, or http://127.0.0.1 for a local stub. This proxy is not deployed by the extension.');
    process.exit(1);
  }
  return configured;
}

const endpoint = providerUrl();
const hits = new Map();

function limited(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 10) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function publicError(text) {
  return String(text || 'Request failed').replaceAll(providerKey, '[redacted]').slice(0, 300);
}

function redactEvidence(items) {
  const allowed = ['tag', 'type', 'testid', 'id', 'name', 'role', 'label', 'text', 'hidden'];
  return items.slice(0, 60).map((item) => {
    if (!item || typeof item !== 'object') return {};
    const out = {};
    for (const key of allowed) {
      if (item[key] == null) continue;
      out[key] = key === 'hidden' ? !!item[key] : String(item[key]).slice(0, 80);
    }
    return out;
  });
}

function send(response, status, body) {
  if (response.headersSent) return;
  const encoded = JSON.stringify(body).replaceAll(providerKey, '[redacted]');
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(encoded);
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    send(response, 500, { error: 'Proxy failed' });
  });
});

async function handle(request, response) {
  const remote = request.socket.remoteAddress || '';
  if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1' && remote !== '::1') {
    send(response, 403, { error: 'Localhost only' });
    return;
  }
  if (request.method !== 'POST') {
    send(response, 405, { error: 'Method not allowed' });
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    send(response, 401, { error: 'Unauthorized' });
    return;
  }
  if (limited(request.headers.authorization)) {
    send(response, 429, { error: 'Rate limit exceeded' });
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100_000) {
      for await (const extra of request) {
        size += extra.length;
        if (size > 1_000_000) break;
      }
      send(response, 413, { error: 'Request is too large' });
      return;
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (error) {
    send(response, 400, { error: 'Request body must be JSON' });
    return;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    send(response, 400, { error: 'Request body must be a JSON object' });
    return;
  }
  const prompt = String(body.prompt || '').slice(0, 2000);
  if (!prompt) {
    send(response, 400, { error: 'Prompt is required' });
    return;
  }
  const pageEvidence = redactEvidence(Array.isArray(body.pageEvidence) ? body.pageEvidence : []);
  let providerResponse;
  try {
    providerResponse = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${providerKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Return a JSON test plan with title, summary, and cases. Each case has name and steps. Allowed step types: navigate, click, input, checkbox, radio, select, submit, wait, assertVisible, assertText, assertUrl, assertExists. Use a selector only when its value appears in pageEvidence. If it does not, omit the selector. Do not return JavaScript, HTML, or cookies.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              prompt,
              targetOrigin: String(body.targetOrigin || '').slice(0, 200),
              pageEvidence,
            }),
          },
        ],
      }),
    });
  } catch (error) {
    send(response, 502, { error: 'Provider request failed' });
    return;
  }
  if (!providerResponse.ok) {
    send(response, 502, { error: `Provider returned ${providerResponse.status}` });
    return;
  }
  let payload;
  try {
    payload = await providerResponse.json();
  } catch (error) {
    send(response, 502, { error: 'Provider did not return JSON' });
    return;
  }
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    send(response, 502, { error: 'Provider did not return a JSON plan' });
    return;
  }
  let safe;
  try {
    safe = validatePlan({ ...plan, source: 'live' });
  } catch (error) {
    send(response, 502, { error: publicError(`Provider plan was rejected: ${error.message}`) });
    return;
  }
  send(response, 200, { ...safe, provider });
}

server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => {
  const address = server.address();
  console.log(`AI proxy listening on 127.0.0.1:${address.port}`);
});
