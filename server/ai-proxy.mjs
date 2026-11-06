import { createServer } from 'node:http';

const token = process.env.PROXY_AUTH_TOKEN || '';
const providerKey = process.env.AI_API_KEY || '';
const provider = process.env.AI_PROVIDER || 'openai';
const model = process.env.AI_MODEL || 'gpt-4.1-mini';

if (!token || !providerKey) {
  console.error('Refusing to start. Set PROXY_AUTH_TOKEN and AI_API_KEY. This proxy is not deployed by the extension.');
  process.exit(1);
}

const hits = new Map();
function limited(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > 10;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405);
    response.end('Method not allowed');
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (limited(request.headers.authorization)) {
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Rate limit exceeded' }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const prompt = String(body.prompt || '').slice(0, 2000);
  const pageEvidence = Array.isArray(body.pageEvidence) ? body.pageEvidence.slice(0, 60) : [];
  if (!prompt) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Prompt is required' }));
    return;
  }
  const providerResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
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
  if (!providerResponse.ok) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `Provider returned ${providerResponse.status}` }));
    return;
  }
  const payload = await providerResponse.json();
  const text = payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Provider did not return JSON' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ...plan, source: 'live', provider }));
});

server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => {
  console.log(`AI proxy listening on 127.0.0.1:${process.env.PORT || 8787}`);
});
