import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const publicFiles = new Set(['index.html', 'styles.css', 'app.js', 'data.js', 'favicon.svg']);
const publicDirectories = new Set(['vendor', 'assets']);
const isPublicPath = (segments) => publicDirectories.has(segments[0]?.toLowerCase())
  || (segments.length === 1 && publicFiles.has(segments[0].toLowerCase()));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const segments = pathname.split(/[\\/]/).filter(Boolean);
    if (segments.some((part) => part.startsWith('.') || part.includes(':'))
      || (segments.length && !isPublicPath(segments))) {
      response.writeHead(404).end('Not found');
      return;
    }
    const target = path.resolve(root, segments.length ? segments.join(path.sep) : 'index.html');
    const resolved = await realpath(target);
    const relative = path.relative(root, resolved);
    const extension = path.extname(resolved).toLowerCase();
    if (relative.startsWith('..') || path.isAbsolute(relative)
      || !isPublicPath(relative.split(path.sep)) || !types[extension]
      || !(await stat(resolved)).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(resolved);
    response.writeHead(200, { 'Content-Type': types[extension], 'Content-Length': content.length });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Astana Explorer: http://127.0.0.1:${port}`);
});
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the previous server or set PORT.`
    : error.message);
  process.exitCode = 1;
});
