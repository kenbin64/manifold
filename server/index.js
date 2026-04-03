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
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { ManifoldSocket } = require('./manifold-socket');
const { AuthManifold } = require('./auth-manifold');

// ─── Configuration ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const SSL_PORT = parseInt(process.env.SSL_PORT || '3443', 10);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_ROOT = path.resolve(__dirname, '..', 'app', 'src', 'platform');
const CERT_PATH = process.env.CERT_PATH || '/etc/letsencrypt/live/kensgames.com/fullchain.pem';
const KEY_PATH = process.env.KEY_PATH || '/etc/letsencrypt/live/kensgames.com/privkey.pem';

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

// Create HTTP server (redirect to HTTPS)
const httpServer = http.createServer((req, res) => {
  if (req.headers.host) {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  } else {
    res.writeHead(400);
    res.end('Bad Request');
  }
});

// Create HTTPS server
let httpsServer;
try {
  const sslOptions = {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH),
  };
  httpsServer = https.createServer(sslOptions, serveStatic);
} catch (err) {
  console.error('SSL certificates not found, running HTTP only:', err.message);
  httpsServer = null;
}

// WebSocket servers
const wssHttp = new WebSocketServer({ server: httpServer });
const wssHttps = httpsServer ? new WebSocketServer({ server: httpsServer }) : null;

// Wire WebSocket connections
wssHttp.on('connection', (ws, req) => {
  ManifoldSocket.onConnection(ws);
});

if (wssHttps) {
  wssHttps.on('connection', (ws, req) => {
    ManifoldSocket.onConnection(ws);
  });
}

// Periodic cleanup: purge stale auth tokens (delta cache maintenance)
setInterval(() => {
  AuthManifold.purge();
}, 60 * 60 * 1000); // Every hour

// Start servers
httpServer.listen(PORT, HOST, () => {
  console.log(`HTTP redirect server listening on http://${HOST}:${PORT}`);
});

if (httpsServer) {
  httpsServer.listen(SSL_PORT, HOST, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║              KENSGAMES MANIFOLD SERVER                              ║
║  ─────────────────────────────────────────────────────────────────   ║
║  Gyroid Topology: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0  ║
║  Two Labyrinths: A (Encode) | B (Decode) | Surface (Delta Cache)   ║
║  ─────────────────────────────────────────────────────────────────   ║
║  HTTPS: https://${HOST}:${SSL_PORT}                                 ║
║  WSS:   wss://${HOST}:${SSL_PORT}                                   ║
║  HTTP Redirect: http://${HOST}:${PORT} → HTTPS                     ║
║  Static: ${STATIC_ROOT}                                             ║
║  ─────────────────────────────────────────────────────────────────   ║
║  Minimum material. Maximum strength. Maximum surface area.          ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);
  });
} else {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║              KENSGAMES MANIFOLD SERVER (HTTP ONLY)                  ║
║  ─────────────────────────────────────────────────────────────────   ║
║  Gyroid Topology: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0  ║
║  Two Labyrinths: A (Encode) | B (Decode) | Surface (Delta Cache)   ║
║  ─────────────────────────────────────────────────────────────────   ║
║  HTTP:  http://${HOST}:${PORT}                                      ║
║  WS:    ws://${HOST}:${PORT}                                        ║
║  Static: ${STATIC_ROOT}                                             ║
║  ─────────────────────────────────────────────────────────────────   ║
║  SSL certificates not found. Install certs for HTTPS.               ║
╚═══════════════════════════════════════════════════════════════════════╝
  `);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  httpServer.close();
  if (httpsServer) httpsServer.close();
  process.exit(0);
});
process.on('SIGINT', () => {
  httpServer.close();
  if (httpsServer) httpsServer.close();
  process.exit(0);
});

