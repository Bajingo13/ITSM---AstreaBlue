import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const port = Number(globalThis.process?.env?.PORT || 4173);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendFile(req, res, filePath) {
  const extension = extname(filePath).toLowerCase();
  const isHtml = extension === '.html';
  const isHashedAsset = req.url?.startsWith('/assets/');

  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream');
  res.setHeader(
    'Cache-Control',
    isHtml
      ? 'no-cache, no-store, must-revalidate'
      : isHashedAsset
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function safeFilePath(pathname) {
  const relativePath = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const filePath = resolve(join(root, relativePath));
  return filePath.startsWith(root) ? filePath : null;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const requestedFile = safeFilePath(pathname);
  if (requestedFile && existsSync(requestedFile) && statSync(requestedFile).isFile()) {
    sendFile(req, res, requestedFile);
    return;
  }

  // Missing build assets must be a real 404. Returning index.html here causes
  // browsers to reject JavaScript and CSS because their MIME type becomes HTML.
  if (pathname.startsWith('/assets/') || extname(pathname)) {
    res.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end('Asset not found');
    return;
  }

  // Client-side routes intentionally fall back to the SPA entry document.
  sendFile(req, res, join(root, 'index.html'));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`AstreaBlue frontend listening on port ${port}`);
});
