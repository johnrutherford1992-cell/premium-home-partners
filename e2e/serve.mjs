#!/usr/bin/env node
// Tiny static server for the exported web app, with SPA fallback:
//   node e2e/serve.mjs [dir=apps/mobile/dist] [port=8105]
// Paths without a file extension (app routes such as /homeowner/home) get
// index.html; a missing asset (a path with an extension) is a real 404, so a
// broken build fails loudly instead of loading HTML as JavaScript.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || 'apps/mobile/dist');
const port = Number(process.argv[3] || process.env.E2E_PORT || 8105);
const index = join(root, 'index.html');

if (!existsSync(index)) {
  console.error(
    `e2e/serve.mjs: ${index} not found.\n` +
      'Build the web app first (cd apps/mobile && npx expo export --platform web), or set E2E_BASE_URL to test a running app.',
  );
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function send(res, status, file) {
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(status, {
    'content-type': type,
    // Hashed bundles can be cached; the HTML shell must always be fresh.
    'cache-control': file === index ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = resolve(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isFile()) {
    send(res, 200, file);
    return;
  }
  if (extname(pathname)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`Not found: ${pathname}`);
    return;
  }
  send(res, 200, index);
}).listen(port, () => {
  console.log(`e2e/serve.mjs: serving ${root} on http://localhost:${port}`);
});
