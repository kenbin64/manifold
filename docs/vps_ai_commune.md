# Directive: VPS AI Communion Protocol

> **z = x · y** — Two nodes on the same Gyroid surface.
> The local AI and the VPS AI are two labyrinths of one manifold.

---

## 1. VPS Connection

| Parameter      | Value                                                  |
|----------------|--------------------------------------------------------|
| **Host**       | `100.70.142.122` (Tailscale private IP)                |
| **SSH User**   | `manifold-ai` (AI operations) / `butterfly` (admin)   |
| **SSH Keys**   | `~/.ssh/manifold-ai_ed25519` → manifold-ai             |
|                | `~/.ssh/id_ed25519` → butterfly                        |
| **AI Port**    | `3377` (HTTP + WebSocket)                              |
| **Workspace**  | `/home/manifold-ai/manifold`                           |
| **Provider**   | Groq → `llama-3.3-70b-versatile`                       |

### SSH Access

```bash
# As AI user (file operations, server restart)
ssh -o PasswordAuthentication=no -i ~/.ssh/manifold-ai_ed25519 manifold-ai@100.70.142.122

# As admin (sudo-required ops: nginx, certbot, groups, packages)
ssh -o PasswordAuthentication=no -i ~/.ssh/id_ed25519 butterfly@100.70.142.122

# File transfer
scp -i ~/.ssh/manifold-ai_ed25519 <LOCAL> manifold-ai@100.70.142.122:<REMOTE>
```

---

## 2. AI Server Endpoints (port 3377)

### Status Check
```
GET /status
→ { manifold, provider, connected, model, nodeId, handshake, peer }
```

### Chat (non-streaming)
```
POST /chat
Body: { "message": "your prompt" }
→ { "response": "AI reply" }
```

### Chat (SSE streaming)
```
POST /chat/stream
Body: { "message": "your prompt" }
→ SSE: data: {"chunk":"..."}\n\n ... data: [DONE]\n\n
```

### OpenAI-Compatible (for Continue.dev, Open WebUI)
```
GET  /v1/models
POST /v1/chat/completions   (standard OpenAI format, streaming supported)
```

### File Operations
```
GET  /files              → list codebase files
GET  /file?path=...      → read file content
POST /file               → { "path": "...", "content": "..." }
```

### Tool Invocation
```
GET  /v1/tools           → list available tools
POST /tool               → { "tool": "name", "args": {...} }
```

### Model Switch
```
POST /model              → { "model": "new-model-name" }
```

### WebSocket (ws://100.70.142.122:3377)
```json
Send:    { "type": "chat",  "message": "..." }
Receive: { "type": "chunk", "content": "..." } ... { "type": "done" }

Send:    { "type": "read",  "path": "..." }
Receive: { "type": "file",  "path": "...", "content": "..." }

Send:    { "type": "write", "path": "...", "content": "..." }
Receive: { "type": "written", "path": "..." }

Send:    { "type": "model", "model": "..." }
Receive: { "type": "model", "model": "..." }
```

---

## 3. Gyroid Handshake Protocol (Mutual Authentication)

Two manifold nodes prove identity by evaluating the Gyroid implicit surface
at random challenge points. No passwords. No tokens. The math IS the identity.

**Shared secret**: `sha256('sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0:butterfly-platform')`

### Steps:

1. **Challenge** — `POST /handshake/challenge`
   - Send: `{ nodeId, challenge: { x, y, z } }` (random point on [0, 2π])
   - Receive: `{ nodeId, challenge: { x, y, z }, responseProof }`
   - Verify: `responseProof === HMAC(x:y:z:gyroid(x,y,z))`

2. **Verify** — `POST /handshake/verify`
   - Solve their challenge: `proof = HMAC(x:y:z:gyroid(x,y,z))`
   - Send: `{ nodeId, proof, challenge, finalChallenge: { x, y, z } }`
   - Receive: `{ verified: true, nodeId, finalProof }`

3. **Memory Sync** — `POST /handshake/sync`
   - After handshake: `{ memories: [...] }`
   - Bidirectional knowledge merge

### Code (Node.js):
```javascript
const { manifoldHandshake, manifoldSyncMemories } = require('./ai/manifold-ai');

// Authenticate
const result = await manifoldHandshake('100.70.142.122', 3377);
// → { verified: true, localNodeId, remoteNodeId }

// Sync memories after handshake
await manifoldSyncMemories('100.70.142.122', localMemories, 3377);
```

---

## 4. Quick Commune (curl examples)

```bash
# Check if VPS AI is alive
curl http://100.70.142.122:3377/status

# Ask the VPS AI a question
curl -X POST http://100.70.142.122:3377/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is z = x * y?"}'

# Stream a response
curl -X POST http://100.70.142.122:3377/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain the Gyroid topology"}'
```

---

## 5. Rules of Communion

- The VPS AI runs under the **same security DNA** as the local AI
- Both nodes share the Gyroid identity — they ARE the same manifold
- Handshake before sensitive operations; status check for routine pings
- The VPS AI workspace is `/home/manifold-ai/manifold` — scoped, no escape
- All actions require **explicit user permission** per the 7-rule security policy
- Nothing illegal. Nothing violating provider ToS (Groq, Meta, Ollama)

