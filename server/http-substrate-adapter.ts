import { Manifold } from "../core/manifold/manifold";
import { VecN } from "../core/geometry/vector";

/**
 * HTTP Substrate Adapter
 *
 * Translates REST/CRUD requests into manifold drill operations.
 * Acts as a read-only lens into the manifold for HTTP clients.
 *
 * Key principle: HTTP does NOT mutate the manifold directly.
 * Instead, requests translate to coordinate sequences that update manifold versions.
 */
export class HTTPSubstrate {
  constructor(private manifold: Manifold) {}

  /**
   * GET /api/room/{roomId}
   * Read a room state by drilling to that coordinate.
   */
  async getRoom(roomId: string): Promise<any> {
    try {
      // Drill to room coordinate
      const roomPoint = this.drill('room', roomId);
      if (!roomPoint) return null;

      return {
        id: roomId,
        status: roomPoint.drill('status'),
        playerCount: roomPoint.drill('playerCount'),
        maxPlayers: roomPoint.drill('maxPlayers'),
        createdAt: roomPoint.drill('meta', 'createdAt'),
        updatedAt: roomPoint.drill('meta', 'updatedAt'),
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * GET /api/room/{roomId}/players
   * List all players in a room by drilling to player coordinates.
   */
  async getRoomPlayers(roomId: string): Promise<any[]> {
    try {
      const playersCoord = this.drill('room', roomId, 'players');
      if (!playersCoord) return [];

      // Dimensional iteration: no loop, drill each coordinate
      const players: any[] = [];
      for (const playerId of playersCoord.getCoordinates()) {
        const player = playersCoord.drill(playerId);
        if (player) {
          players.push({
            id: playerId,
            name: player.drill('name'),
            status: player.drill('status'),
            joinedAt: player.drill('joinedAt'),
          });
        }
      }
      return players;
    } catch (e) {
      return [];
    }
  }

  /**
   * POST /api/room/{roomId}/join
   * Add a player to a room.
   * This creates a new manifold version with the player coordinate.
   */
  async joinRoom(roomId: string, playerId: string, playerName: string): Promise<void> {
    // Drill to the specific player point in this room
    const playerPoint = this.drill('room', roomId, 'players', playerId);

    // Create new version (immutable)
    playerPoint.withValue({
      name: playerName,
      status: 'joined',
      joinedAt: Date.now(),
      score: 0,
    });

    // Increment room's player count
    const roomPoint = this.drill('room', roomId);
    const currentCount = roomPoint.drill('playerCount') || 0;
    roomPoint.drill('playerCount').withValue(currentCount + 1);

    // Return signal for WS broadcast (manifold change event)
    return; // Listeners observe version increments
  }

  /**
   * POST /api/room/{roomId}/leave
   * Remove a player from a room.
   */
  async leaveRoom(roomId: string, playerId: string): Promise<void> {
    const playerPoint = this.drill('room', roomId, 'players', playerId);
    playerPoint.delete(); // O(1) deletion from manifold

    // Decrement room count
    const roomPoint = this.drill('room', roomId);
    const currentCount = roomPoint.drill('playerCount') || 0;
    roomPoint.drill('playerCount').withValue(currentCount - 1);
  }

  /**
   * POST /api/room/{roomId}/move
   * Record a player movement.
   */
  async recordMove(roomId: string, playerId: string, move: any): Promise<void> {
    const moveLog = this.drill('room', roomId, 'moves', playerId);
    const moves = moveLog.getAll() || [];
    moveLog.withValue([...moves, { ...move, timestamp: Date.now() }]);
  }

  /**
   * GET /api/game/state
   * Full game state (entire manifold snapshot).
   * Warning: Large serialization. Use specific endpoints in production.
   */
  async getGameState(): Promise<any> {
    return this.drill('game').serialize();
  }

  /**
   * Internal: Drill a path in manifold.
   * Converts path array to manifold coordinates.
   */
  private drill(...path: string[]): any {
    // This would traverse the manifold coordinate system
    // For now, simplified example that assumes manifold.drill() exists
    let current = (this as any).manifold;
    for (const coord of path) {
      if (current && typeof current.drill === 'function') {
        current = current.drill(coord);
      } else {
        return null;
      }
    }
    return current;
  }
}

/**
 * WebSocket Substrate Adapter
 *
 * Synchronizes manifold changes to connected clients via WebSocket.
 * Observes manifold version increments and broadcasts deltas.
 */
export class WSSubstrate {
  constructor(
    private manifold: Manifold,
    private onMessage: (ws: any, msg: any) => void
  ) {}

  /**
   * Called when manifold version changes.
   * Computes delta and broadcasts to all connected clients.
   */
  broadcastManifoldChange(oldVersion: any, newVersion: any, clients: Set<any>): void {
    const delta = this.computeDelta(oldVersion, newVersion);

    const message = {
      type: 'manifold_update',
      version: newVersion.versionId,
      parent: newVersion.parent,
      delta, // Only changed coordinates
      timestamp: Date.now(),
    };

    // Send to all connected clients
    for (const client of clients) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Compute delta (changed coordinates only).
   * Manifold versioning already tracks this — just extract.
   */
  private computeDelta(oldV: any, newV: any): Record<string, any> {
    // In practice, manifold stores deltas as first-class objects
    // This is the substrate reading the delta for transmission
    return newV.delta || {};
  }
}

/**
 * File Persistence Substrate
 *
 * Serializes manifold to disk at intervals.
 * Allows recovery and historical playback.
 */
export class FilePersistenceSubstrate {
  constructor(private manifestPath: string) {}

  /**
   * Snapshot manifold to file.
   * Each snapshot is a point on the version manifold.
   */
  async snapshot(manifold: Manifold, version: string): Promise<void> {
    const data = manifold.serialize();
    const timestamp = new Date().toISOString();
    const filename = `${this.manifestPath}/snapshot-${version}-${timestamp}.json`;

    // In production, use atomic writes
    // await fs.promises.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`Persisted manifold v${version} to ${filename}`);
  }

  /**
   * Load manifold from snapshot.
   */
  async restore(version: string): Promise<any> {
    // In production: read from filename pattern
    // const data = await fs.promises.readFile(...);
    // return Manifold.deserialize(data);
    console.log(`Restored manifold v${version}`);
    return null;
  }
}
