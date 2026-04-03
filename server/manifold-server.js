#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD SERVER — Unified Gateway
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Entry point for /home/manifold.
 *
 * Loads the compiled manifold artifact and mounts substrate adapters.
 * - HTTP substrate: REST/CRUD interface
 * - WebSocket substrate: Real-time sync
 * - File substrate: Persistence
 *
 * All data flows through ONE manifold instance.
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const SSL_PORT = parseInt(process.env.SSL_PORT || '3443', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MANIFOLD_DIR = process.env.MANIFOLD_DIR || __dirname;
const MANIFOLD_ARTIFACT = path.join(MANIFOLD_DIR, 'core', 'game-manifold.json');
const CERT_PATH = process.env.CERT_PATH || '/etc/letsencrypt/live/kensgames.com/fullchain.pem';
const KEY_PATH = process.env.KEY_PATH || '/etc/letsencrypt/live/kensgames.com/privkey.pem';

// ─── Load Manifold Artifact ──────────────────────────────────────────
class ManifoldGateway {
  constructor(artifactPath) {
    try {
      const data = fs.readFileSync(artifactPath, 'utf-8');
      this.artifact = JSON.parse(data);
      this.version = this.artifact.versionId;
      this.coordinates = this.artifact.coordinates;
      this.ready = true;
    } catch (err) {
      console.error('✗ Failed to load manifold artifact:', err.message);
      this.ready = false;
      this.artifact = null;
    }
  }

  // Drill to a coordinate in the manifold
  drill(...path) {
    if (!this.ready) return null;
    let current = this.coordinates;
    for (const coord of path) {
      if (current && typeof current === 'object') {
        current = current[coord];
      } else {
        return null;
      }
    }
    return current;
  }

  // Get entire manifold state
  getState() {
    if (!this.ready) return { error: 'Manifold not loaded' };
    return {
      version: this.version,
      dimensions: this.artifact.dimensions,
      topology: this.artifact.topology,
      state: this.coordinates,
    };
  }

  // Get manifold metadata
  getMetadata() {
    if (!this.ready) return { error: 'Manifold not loaded' };
    return {
      version: this.artifact.version,
      versionId: this.artifact.versionId,
      dimensions: this.artifact.dimensions_count,
      topology: this.artifact.topology,
      checksum: this.artifact.checksum,
      compiledAt: this.artifact.compiledAt,
    };
  }
}

// ─── HTTP Handler ─────────────────────────────────────────────────────
function handleHTTP(req, res, gateway) {
  // Only GET/HEAD for now
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = decodeURIComponent(req.url.split('?')[0]);

  // Meta endpoints
  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      server: 'ManifoldGateway',
      manifold: gateway.getMetadata(),
      endpoints: ['/api/state', '/api/meta', '/api/room/*'],
    }));
    return;
  }

  if (url === '/api/meta') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(gateway.getMetadata()));
    return;
  }

  if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(gateway.getState()));
    return;
  }

  // Game endpoints (drill into manifold)
  if (url.startsWith('/api/game/')) {
    const path = url.slice('/api/game/'.length).split('/');
    const data = gateway.drill('game', ...path);
    if (data === null) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ─── Startup ──────────────────────────────────────────────────────────
async function startup() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║              MANIFOLD GATEWAY — Dimensional Server                  ║
║  ─────────────────────────────────────────────────────────────────   ║
║  Loading: ${MANIFOLD_ARTIFACT}
║  ─────────────────────────────────────────────────────────────────   ║
║  All data flows through ONE manifold instance                       ║
║  HTTP/WS/File are substrate adapters (read-only observations)       ║
╚═══════════════════════════════════════════════════════════════════════╝
  `);

  // Load manifold
  const gateway = new ManifoldGateway(MANIFOLD_ARTIFACT);
  if (!gateway.ready) {
    console.error('✗ Failed to start: manifold artifact not loaded');
    process.exit(1);
  }

  console.log(`✓ Manifold loaded: v${gateway.version}`);
  console.log(`✓ Dimensions: ${gateway.artifact.dimensions_count}`);
  console.log(`✓ Topology: ${gateway.artifact.topology}`);

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
    httpsServer = https.createServer(sslOptions, (req, res) => handleHTTP(req, res, gateway));
    console.log(`✓ SSL certificates loaded`);
  } catch (err) {
    console.error('✗ SSL certificates not found, running HTTP only:', err.message);
    httpsServer = null;
  }

  // WebSocket support (future)
  if (httpsServer) {
    const wss = new WebSocketServer({ server: httpsServer });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'manifold_update',
        version: gateway.version,
        status: 'connected',
      }));
    });
  }

  // Start servers
  httpServer.listen(PORT, HOST, () => {
    console.log(`✓ HTTP redirect: http://${HOST}:${PORT}`);
  });

  if (httpsServer) {
    httpsServer.listen(SSL_PORT, HOST, () => {
      console.log(`✓ HTTPS server: https://${HOST}:${SSL_PORT}`);
      console.log(`✓ WebSocket: wss://${HOST}:${SSL_PORT}`);
      console.log(`\n✓ Manifold gateway live at https://kensgames.com\n`);
    });
  }

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('✓ Shutting down...');
    httpServer.close();
    if (httpsServer) httpsServer.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('✓ Shutting down...');
    httpServer.close();
    if (httpsServer) httpsServer.close();
    process.exit(0);
  });
}

startup().catch(err => {
  console.error('✗ Startup failed:', err);
  process.exit(1);
});
