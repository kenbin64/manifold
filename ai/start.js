#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD AI — Bootstrap
 * One command: check Ollama → start server → print instructions
 * ═══════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const PROVIDER = process.env.MANIFOLD_PROVIDER || (GROQ_API_KEY ? 'groq' : 'ollama');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MANIFOLD_MODEL || (PROVIDER === 'groq' ? 'llama-3.3-70b-versatile' : 'deepseek-coder:6.7b');
const VPS_HOST = process.env.VPS_HOST || '100.70.142.122';
const VPS_USER = process.env.VPS_USER || 'butterfly';
const SSH_KEY = process.env.SSH_KEY || path.join(require('os').homedir(), '.ssh', 'id_ed25519');

// ─── Helpers ────────────────────────────────────────────────────────────
function checkOllama() {
  return new Promise((resolve) => {
    const url = new URL(OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: '/', method: 'GET',
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function checkModel() {
  return new Promise((resolve) => {
    const url = new URL(`${OLLAMA_URL}/api/tags`);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET',
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const models = (parsed.models || []).map(m => m.name);
          resolve({ has: models.some(m => m.startsWith(MODEL.split(':')[0])), models });
        } catch { resolve({ has: false, models: [] }); }
      });
    });
    req.on('error', () => resolve({ has: false, models: [] }));
    req.end();
  });
}

// ─── SSH Tunnel ──────────────────────────────────────────────
function startSSHTunnel() {
  return new Promise((resolve) => {
    console.log(`  → Opening SSH tunnel to ${VPS_USER}@${VPS_HOST}:11434 ...`);
    const tunnel = spawn('ssh', [
      '-o', 'PasswordAuthentication=no',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ExitOnForwardFailure=yes',
      '-i', SSH_KEY,
      '-N', '-L', '11434:localhost:11434',
      `${VPS_USER}@${VPS_HOST}`,
    ], { stdio: 'ignore' });

    tunnel.on('error', (err) => {
      console.log(`  ⚠ SSH tunnel failed: ${err.message}`);
      resolve(null);
    });

    // Give tunnel time to establish
    setTimeout(() => resolve(tunnel), 2500);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MANIFOLD AI — Bootstrap                                     ║
║  z = x · y                                                   ║
╚══════════════════════════════════════════════════════════════╝
`);

  // §1 — Check provider connection
  console.log(`§1 POINT — Provider: ${PROVIDER.toUpperCase()}`);

  if (PROVIDER === 'groq') {
    if (!GROQ_API_KEY) {
      console.error('✗ GROQ_API_KEY not set. Get one free at https://console.groq.com/keys');
      process.exit(1);
    }
    console.log(`  ✓ Groq API configured (model: ${MODEL})`);
    console.log('  → Cloud inference via Groq LPU — no local GPU needed');
  } else {
    console.log('  Checking Ollama connection...');
    let ollamaOk = await checkOllama();
    let tunnel = null;

    if (!ollamaOk) {
      console.log('  ⚠ No local Ollama — attempting VPS SSH tunnel...');
      tunnel = await startSSHTunnel();
      ollamaOk = await checkOllama();
    }

    if (!ollamaOk) {
      console.error(`
✗ Ollama not reachable at ${OLLAMA_URL}
  No local Ollama found, and VPS tunnel failed.

Options:
  A) Install Ollama locally:  https://ollama.com/download
  B) Ensure VPS is up:       ssh ${VPS_USER}@${VPS_HOST} "systemctl is-active ollama"
  C) Check SSH key:           ${SSH_KEY}
  D) Use Groq cloud:          GROQ_API_KEY=gsk_... node ai/start.js
`);
      process.exit(1);
    }
    console.log(`  ✓ Ollama connected${tunnel ? ' (via VPS SSH tunnel)' : ' (local)'}`);

    // §2 — Check model (Ollama only)
    console.log('§2 LINE — Checking model...');
    const { has, models } = await checkModel();
    if (!has) {
      console.log(`  ⚠ Model "${MODEL}" not found. Available: ${models.join(', ') || 'none'}`);
      console.log(`  Pulling ${MODEL}...`);
      const pull = spawn('ollama', ['pull', MODEL], { stdio: 'inherit' });
      await new Promise((resolve) => pull.on('close', resolve));
    } else {
      console.log(`  ✓ Model "${MODEL}" available`);
    }
  }

  // §3 — Start server
  console.log('§3 WIDTH — Starting Manifold AI server...\n');
  const server = spawn('node', [path.join(__dirname, 'server.js')], {
    stdio: 'inherit',
    env: { ...process.env, MANIFOLD_MODEL: MODEL, GROQ_API_KEY, MANIFOLD_PROVIDER: PROVIDER },
  });

  server.on('error', (err) => {
    console.error('Server failed to start:', err.message);
    process.exit(1);
  });

  // §4 — VS Code instructions
  setTimeout(() => {
    console.log(`
┌──────────────────────────────────────────────────────────────┐
│  VS Code — Continue.dev (Recommended)                        │
│                                                              │
│  1. Install Continue extension in VS Code:                   │
│     Ctrl+Shift+X → search "Continue" → Install               │
│     (Open source, Apache 2.0 — no account needed)            │
│                                                              │
│  2. Config already wired at .continue/config.json             │
│     → Points to Manifold AI at localhost:3377                │
│     → All requests flow through DNA + Memory + Learning      │
│     → Zero telemetry (allowAnonymousTelemetry: false)        │
│                                                              │
│  3. Open Continue sidebar (Ctrl+L) and start chatting         │
│                                                              │
│  Custom commands available:                                  │
│     /manifold-audit    — Audit code for manifold compliance  │
│     /manifold-refactor — Refactor to 100% manifold-native    │
│     /deploy            — Generate deployment steps            │
│                                                              │
│  OpenAI-compatible API (works with any client):              │
│     POST http://localhost:3377/v1/chat/completions           │
│     GET  http://localhost:3377/v1/models                      │
│                                                              │
│  Or use the built-in Manifold AI extension:                  │
│     cd ai/vscode-extension && npm install                    │
│                                                              │
│  No credits. No tollbooth. No monitoring. 100% private.       │
└──────────────────────────────────────────────────────────────┘
    `);
  }, 1500);
}

main().catch(console.error);

