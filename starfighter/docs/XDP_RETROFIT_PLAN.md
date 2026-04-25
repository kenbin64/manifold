# Starfighter — XDP / DimensionOS Retrofit Plan

> **Status:** plan only, no code yet. Captured 2026-04-24 alongside the
> one-line boot fix (restored `Starfighter.init()` in `index.html`).
> Authoritative paradigm: `/home/butterfly/apps/docs/DIMENSIONAL_PROGRAMMING_SPEC.md`.

## 0. Scope and stance

Starfighter already names "manifold" and "dimension" in many places. The
retrofit makes the runtime *actually* obey the XDP rule from the spec:

> X is the only stored truth. Y is resolvers that explode X. Z is the
> manifestation. M is the manifold. Stored data is just Z and can always
> be re-derived.

The retrofit is **non-destructive**. Existing modules keep their public
shape; new doctrine is added under them, not in place of them.

## 1. What is already XDP-shaped

| Existing file / call | Already in spirit | Gap to spec |
|---|---|---|
| `dim('arena.radius')`, `dim('player.hull')`, `dim('lives.max')` | Y-resolver lookup by address | Values are static reads from a flat map; no lazy derivation, no Z log |
| `manifold_kernel.js`, `dimensional_substrate.js` | Substrate naming | Not a kernel in the spec sense (no X store, no Y registry, no Z events) |
| `manifold_geometry_substrate.js` + `_preloadManifoldGeometries()` | Ship meshes derived from manifold seeds, not GLBs | Cockpit + celestial bodies still load GLBs (stored Z) |
| `SpaceManifold.setDim(k, v)` | Single write surface for "modifier" values | Writes mutate; spec wants append-only Z events with derived reads |
| `state.entities.push(...)`, `state.player.hull -= dmg` | — | Pure stored Z. The largest debt. |

## 2. X / Y / Z / M map for Starfighter

| Spec role | Starfighter binding |
|---|---|
| **X** (point / identity) | Pilot, ship hull serial, baseship, each enemy spawn — one row per entity, ~80 bytes: `{ id, name, dim_level, anchor:{x,y,z} }` |
| **Y** (resolver) | `hull(x, t)`, `shields(x, t)`, `position(x, t)`, `velocity(x, t)`, `color(x, t)`, `damage(weapon → target)` — functions keyed by address, called on read |
| **Z** (manifestation) | One frame's render, one tick's physics, one collision result, one wave snapshot — derived from X+Y at observation time |
| **M** (manifold) | Arena topology (sphere shell), gyroid/manifold ship-geometry rules, weapon arc rules, ANPC behavior fields |

The axiom `z = x · y` already holds in the registry validator; the retrofit
makes it hold inside the running game too.

## 3. Phased path (smallest reversible step first)

### Phase A — Boot fix (DONE 2026-04-24)
- Restored `window.addEventListener('DOMContentLoaded', () => Starfighter.init())` in `starfighter/index.html`.
- No paradigm change. Game launches again.

### Phase B — DimensionOS shim (≈50 lines, no behavior change)
Add a single new file under `js/manifold_core/` that exports a minimal
kernel matching the spec's `BaseObjectX` contract:

- `xStore` — Map<id, X-record>
- `yRegistry` — Map<addr, () => value>
- `zLog` — append-only ring buffer of `{ ts, xId, yId, args, result }`
- `getX(id)`, `registerY(addr, fn)`, `resolveY(addr, ctx)`, `recordZ(ev)`

Then route the existing `dim(addr)` calls through `resolveY(addr)` and
`SpaceManifold.setDim` through `registerY`. Game still works the same;
the substrate is now XDP-compliant; future code naturally writes XDP.

**Acceptance:** `Starfighter` runs identically, but every `dim()` read
produces a Z event in the kernel log; every `setDim()` becomes a Y
resolver registration.

### Phase C — Ship geometry derivation (existing partial)
Already partly done in `manifold_geometry_substrate.js`. Finish by:

- Removing the cockpit GLB and deriving cockpit interior from the same
  manifold rules that emit ship hulls. (Cockpit is a 3D inside-out hull.)
- Earth / moon stay as celestial Y resolvers backed by surface equations,
  not GLB textures stored as files.

**Acceptance:** zero `.glb` requests in the network panel during a solo
run. Geometry budget per ship type unchanged.

### Phase D — State as Z events
The biggest move. Replace mutation patterns with Z-event append + derived
read:

- `state.player.hull -= dmg` → `recordZ({ x: player.id, y: 'damage', val: dmg })`
- `hull(player)` resolver folds the Z log to compute current hull.
- Save / replay / rollback fall out for free.

Done per-system, not all at once: hull → shields → position → velocity →
weapon cooldowns → wave state. Each one passes its own integration test
before the next is touched.

### Phase E — TetracubeDB anchoring
Per `KENSGAMES_TETRACUBE_DIRECTIVE_CONTRACT.md`, X seeds (player, ship
hull serial, persistent progression) belong in tetracubedb on `:4747`.
Starfighter currently owns its own progression in browser localStorage.
Phase E moves X seeds to tetracubedb and keeps Z events local; replays
become a tetracubedb query.

## 4. Hard rules during the retrofit

1. **Never delete a working code path until its replacement passes the same test.**
2. **No GLB regressions:** the portal AGENTS.md ban on GLBs as runtime
   assets is already partly enforced; the retrofit must not reintroduce
   them.
3. **Browser-first, no bundlers, no TypeScript:** per portal AGENTS.md.
   The shim in Phase B is plain JS loaded by `<script>` tag.
4. **`z = x · y` registry axiom must keep passing** at every phase boundary.
5. **No paradigm-only commits without a behavioral test.** Each phase
   ships with a smoke test under `starfighter/tests/`.

## 5. What this plan does NOT decide

- Whether DimensionOS becomes a separate npm package or stays an in-repo
  module. Defer until Phase B is real.
- Whether Phase D uses event sourcing over IndexedDB or a pure in-memory
  log. Defer; Phase B's Z log is already a working stub.
- Multiplayer Z-event sync. Out of scope; revisit after Phase D.

## 6. Pointers

- Spec: `docs/DIMENSIONAL_PROGRAMMING_SPEC.md` (especially §2, §6, §11)
- Portal doctrine: `kensgames-portal/manifold/AGENTS.md`
- Existing substrates to extend, not replace:
  `manifold_kernel.js`, `dimensional_substrate.js`,
  `manifold_native_substrate.js`, `manifold_geometry_substrate.js`
- Contract with the manifold engine:
  `tetracubedb/docs/KENSGAMES_TETRACUBE_DIRECTIVE_CONTRACT.md`
