import { Manifold } from "../core/manifold/manifold";
import { VecN } from "../core/geometry/vector";

/**
 * WebSocket Substrate Adapter
 *
 * Synchronizes manifold changes to connected clients via WebSocket.
 * Observes manifold version increments and broadcasts deltas.
 */
export class WSSubstrate {
  private clients: Set<any> = new Set();
  private manifestVersion: string = '';

  constructor(private manifold: Manifold) {}

  /**
   * Register a WebSocket client.
   */
  addClient(ws: any): void {
    this.clients.add(ws);

    // Send initial manifold state
    ws.send(JSON.stringify({
      type: 'manifold_state',
      version: this.manifestVersion,
      state: this.getManifoldState(),
      timestamp: Date.now(),
    }));

    // Listen for client messages
    ws.on('message', (msg: string) => {
      try {
        const data = JSON.parse(msg);
        this.handleClientMessage(ws, data);
      } catch (e) {
        ws.send(JSON.stringify({ error: 'Invalid message' }));
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      this.clients.delete(ws);
    });
  }

  /**
   * Handle incoming client messages (queries, subscriptions).
   */
  private handleClientMessage(ws: any, data: any): void {
    const { action, path, id } = data;

    if (action === 'drill') {
      // Client requests data at a path
      const result = this.drill(...(path || []));
      ws.send(JSON.stringify({
        type: 'drill_result',
        id,
        data: result,
        timestamp: Date.now(),
      }));
    }

    if (action === 'subscribe') {
      // Client subscribes to updates at a path
      // (In practice, would maintain subscriptions)
      ws.send(JSON.stringify({
        type: 'subscribed',
        id,
        path,
        timestamp: Date.now(),
      }));
    }
  }

  /**
   * Broadcast manifold update to all connected clients.
   */
  broadcastUpdate(oldVersion: string, newVersion: string, delta: any): void {
    const message = {
      type: 'manifold_update',
      oldVersion,
      newVersion,
      delta,
      timestamp: Date.now(),
    };

    for (const client of this.clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Get current manifold state for serialization.
   */
  private getManifoldState(): any {
    // In practice, would serialize manifold
    return {};
  }

  /**
   * Drill to a coordinate in the manifold.
   */
  private drill(...path: string[]): any {
    // Simplified: would traverse actual manifold
    return null;
  }
}
