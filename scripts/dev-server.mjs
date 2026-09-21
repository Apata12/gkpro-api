import http from 'node:http';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const apiDir = fileURLToPath(new URL('../api/', import.meta.url));

// Discover every file in api/ and expose it as /api/<name> (without extension),
// mirroring how Vercel maps files under api/ to serverless routes.
async function loadRoutes() {
  const routes = new Map();
  const entries = await readdir(apiDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(js|mjs)$/.test(entry.name)) continue;
    const routeName = entry.name.replace(/\.(js|mjs)$/, '');
    const mod = await import(pathToFileURL(path.join(apiDir, entry.name)).href);
    const handler = mod.default;
    if (typeof handler === 'function') {
      routes.set(`/api/${routeName}`, handler);
    }
  }
  return routes;
}

// Minimal Vercel-compatible response wrapper: status().json()/send()/setHeader().
function createRes(nodeRes) {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      nodeRes.setHeader(key, value);
      return this;
    },
    json(payload) {
      const body = JSON.stringify(payload);
      nodeRes.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
      nodeRes.end(body);
      return this;
    },
    send(body) {
      nodeRes.writeHead(this.statusCode);
      nodeRes.end(typeof body === 'string' ? body : JSON.stringify(body));
      return this;
    },
    end(...args) {
      nodeRes.end(...args);
      return this;
    },
  };
}

function parseBody(nodeReq) {
  return new Promise((resolve) => {
    let raw = '';
    nodeReq.on('data', (chunk) => {
      raw += chunk;
    });
    nodeReq.on('end', () => {
      if (!raw) return resolve(undefined);
      const contentType = nodeReq.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          return resolve(JSON.parse(raw));
        } catch {
          return resolve(raw);
        }
      }
      resolve(raw);
    });
  });
}

const routes = await loadRoutes();

const server = http.createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url, `http://${nodeReq.headers.host}`);
  const handler = routes.get(url.pathname);

  if (!handler) {
    nodeRes.writeHead(404, { 'Content-Type': 'application/json' });
    nodeRes.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
    return;
  }

  const body = await parseBody(nodeReq);
  const req = {
    method: nodeReq.method,
    headers: nodeReq.headers,
    url: nodeReq.url,
    query: Object.fromEntries(url.searchParams),
    body,
  };
  const res = createRes(nodeRes);

  try {
    await handler(req, res);
  } catch (err) {
    if (!nodeRes.headersSent) {
      nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify({ error: err.message }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`gkpro-api dev server listening on http://localhost:${PORT}`);
  for (const route of routes.keys()) {
    console.log(`  route: ${route}`);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('  warning: OPENAI_API_KEY is not set; /api/chat will relay OpenAI auth errors.');
  }
});
