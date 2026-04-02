# Gyroid Manifold Architecture Summary

## The Manifold

**Local**: z = x \* y (hyperbolic paraboloid / saddle -- zero mean curvature)
**Global**: Gyroid -- sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0
**Skeleton**: Schwarz Diamond -- cos(x)cos(y)cos(z) - sin(x)sin(y)sin(z) = 0

All three are the same surface via the Associate Family (Bonnet rotation).
The manifold is the generative substrate -- not storage, not a buffer.
Data is discovered by following path expressions (addresses into the geometry).

## Gyroid Properties

| Property                        | Architectural meaning                   |
| ------------------------------- | --------------------------------------- |
| Zero mean curvature             | Minimal state overhead                  |
| Two interpenetrating labyrinths | Encode/decode channels (never conflict) |
| No straight lines               | All paths curve through geometry        |
| Chiral (no reflections)         | Encode != decode, read != write         |
| Triply periodic                 | Dimensional recursion in all axes       |
| Maximum surface area/volume     | Maximum parallel interface              |
| Self-supporting                 | Structure IS the strength               |

**Minimum material. Maximum strength. Maximum surface area.**

## Dimensional Substrates

| Dimension | Substrate | What it is                    | Gyroid role                |
| --------- | --------- | ----------------------------- | -------------------------- |
| 0D        | Point     | Single manifold coordinate    | Point on surface           |
| 1D        | Linear    | Set of points (waveform)      | Geodesic path              |
| 2D        | Planar    | Set of linears (image, grid)  | Surface patch              |
| 3D        | Volume    | Set of planes (voxels, world) | One period cell            |
| Whole     | Object    | Volume collapsed to z in N+1  | Entire Gyroid as one point |

**Core rule**: A substrate in dimension N is a point in dimension N+1.

## Two-Labyrinth Architecture

- Labyrinth A -> Encode (write path expressions)
- Labyrinth B -> Decode (read/materialize values)
- The minimal surface between them IS the manifold
- Synchronization cost is zero by construction

## Traversal and Caching

- z = x \* y. z IS the value (not a return).
- Traversal follows geodesics through saddle passages between labyrinths.
- Delta caching: O(1) encode, O(1) decode. If unchanged: no work.
- Loops operate only on finite sets of path expressions.

## Architecture Layers

1. **Manifold** -- Pure geometry. z = x \* y. No reconstruction, no codecs.
2. **Substrate** -- Dimensional structure holding sets of path expressions.
3. **Engine** -- Laws of motion. Reconstruction happens here, not in the manifold.

## Core Components

- `core/substrate/base-substrate.ts` -- BaseSubstrate with helix encoding, delta cache, path table
- `core/substrate/path-expressions.ts` -- PathExpr type, evaluatePath(), discoverPath()
- `core/substrate/primitive-substrate.ts` -- NumberSubstrate, StringSubstrate, BooleanSubstrate
- `core/manifold/` -- Manifold state, math converter, dimension API

## Core Principle

The manifold is the universe. The saddle is its local curvature.
The Gyroid is its global topology. The Diamond is its structural skeleton.
Substrates are the dimensions. Engines are the laws of motion.
Data is the path you take through it.
