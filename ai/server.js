/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD AI — Local Server
 * z = x · y — HTTP + WebSocket Streaming
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Labyrinth A (Encode): HTTP requests + WebSocket messages → ManifoldAI
 * Labyrinth B (Decode): ManifoldAI responses → HTTP/WS stream to client
 *
 * Endpoints:
 *   POST /chat          — Non-streaming chat
 *   POST /chat/stream   — SSE streaming chat
 *   GET  /files         — List codebase files
 *   GET  /file?path=... — Read file content
 *   POST /file          — Write file content
 *   GET  /models        — List available Ollama models
 *   GET  /status        — Connection + model status
 *
 * WebSocket:
 *   ws://localhost:3377  — Streaming chat (send JSON, receive chunks)
 *
 * No credits. No tollbooth. No limits.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { ManifoldAI, ToolSubstrate } = require('./manifold-ai');

const PORT = process.env.MANIFOLD_AI_PORT || 3377;
const WORKSPACE = process.env.MANIFOLD_WORKSPACE || path.resolve(__dirname, '..');
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
// Ollama is ALWAYS primary — the manifold runs in-house.
// Groq is only used if explicitly forced via MANIFOLD_PROVIDER=groq.
const PROVIDER = process.env.MANIFOLD_PROVIDER || 'ollama';

// ─── Initialize Engine ──────────────────────────────────────────────────
const ai = new ManifoldAI({
  workspaceRoot: WORKSPACE,
  provider: PROVIDER,
  // In-house model selection: deepseek-coder:6.7b for VPS (CPU-only), qwen2.5-coder:7b for GPU
  model: process.env.MANIFOLD_MODEL || (PROVIDER === 'ollama' ? 'deepseek-coder:6.7b' : 'llama-3.3-70b-versatile'),
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  groqApiKey: GROQ_API_KEY,
});

// ─── Manifold Handshake Protocol ────────────────────────────────────────
// Two-labyrinth mutual authentication via Gyroid surface evaluation.
// The shared secret is: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x)
// evaluated at a challenge point, then HMAC'd with the manifold identity key.
//
// The identity key is derived from the Gyroid equation itself — it IS the manifold.
const MANIFOLD_IDENTITY = crypto.createHash('sha256')
  .update('sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0:butterfly-platform')
  .digest('hex');

// Node identity (unique per instance)
const NODE_ID = crypto.randomBytes(8).toString('hex');
let peerNodeId = null;      // filled after handshake
let handshakeComplete = false;

/** Evaluate Gyroid implicit surface at (x, y, z) */
function gyroid(x, y, z) {
  return Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
}

/** HMAC-SHA256 using manifold identity key */
function hmacSign(data) {
  return crypto.createHmac('sha256', MANIFOLD_IDENTITY).update(data).digest('hex');
}

/** Generate a challenge: random point + expected response */
function generateChallenge() {
  const x = Math.random() * 2 * Math.PI;
  const y = Math.random() * 2 * Math.PI;
  const z = Math.random() * 2 * Math.PI;
  const value = gyroid(x, y, z);
  const proof = hmacSign(`${x}:${y}:${z}:${value}`);
  return { x, y, z, proof };
}

/** Verify a challenge response */
function verifyResponse(x, y, z, responseProof) {
  const value = gyroid(x, y, z);
  const expected = hmacSign(`${x}:${y}:${z}:${value}`);
  return expected === responseProof;
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj); // transport boundary
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

// ─── HTTP Server ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ═══ GET /status ═══
    if (req.method === 'GET' && url.pathname === '/status') {
      const conn = await ai.checkConnection();
      const models = conn.ok ? await ai.listModels() : [];
      return json(res, 200, {
        manifold: true,
        provider: ai.provider,
        connected: conn.ok,
        model: ai.model,
        models: models.map(m => m.name),
        workspace: WORKSPACE,
        nodeId: NODE_ID,
        handshake: handshakeComplete,
        peer: peerNodeId,
      });
    }

    // ═══ POST /handshake/challenge ═══
    // Step 1: Initiator sends this to get a challenge from the peer
    if (req.method === 'POST' && url.pathname === '/handshake/challenge') {
      const body = JSON.parse(await readBody(req));
      const initiatorNodeId = body.nodeId;
      // Generate our challenge for the initiator to solve
      const challenge = generateChallenge();
      // Also solve the initiator's challenge if they sent one
      let responseProof = null;
      if (body.challenge) {
        const { x, y, z } = body.challenge;
        const value = gyroid(x, y, z);
        responseProof = hmacSign(`${x}:${y}:${z}:${value}`);
      }
      return json(res, 200, {
        nodeId: NODE_ID,
        challenge: { x: challenge.x, y: challenge.y, z: challenge.z },
        responseProof,
      });
    }

    // ═══ POST /handshake/verify ═══
    // Step 2: Initiator sends proof, peer verifies and completes handshake
    if (req.method === 'POST' && url.pathname === '/handshake/verify') {
      const body = JSON.parse(await readBody(req));
      const { nodeId: remoteId, proof, challenge: theirChallenge } = body;
      // Verify the initiator solved our challenge
      if (theirChallenge && proof) {
        const valid = verifyResponse(theirChallenge.x, theirChallenge.y, theirChallenge.z, proof);
        if (valid) {
          peerNodeId = remoteId;
          handshakeComplete = true;
          // Solve their new challenge as final confirmation
          let finalProof = null;
          if (body.finalChallenge) {
            const { x, y, z } = body.finalChallenge;
            const value = gyroid(x, y, z);
            finalProof = hmacSign(`${x}:${y}:${z}:${value}`);
          }
          console.log(`✓ Handshake complete with peer: ${peerNodeId}`);
          return json(res, 200, {
            verified: true,
            nodeId: NODE_ID,
            peer: peerNodeId,
            finalProof,
          });
        }
      }
      return json(res, 403, { verified: false, error: 'Invalid manifold proof' });
    }

    // ═══ POST /handshake/sync ═══
    // After handshake: sync memories between peers
    if (req.method === 'POST' && url.pathname === '/handshake/sync') {
      if (!handshakeComplete) {
        return json(res, 403, { error: 'Handshake required before sync' });
      }
      const body = JSON.parse(await readBody(req));
      // Receive peer's memories and merge (dedup by timestamp)
      if (body.memories && Array.isArray(body.memories)) {
        const existingTs = new Set(ai._memory.map(m => m.ts));
        let added = 0;
        for (const mem of body.memories) {
          if (!existingTs.has(mem.ts)) {
            ai._saveMemoryEntry(mem);
            added++;
          }
        }
        console.log(`⟳ Synced ${added} new memories from peer`);
      }
      // Return our memories for the peer
      return json(res, 200, {
        memories: ai._memory,
        memoryCount: ai._memory.length,
      });
    }

    // ═══ GET /models ═══
    if (req.method === 'GET' && url.pathname === '/models') {
      const models = await ai.listModels();
      return json(res, 200, { models: models.map(m => m.name) });
    }

    // ═══ GET /files ═══
    if (req.method === 'GET' && url.pathname === '/files') {
      const files = ai.files.indexCodebase();
      return json(res, 200, { files, count: files.length });
    }

    // ═══ GET /file?path=... ═══
    if (req.method === 'GET' && url.pathname === '/file') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return json(res, 400, { error: 'path required' });
      const content = ai.files.encodeFile(filePath);
      if (content === null) return json(res, 404, { error: 'file not found' });
      return json(res, 200, { path: filePath, content });
    }

    // ═══ POST /file ═══
    if (req.method === 'POST' && url.pathname === '/file') {
      const body = JSON.parse(await readBody(req)); // transport boundary
      if (!body.path || body.content === undefined) {
        return json(res, 400, { error: 'path and content required' });
      }
      const abs = ai.files.decodeToFile(body.path, body.content);
      return json(res, 200, { written: body.path, abs });
    }

    // ═══ POST /chat ═══
    if (req.method === 'POST' && url.pathname === '/chat') {
      const body = JSON.parse(await readBody(req)); // transport boundary
      const response = await ai.decode(body.message || body.content || '');
      return json(res, 200, { response });
    }

    // ═══ POST /chat/stream (SSE) ═══
    if (req.method === 'POST' && url.pathname === '/chat/stream') {
      const body = JSON.parse(await readBody(req)); // transport boundary
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      await ai.decodeStream(body.message || body.content || '', (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`); // transport
      });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // ═══ POST /model ═══
    if (req.method === 'POST' && url.pathname === '/model') {
      const body = JSON.parse(await readBody(req));
      if (body.model) ai.model = body.model;
      return json(res, 200, { model: ai.model });
    }

    // ═══════════════════════════════════════════════════════════════════
    // OpenAI-Compatible API — /v1/*
    // Continue.dev, Open WebUI, and any OpenAI-compatible client connects here.
    // Every request flows through the manifold engine: DNA + Memory + Thinking + Learning.
    // The client sees standard OpenAI protocol. The manifold does the real work.
    // ═══════════════════════════════════════════════════════════════════

    // ═══ GET /v1/tools ═══
    if (req.method === 'GET' && url.pathname === '/v1/tools') {
      return json(res, 200, { tools: ToolSubstrate.registry() });
    }

    // ═══ POST /tool ═══ (direct tool invocation — no LLM needed)
    if (req.method === 'POST' && url.pathname === '/tool') {
      const body = JSON.parse(await readBody(req));
      const result = await ai.tools.execute(body.tool, body.args || {});
      return json(res, 200, { tool: body.tool, result });
    }

    // ═══ GET /v1/models ═══
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const models = await ai.listModels();
      return json(res, 200, {
        object: 'list',
        data: models.map(m => ({
          id: m.name || m,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'manifold-local',
        })),
      });
    }

    // ═══ POST /v1/chat/completions ═══
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = JSON.parse(await readBody(req)); // transport boundary
      const stream = body.stream === true;

      // Switch model if client requests a different one
      if (body.model && body.model !== ai.model) {
        ai.model = body.model;
      }

      // Extract the user message from OpenAI message format
      // Continue.dev sends full message history — we extract the last user msg
      // and let the manifold engine handle context assembly (DNA + memory + thinking)
      const messages = body.messages || [];
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      const userContent = lastUserMsg?.content || '';

      const requestId = `chatcmpl-${Date.now()}`;

      if (stream) {
        // ─── SSE Streaming (OpenAI format) ───────────────────────────
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });

        await ai.decodeStream(userContent, (chunk) => {
          const payload = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: ai.model,
            choices: [{
              index: 0,
              delta: { content: chunk },
              finish_reason: null,
            }],
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        });

        // Send final chunk with finish_reason
        const donePayload = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: ai.model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
          }],
        };
        res.write(`data: ${JSON.stringify(donePayload)}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      } else {
        // ─── Non-streaming ───────────────────────────────────────────
        const response = await ai.decode(userContent);
        return json(res, 200, {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: ai.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: response },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        });
      }
    }

    // ═══ 404 ═══
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// ─── WebSocket Server ───────────────────────────────────────────────────
let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.log('⚠  ws module not found — WebSocket disabled. Run: npm install');
}

if (WebSocket) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('⚡ WebSocket client connected');

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()); // transport boundary

        if (msg.type === 'chat') {
          // Stream response back chunk by chunk
          await ai.decodeStream(msg.message || '', (chunk) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'chunk', content: chunk }));
            }
          });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'done' }));
          }
        }

        if (msg.type === 'read') {
          const content = ai.files.encodeFile(msg.path);
          ws.send(JSON.stringify({ type: 'file', path: msg.path, content }));
        }

        if (msg.type === 'write') {
          ai.files.decodeToFile(msg.path, msg.content);
          ws.send(JSON.stringify({ type: 'written', path: msg.path }));
        }

        if (msg.type === 'model') {
          if (msg.model) ai.model = msg.model;
          ws.send(JSON.stringify({ type: 'model', model: ai.model }));
        }
      } catch (err) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      }
    });

    ws.on('close', () => console.log('⚡ WebSocket client disconnected'));
  });
}

// ─── Start ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MANIFOLD AI — z = x · y                                    ║
║  HTTP:  http://localhost:${PORT}                               ║
║  WS:    ws://localhost:${PORT}                                 ║
║  Provider: ${ai.provider.padEnd(44)}║
║  Model: ${ai.model.padEnd(47)}║
║  Root:  ${WORKSPACE.slice(0, 47).padEnd(47)}║
╚══════════════════════════════════════════════════════════════╝
  `);
});
