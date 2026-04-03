# Manifold-Native Architecture: Compilation Paradigm

## Current Architecture (REST-First)
```
HTTP/REST API
    ↓
ManifoldSocket (WS protocol)
    ↓
Game State (in-memory maps)
    ↓
Domain Logic (rooms, players, turns)
```

**Problem**: Data translations at each layer, REST is the "source of truth"

---

## Proposed Architecture (Manifold-Native)
```
Manifold Core (z=xy Substrate)
    ├─ GameState (drillable coordinate space)
    ├─ PlayerAgents (autonomous at specific points)
    ├─ RoomTopology (geometric arrangement)
    └─ TurnSequence (flow along manifold paths)
         ↓
SubstrateAdapters (read-only views into manifold)
    ├─ HTTPSubstrate (REST/CRUD → manifold drill)
    ├─ WebSocketSubstrate (real-time sync)
    └─ FileSubstrate (persistence)
```

**Benefit**: Manifold is the source of truth, HTTP is just an observation lens

---

## Key Insight: HTTP as Substrate Adapter

### Current Flow (HTTP → State)
```javascript
// Traditional
POST /api/room/join
→ validate
→ update room.players[] array
→ send WS message
→ client updates UI
```

### Manifold-Native Flow (State → HTTP)
```typescript
// New approach
const gameManifold = manifold.drill('game', roomId, 'players', playerId);
// Players are points in manifold space, not array indices

const httpView = HTTPSubstrate.observe(gameManifold);
// HTTP adapter reads the manifold and translates:
httpView.GET('/api/room/{id}')
  → drill manifold coords → serialize to JSON → send

httpView.POST('/api/room/{id}/join', {playerId})
  → drill to player's point → update manifold version
  → manifold change triggers broadcast
  → HTTP adapter emits {event: 'joined'}
```

---

## Compilation Paradigm Shift

### Old (Imperative)
1. Write REST endpoints
2. Map to database operations
3. Map to domain logic
4. Emit events
5. Map to WebSocket
6. Client receives

### New (Dimensional)
1. **Define manifold geometry** (what are the coordinates?)
2. **Place substrates at those coordinates** (players, rooms, items)
3. **Define flows** (how data moves through manifold)
4. **Compose adapters** (HTTP, WS, File are subscribers)
5. **Compile to substrate** (manifold IS the deployment artifact)

---

## Benefits Analysis

### Dimensional Collapse (YES - Major Benefit)

**Current Size**:
- HTTP handlers: 50+ endpoints
- WS protocol: 30+ message types
- State management: 15+ Map structures
- Total: ~1000s of lines + duplication

**Manifold Size**:
- GameState manifold: 1 definition
- Coordinates: `(roomId, playerId, property)`
- HTTPSubstrate: 1 generic adapter
- WSSubstrate: 1 generic adapter
- Total: ~300 lines + O(1) generics

**Compression Ratio**: ~3-4x reduction in explicit code

### Why It Works
- **No iteration**: drill to specific coordinate, O(1)
- **No duplication**: one path for all transport types
- **Automatic versioning**: manifold tracks all state changes
- **Observable**: every point is auditable

---

## Deployment Structure: `/home/manifold`

```
/home/manifold/
├── core/                      # Computed manifold (not source)
│   ├── game-manifold.json    # Compiled dimensional state
│   ├── player-substrate.dat  # Serialized player points
│   └── room-topology.dat     # Room arrangement in space
│
├── substrates/               # Adapter layers
│   ├── http-adapter.js       # REST → manifold drill
│   ├── ws-adapter.js         # WS → manifold point updates
│   └── fs-adapter.js         # File persistence
│
├── server.js                 # Single entry point
├── index.ts                  # Manifold generation (compile-time)
└── package.json

Source (not deployed):
├── src/manifold/             # Manifold definitions
├── src/substrates/           # Adapter source
└── tsconfig.json             # Build config
```

---

## Artifact-Based Deployment

### Compile-Time (Local)
```bash
npm run compile-manifold
  # Reads: src/manifold definitions
  # Outputs: core/game-manifold.json
  # Size: ~50KB (O(1) per game state)
```

### Runtime (VPS)
```bash
npm run start-manifold
  # Loads: core/game-manifold.json
  # Mounts: HTTPSubstrate, WSSubstrate
  # Result: Single manifold instance serving all clients
```

### Versioning
```bash
git add core/game-manifold.json
git commit -m "Game state v2.1"
  # Manifold versions are first-class (no separate version tree)
  # Each deploy is a point on version manifold
```

---

## HTTP Substrate Adapter Template

```typescript
// HTTPSubstrate: translates REST requests to manifold drills

export class HTTPSubstrate {
  constructor(private manifold: Manifold) {}

  // GET /api/room/{roomId}
  async getRoom(roomId: string): Promise<any> {
    const roomCoord = `room:${roomId}`;
    const state = this.manifold.drill(roomCoord);
    return {
      id: roomId,
      players: state.drill('players').getAll(),  // drill to players coordinate
      status: state.drill('status').get(),
      createdAt: state.drill('meta', 'createdAt').get(),
    };
  }

  // POST /api/room/{roomId}/join
  async joinRoom(roomId: string, playerId: string): Promise<void> {
    const playerPoint = this.manifold.drill('room', roomId, 'players', playerId);
    playerPoint.set('joined', true);
    playerPoint.set('joinedAt', Date.now());
    // No explicit API response needed — manifold change triggers WS broadcast
  }

  // DELETE /api/room/{roomId}/player/{playerId}
  async leaveRoom(roomId: string, playerId: string): Promise<void> {
    const playerPoint = this.manifold.drill('room', roomId, 'players', playerId);
    playerPoint.delete();  // O(1) deletion from manifold
  }
}
```

---

## Compilation Process (New)

### 1. **Define Geometry** (manifold shape)
```typescript
// src/manifold/game-geometry.ts
const gameGeometry = {
  dimensions: ['roomId', 'playerId', 'property'],
  coordinateTypes: {
    roomId: 'uuid',
    playerId: 'uuid',
    property: 'string',
  },
};
```

### 2. **Define Flows** (data movement)
```typescript
// src/manifold/game-flows.ts
const turnFlow = flow()
  .along('playerId')  // moves along player dimension
  .period(30000)      // 30s per turn
  .script([
    { action: 'activatePlayer', at: offset(0) },
    { action: 'deactivatePlayer', at: offset(29000) },
  ]);
```

### 3. **Compile to Artifact**
```bash
npm run compile
  # Inputs: geometry + flows + initial state
  # Output: core/game-manifold.json
  # Verification: all coordinates are finite-dimensional and auditable
```

### 4. **Deploy Artifact**
```bash
cp -r core /home/manifold/
scp /home/manifold/* butterfly@vps:/home/manifold/
ssh butterfly@vps "cd /home/manifold && npm start"
```

---

## Real Benefit: Dimensional Reduction

### Example: Dining Philosophers

**Old (Procedural)**:
```javascript
// 200+ lines of fork management, deadlock prevention, event emission
```

**New (Manifold)**:
```typescript
const philosophers = manifold.drill('philosophers');
// Each philosopher is a coordinate point
// Forks are edges in coordinate space
// Deadlock is impossible by geometry (not algorithm)
// Size: ~30 lines
```

---

## Next Steps

1. **Define game-state manifold** (coordinates for rooms, players, items)
2. **Extract HTTPSubstrate** (generic adapter from REST→drill)
3. **Extract WSSubstrate** (generic adapter for sync)
4. **Compile & deploy** to `/home/manifold`
5. **Verify**: One manifold, all transports reading from it

---

## FAQ

**Q: Will this actually reduce deployment size?**
A: Yes. Single manifold artifact vs. separate API + WS + DB handlers.

**Q: Is dimensional collapse worth it?**
A: For logic reduction: ~70% code cut. For runtime: no overhead (both use drill).

**Q: What if I need custom HTTP behavior?**
A: HTTPSubstrate is configurable. Define which coordinates map to which endpoints.

**Q: Can I version the manifold?**
A: Yes. Each deployment is a point. Manifold versioning is first-class.
