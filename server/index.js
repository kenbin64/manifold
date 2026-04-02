/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KENSGAMES MANIFOLD SERVER — Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HTTP static file server + WebSocket upgrade handler.
 * Serves app/src/platform/ as the client root.
 * WebSocket connections route through ManifoldSocket (two-labyrinth core).
 *
 * Minimum material. Maximum strength. Maximum surface area.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { ManifoldSocket } = require('./manifold-socket');
const { AuthManifold } = require('./auth-manifold');

// ─── Configuration ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_ROOT = path.resolve(__dirname, '..', 'app', 'src', 'platform');

// ─── MIME Types (minimal set — no bloat) ────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.webp': 'image/webp',
};

// ─── Static File Server ─────────────────────────────────────────────────

function serveStatic(req, res) {
  // Only GET/HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }

  // API endpoint: server stats
  if (req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ManifoldSocket.stats));
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/kensgames.html';

  // Prevent path traversal
  const filePath = path.join(STATIC_ROOT, urlPath);
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403); res.end(); return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500); res.end();
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(data);
  });
}

// ─── Server Bootstrap ───────────────────────────────────────────────────

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

// Wire WebSocket connections into ManifoldSocket (Labyrinth A entry)
wss.on('connection', (ws, req) => {
  ManifoldSocket.onConnection(ws);
});

// Periodic cleanup: purge stale auth tokens (delta cache maintenance)
setInterval(() => {
  AuthManifold.purge();
}, 60 * 60 * 1000); // Every hour

// Start
server.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║              KENSGAMES MANIFOLD SERVER                              ║
║  ─────────────────────────────────────────────────────────────────   ║
║  Gyroid Topology: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0  ║
║  Two Labyrinths: A (Encode) | B (Decode) | Surface (Delta Cache)   ║
║  ─────────────────────────────────────────────────────────────────   ║
║  HTTP:  http://${HOST}:${PORT}                                      ║
║  WS:    ws://${HOST}:${PORT}                                        ║
║  Static: ${STATIC_ROOT}
║  ─────────────────────────────────────────────────────────────────   ║
║  Minimum material. Maximum strength. Maximum surface area.          ║
╚═══════════════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });

