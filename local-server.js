const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 4180;
const ROOT = __dirname;

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) return;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) return;
    process.env[key] = (rawValue || '').trim().replace(/^['"]|['"]$/g, '');
  });
}
loadDotEnv();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0'
  });
  res.end(JSON.stringify(payload));
}

function createVercelResponse(res) {
  return {
    setHeader(name, value) {
      res.setHeader(name, value);
    },
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    json(payload) {
      if (!res.hasHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
    }
  };
}

async function handleApi(req, res, apiName) {
  const apiFile = path.join(ROOT, 'api', `${apiName}.js`);
  if (!fs.existsSync(apiFile)) {
    sendJson(res, 404, { error: `No API route for /api/${apiName}` });
    return;
  }
  try {
    Object.keys(require.cache)
      .filter((key) => key.startsWith(ROOT))
      .forEach((key) => { delete require.cache[key]; });
    const handler = require(apiFile);
    await handler(req, createVercelResponse(res));
  } catch (error) {
    sendJson(res, 502, {
      error: `The /api/${apiName} endpoint failed.`,
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function staticPathFor(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const requested = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.normalize(path.join(ROOT, requested));
  return resolved.startsWith(ROOT) ? resolved : null;
}

function serveStatic(req, res, urlPathname) {
  const filePath = staticPathFor(urlPathname);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-store, max-age=0'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url.pathname.slice('/api/'.length));
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Smart Bus Stop demo running at http://127.0.0.1:${PORT}`);
  console.log('Local API relay enabled for every file under api/ (SEPTA arrivals, kindness-act, ...)');
  if (!process.env.LLM_API_KEY) {
    console.log('No LLM_API_KEY found in .env — the Kindness Tree flow will use the local fallback bank.');
  }
});
