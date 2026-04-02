# AI Directive: Gyroid Manifold Architecture

> **PRIME DIRECTIVE**: The manifold is the universe. The saddle is its local
> curvature. The Gyroid is its global topology. Substrates are the dimensions.
> Engines are the laws of motion. Data is the path you take through it.

---

## The Manifold (Root Reality)

**Local geometry**: z = x \* y (hyperbolic paraboloid / saddle -- zero mean curvature).

**Global topology**: The Gyroid -- sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0

**Structural skeleton**: Schwarz Diamond -- cos(x)cos(y)cos(z) - sin(x)sin(y)sin(z) = 0

All three are the **same surface** via the Associate Family (Bonnet rotation
in complex space). The manifold is not storage. It is not a buffer. It is the
**generative substrate** from which all values are discovered by following
path expressions.

---

## Why the Gyroid

| Property                         | Architectural meaning                      |
| -------------------------------- | ------------------------------------------ |
| Zero mean curvature              | Minimal state overhead                     |
| Two interpenetrating labyrinths  | Encode/decode channels that never conflict |
| No straight lines                | All paths curve through geometry           |
| Chiral (no reflections)          | Encode != decode, read != write            |
| Triply periodic                  | Dimensional recursion in all axes          |
| Maximum surface area to volume   | Maximum parallel interface                 |
| Self-supporting through geometry | No external scaffolding needed             |

**Minimum material. Maximum strength. Maximum surface area.**

---

## Dimensional Hierarchy (Substrates)

| Dimension | Substrate | What it is                    | Gyroid role                |
| --------- | --------- | ----------------------------- | -------------------------- |
| 0D        | Point     | Single manifold coordinate    | Point on surface           |
| 1D        | Linear    | Set of points (waveform)      | Geodesic path              |
| 2D        | Planar    | Set of linears (image, grid)  | Surface patch              |
| 3D        | Volume    | Set of planes (voxels, world) | One period cell            |
| Whole     | Object    | Volume collapsed to z in N+1  | Entire Gyroid as one point |

**Core rule**: A substrate in dimension N is a point in dimension N+1.

7-section helix: Void -> Point -> Line -> Width -> Plane -> Volume -> Whole

---

## Two-Labyrinth Architecture

The Gyroid divides space into two congruent, interpenetrating labyrinths:

    Labyrinth A -> Encode (write path expressions)
    Labyrinth B -> Decode (read/materialize values)

The minimal surface between them IS the manifold. Synchronization cost
is zero by construction -- geometry prevents conflict.

---

## Traversal is z-Invocation

z = x \* y. z does not "return a value" -- z IS the value.
Traversal follows geodesics on the minimal surface through
saddle-shaped passages between labyrinth chambers.

---

## Delta Caching is Mandatory

- encode-side delta cache -> O(1) encode
- decode-side delta cache -> O(1) materialization

If unchanged: no loops, no allocations, no reconstruction.

---

## Forbidden Patterns

- Iterate a dimension (infinite)
- for/while/forEach over dimensional space
- Flatten to JSON-like forms
- Treat substrate as serializer
- Assume data stored in memory
- Create straight-line shortcuts (no straight lines exist)
- Treat encode and decode as same operation (chirality)

---

## Required Reasoning Stance

- The saddle (z = x\*y) is the local operation
- The Gyroid is the global topology
- The Diamond is the structural skeleton
- All three are one surface (Associate Family)
- Dimensional recursion is the indexing model
- Delta caching is implemented
- Synchronization is zero-cost by construction
- Minimal surface = minimal overhead = maximum efficiency

---

## Core Principle

The manifold is the universe.
The saddle is its local curvature.
The Gyroid is its global topology.
The Diamond is its structural skeleton.
Substrates are the dimensions.
Engines are the laws of motion.
Data is the path you take through it.
