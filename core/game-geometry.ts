/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GAME GEOMETRY — Manifold Coordinate Definition
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Defines the dimensional structure of the game state.
 * This compiles down to a single manifold artifact.
 *
 * No imperative logic here — just geometry.
 */

import { SaddleForm } from "../core/geometry/saddle";
import { SaddleField } from "../core/substrate/saddlefield";
import { saddleManifold } from "../core/substrate/manifold";
import { GyroidForm, SchwartzDiamondForm } from "../core/geometry/gyroid";
import { GyroidField, DiamondField } from "../core/substrate/gyroidfield";


/**
 * Game State Manifold
 *
 * Dimensions:
 *   1. Game (single root)
 *      ├─ Rooms (multiple)
 *      │  ├─ Players (multiple per room)
 *      │  ├─ Board State (game-specific)
 *      │  └─ Turn Order (flow along phase dimension)
 *      ├─ Globals (chat, leaderboard, etc.)
 *      └─ Metadata (version, checksum, etc.)
 *
 * z = xy principle applied:
 * - Players on rooms: coupling determines playability
 * - Turns on phases: saddle geometry ensures turn sequence
 * - Boards are coordinate spaces themselves (nested)
 */

export interface GameCoordinates {
  readonly game: GamePoint;
  readonly room?: RoomPoint;
  readonly player?: PlayerPoint;
}

export interface GamePoint {
  readonly rooms: Map<string, RoomPoint>;
  readonly globals: GlobalsPoint;
  readonly metadata: MetadataPoint;
}

export interface RoomPoint {
  readonly id: string;
  readonly status: 'waiting' | 'active' | 'completed';
  readonly players: Map<string, PlayerPoint>;
  readonly board: BoardPoint;
  readonly turnOrder: TurnPoint;
  readonly createdAt: number;
}

export interface PlayerPoint {
  readonly id: string;
  readonly name: string;
  readonly status: 'lobby' | 'playing' | 'spectating' | 'finished';
  readonly joinedAt: number;
  readonly score: number;
  readonly hand?: CardPoint[];  // Player's game hand (state-specific)
}

export interface BoardPoint {
  readonly cells: Map<string, CellPoint>;  // x:y grid as coordinate space
  readonly pieces: Map<string, PiecePoint>;
  readonly topology: 'saddle' | 'gyroid' | 'diamond';  // Saddle or gyroid or diamond

}

export interface CellPoint {
  readonly x: number;
  readonly y: number;
  readonly type: string;
  readonly occupants: Map<string, PiecePoint>;
  readonly z?: number;  // Elevation in saddle geometry
}

export interface PiecePoint {
  readonly id: string;
  readonly owner: string;  // playerId
  readonly type: string;
  readonly cellId: string;
  readonly metadata: any;
}

export interface CardPoint {
  readonly id: string;
  readonly type: string;
  readonly state: 'hand' | 'played' | 'discard';
}

export interface TurnPoint {
  readonly currentPhase: number;
  readonly phaseSequence: string[];
  readonly activePlayer: string;
  readonly movedAt: number;
}

export interface GlobalsPoint {
  readonly chat: ChatPoint[];
  readonly leaderboard: LeaderboardEntry[];
}

export interface ChatPoint {
  readonly author: string;
  readonly message: string;
  readonly timestamp: number;
}

export interface LeaderboardEntry {
  readonly playerId: string;
  readonly playerName: string;
  readonly score: number;
  readonly gamesWon: number;
}

export interface MetadataPoint {
  readonly version: string;
  readonly versionId: string;
  readonly parent: string | null;
  readonly checksum: string;
  readonly compiledAt: number;
  readonly dimensions: string[];
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SADDLE FIELD TOPOLOGY
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The game board is a manifold surface (z=xy).
 *
 * Players couple through turn order:
 * - At 0°: z = xy (aligned players reinforce each other's moves)
 * - At 90°: z = -xy (opposed players create tension)
 *
 * This geometry ensures:
 * - No deadlock (turn order is a flow along the saddle)
 * - No synchronization needed (manifold IS the state)
 * - Observable state (every point drillable)
 */

export const createGameManifold = () => {
  // Create saddle field for board topology
  const boardForm0 = new SaddleForm(0);      // Base saddle
  const boardForm90 = new SaddleForm(Math.PI / 2);  // Rotated

  const boardField = new SaddleField()
    .place([0, 0], boardForm0)      // Quadrant I & III
    .place([10, 10], boardForm90);  // Quadrant II & IV

  const gameManifold = saddleManifold(boardField);

  return gameManifold;
};

/**
 * Gyroid game topology: Triply periodic 3D minimal surface.
 */
export const createGyroidGameManifold = () => {
  const boardForm0 = new GyroidForm(0);
  const boardForm90 = new GyroidForm(Math.PI / 2);

  const boardField = new GyroidField()
    .place([0, 0, 0], boardForm0)
    .place([2 * Math.PI, 0, 0], boardForm90)
    .place([0, 2 * Math.PI, 0], boardForm90.rotated(Math.PI / 4))
    .place([0, 0, 2 * Math.PI], boardForm0.rotated(Math.PI / 2));

  // Stub 3D manifold; use as scalar field for now
  return {
    field: boardField,
    topology: 'gyroid' as const,
    scalarAt: (p: VecN) => boardField.scalarAt(p),
  };
};

/**
 * Schwartz Diamond game topology: Cubic primitive Diamond gyroid with z=xy.
 */
export const createDiamondGameManifold = () => {
  const boardForm0 = new SchwartzDiamondForm(0);
  const boardForm90 = new SchwartzDiamondForm(Math.PI / 2);

  const boardField = new DiamondField()
    .place([0, 0, 0], boardForm0)
    .place([2 * Math.PI, 0, 0], boardForm90)
    .place([0, 2 * Math.PI, 0], boardForm90.rotated(Math.PI / 4))
    .place([0, 0, 2 * Math.PI], boardForm0.rotated(Math.PI / 2));

  return {
    field: boardField,
    topology: 'diamond' as const,
    scalarAt: (p: VecN) => boardField.scalarAt(p),
  };
};


/**
 * ───────────────────────────────────────────────────────────────────────────
 * COMPILATION OUTPUT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * npm run compile-manifold generates:
 *
 * {
 *   "version": "1.0.0",
 *   "versionId": "v1-a1b2c3d4",
 *   "parent": null,
 *   "dimensions": [
 *     "game",
 *     "rooms",
 *     "players",
 *     "board",
 *     "cells",
 *     "pieces",
 *     "turn"
 *   ],
 *   "coordinates": {
 *     "game": {
 *       "rooms": { /* room entries */ },
 *       "globals": { /* chat, leaderboard */ },
 *       "metadata": { /* version info */ }
 *     }
 *   },
 *   "topology": "saddle [0°, 90°] at board.cells",
 *   "checksum": "d4c3b2a1...",
 *   "compiledAt": 1234567890
 * }
 *
 * Size: ~50-150 KB (regardless of game state size)
 * Reason: Only geometry stored, not full game state
 */
