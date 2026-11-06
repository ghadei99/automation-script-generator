import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

async function handler(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/api/login') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (error) {
      send(response, 400, JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    if (body.username === 'demo' && body.password === 'demo123') {
      send(response, 200, JSON.stringify({ ok: true, name: 'Demo' }));
      return;
    }
    send(response, 401, JSON.stringify({ error: 'Invalid credentials' }));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/profile') {
    send(response, 200, JSON.stringify({ id: 1, name: 'Demo User' }));
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    send(response, 403, JSON.stringify({ error: 'Forbidden' }));
    return;
  }
  try {
    const file = await readFile(filePath);
    send(response, 200, file, types[path.extname(filePath)] || 'application/octet-stream');
  } catch (error) {
    send(response, 404, JSON.stringify({ error: 'Not found' }));
  }
}

export function startDemo(port = 0) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 4173);
  startDemo(port).then((demo) => {
    console.log(`Demo running at ${demo.url}`);
  });
}
