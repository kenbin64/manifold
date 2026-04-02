# GROUND TRUTH — Verified Project Facts
# This file is the anti-hallucination anchor. Every fact here is verified.
# If you are unsure about something, CHECK THIS FILE FIRST.
# DO NOT contradict anything in this file. If reality has changed, the human will update this.

## Project Identity
- **Name**: Butterfly Platform
- **Type**: 3D arcade gaming platform with manifold-native architecture
- **Foundation**: z = x · y (saddle point / hyperbolic paraboloid)
- **Repository**: C:\manifold (local), /home/butterfly/manifold (VPS)

## Architecture
- **Core equation**: z = x * y (local saddle)
- **Global topology**: Gyroid — sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0
- **Structural skeleton**: Schwarz Diamond — cos(x)cos(y)cos(z) - sin(x)sin(y)sin(z) = 0
- **All three are the SAME surface** via the Associate Family (Bonnet rotation)
- **Two labyrinths**: Labyrinth A = encode/write, Labyrinth B = decode/read
- **Dimensional hierarchy**: Void → Point → Line → Width → Plane → Volume → Whole
- **Rule**: A substrate in dimension N is a point in dimension N+1

## Key Files — VERIFIED PATHS
- `app/src/platform/manifold-core.js` — Browser-side manifold substrate
- `app/src/platform/platform.js` — Main platform entry
- `app/src/platform/kensgames.html` — Platform HTML entry
- `ai/manifold-ai.js` — Private AI engine (ManifoldAI class)
- `ai/server.js` — AI HTTP server (port 3377)
- `ai/start.js` — AI bootstrap script
- `core/manifold/manifold.js` — Core manifold implementation
- `core/substrate/base-substrate.js` — Base substrate class
- `core/substrate/entity-store.js` — Entity storage
- `core/facade/manifold-facade.js` — Facade pattern for manifold
- `core/geometry/saddle.js` — Saddle point geometry
- `docs/ai_directive.md` — Full AI architecture directive
- `AI-DIRECTIVE.md` — Root-level AI directive
- `system-prompt.md` — System prompt specification

## Games — VERIFIED
- `app/src/platform/games/brickbreaker3d/` — Brick Breaker 3D
- `app/src/platform/games/fasttrack/` — FastTrack racing game
- `app/src/platform/games/zenxy/` — ZenXY (calculator, particles, synth)
- `app/src/platform/games/manifold3d/` — Manifold 3D visualizer (marching cubes)

## VPS — VERIFIED
- **IP**: 100.70.142.122 (Tailscale)
- **User**: butterfly
- **SSH key**: C:\Users\kbingh\.ssh\id_ed25519
- **Project path**: /home/butterfly/manifold
- **AI server port**: 3377
- **Ollama**: runs on VPS, tunneled to localhost:11434

## AI Configuration — VERIFIED
- **Groq API key**: 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
- **Primary model**: llama-3.3-70b-versatile (Groq cloud)
- **Fallback model**: qwen2.5-coder:1.5b (Ollama on VPS)
- **Continue config**: C:\Users\kbingh\.continue\config.yaml
- **Memory dir**: ai/.memory/
- **Memory files**: memory.jsonl (learnings), relations.jsonl (connections), actions.jsonl (logs)

## Forbidden — NEVER DO THESE
- Iterate a dimension (dimensions are infinite)
- Flatten to JSON-like forms
- Treat substrate as serializer/codec
- Create straight-line shortcuts
- Treat encode and decode as the same operation
- Assume data is stored in memory
- Reconstruct objects (that's the engine's job, not the manifold's)

## Conventions
- JavaScript (.js) is the runtime; TypeScript (.ts) exists but .js is primary
- Node.js on VPS (no browser)
- Three.js for 3D rendering in browser
- RAPIER for physics engine
- The manifold does NOT reconstruct objects — engines do
- Delta caching is mandatory
- Synchronization cost is zero by construction

## Owner
- **Name**: Ken Bingham
- **Email**: ken.bingham64@gmail.com
- **GitHub**: kenbin64

