/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KENSGAMES GAME MANIFOLD — Manifold-Native Game Registry
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All game metadata stored as PathExpression addresses via RepresentationTable.
 * No Map wrappers. No facade classes. No data drift.
 *
 * Uses RepresentationTable from manifold-core.js:
 *   encode(address, value, section) → PathExpression.fromValue → z = x·y
 *   decode(address) → cached z (O(1) if clean)
 *   encodeString / decodeString → strings ARE paths
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// GAME REGISTRY — All games as RepresentationTables on the manifold
// ═══════════════════════════════════════════════════════════════════════════

class GameRegistry {
  constructor() {
    /** @type {Object.<string, RepresentationTable>} game id → RepresentationTable */
    this._tables = Object.create(null);
    this._ids = [];  // finite set of registered game ids
  }

  register(id, config) {
    const table = new RepresentationTable(`game:${id}`);
    table.encodeString("id", id);
    table.encodeString("name", config.name);
    table.encodeString("icon", config.icon);
    table.encodeString("desc", config.desc);
    table.encode("minPlayers", config.minPlayers, HELIX.LINE);
    table.encode("maxPlayers", config.maxPlayers, HELIX.LINE);
    table.encode("aiSupport", config.aiSupport ? 1 : 0, HELIX.POINT);
    table.encodeString("url", config.url);
    this._tables[id] = table;
    if (this._ids.indexOf(id) === -1) this._ids.push(id);
  }

  get(id) {
    const table = this._tables[id];
    if (!table) return undefined;
    return this._materialize(id, table);
  }

  list() {
    const result = [];
    for (let i = 0; i < this._ids.length; i++) {
      const id = this._ids[i];
      result.push(this._materialize(id, this._tables[id]));
    }
    return result;
  }

  _materialize(id, table) {
    return {
      id: table.decodeString("id") || id,
      name: table.decodeString("name") || id,
      icon: table.decodeString("icon") || "🎮",
      desc: table.decodeString("desc") || "",
      minPlayers: Math.round(table.decode("minPlayers") || 1),
      maxPlayers: Math.round(table.decode("maxPlayers") || 4),
      aiSupport: (table.decode("aiSupport") || 0) > 0.5,
      url: table.decodeString("url") || "",
    };
  }

  get size() { return this._ids.length; }
}

// Singleton registry
const gameRegistry = new GameRegistry();

// Register KensGames
gameRegistry.register("fasttrack", {
  name: "FastTrack",
  icon: "🎲",
  desc: "Strategic racing board game",
  minPlayers: 2, maxPlayers: 6,
  aiSupport: true,
  url: "games/fasttrack/index.html"
});

gameRegistry.register("brickbreaker3d", {
  name: "BrickBreaker 3D",
  icon: "🧱",
  desc: "3D brick smashing via saddle physics",
  minPlayers: 1, maxPlayers: 2,
  aiSupport: false,
  url: "games/brickbreaker3d/index.html"
});

// Export for browser and Node
if (typeof window !== "undefined") {
  window.GameRegistry = gameRegistry;
}
if (typeof module !== "undefined") {
  module.exports = { GameRegistry: gameRegistry, GameRegistryClass: GameRegistry };
}
