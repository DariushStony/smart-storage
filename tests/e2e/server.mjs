// Minimal static file server for the e2e harness.
//
// Playwright needs a real http:// origin because Web Storage is origin-scoped
// (and unavailable on file:// in some browsers). This serves the repo root so
// the harness page can import the built bundle from /dist/index.js.
//
// Deliberately dependency-free: node:http only, no dev-server package.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const ROOT = resolve(import.meta.dirname, '..', '..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const requestPath = new URL(request.url, `http://localhost:${PORT}`).pathname;

  // Resolve inside ROOT only. Without this, `GET /../../etc/passwd` would
  // escape the served directory.
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ROOT, safePath);

  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'text/plain',
      // Never let a stale bundle satisfy a test run.
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(PORT, () => {
  process.stdout.write(`e2e server listening on http://localhost:${PORT}\n`);
});
