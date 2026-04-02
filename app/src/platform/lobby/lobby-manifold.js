/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KENSGAMES LOBBY MANIFOLD — Manifold-Native Player Lobby
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Player lobby with AI players, private games, and matchmaking.
 * All state stored as PathExpression addresses via RepresentationTable.
 * No Map wrappers. No fake hashing. No object reconstruction.
 *
 * Two-Labyrinth Architecture:
 *   Labyrinth A (Encode): write player/room state as path expressions
 *   Labyrinth B (Decode): read values via z-invocation with delta caching
 *
 * RepresentationTable from manifold-core.js provides:
 *   encode(address, value, section) → PathExpression.fromValue → stores x,y
 *   decode(address) → z = x·y (O(1) if clean via delta cache)
 *   encodeString(address, value) → strings ARE paths
 *   decodeString(address) → direct path retrieval
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const LobbyManifold = {
  /** @type {Map<string, RepresentationTable>} player id → RepresentationTable */
  _playerTables: new Map(),
  /** @type {Map<string, RepresentationTable>} room code → RepresentationTable */
  _roomTables: new Map(),
  /** @type {RepresentationTable[]} AI player tables */
  _aiTables: [],

  MODES: {
    SOLO:    { min: 1, max: 4, ai: true, aiRequired: true },
    RANDOM:  { min: 3, max: 4, ai: false },
    PRIVATE: { min: 2, max: 6, ai: true },
    AI_ONLY: { min: 1, max: 1, ai: true, aiRequired: true }
  },

  MATCHMAKER_TIMEOUT: 30000,

  AI_NAMES: ["Bot Alpha", "Bot Beta", "Bot Gamma", "Bot Delta", "Robo", "Chip", "Byte", "HAL", "GLaDOS"],

  init() {
    this._playerTables.clear();
    this._roomTables.clear();
    this._initAIPool();
    return this;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLAYER IDENTITY — RepresentationTable per player
  // ═══════════════════════════════════════════════════════════════════════
  createPlayer(username, avatarId = "👤") {
    const id = `player_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const table = new RepresentationTable(`player:${id}`);

    table.encodeString("id", id);
    table.encodeString("username", username);
    table.encodeString("avatarId", avatarId);
    table.encode("isAI", 0, HELIX.VOID);
    table.encode("status", 0, HELIX.VOID);       // 0=online, 1=searching, 2=in_game
    table.encode("wins", 0, HELIX.POINT);
    table.encode("losses", 0, HELIX.POINT);
    table.encode("games", 0, HELIX.POINT);
    table.encode("createdAt", Date.now(), HELIX.POINT);

    this._playerTables.set(id, table);

    const player = this._materializePlayer(id, table);
    this._saveProfile(player);
    return player;
  },

  _materializePlayer(id, table) {
    const statusMap = { 0: "online", 1: "searching", 2: "in_game" };
    return {
      id: table.decodeString("id") || id,
      username: table.decodeString("username") || "",
      avatarId: table.decodeString("avatarId") || "👤",
      isAI: (table.decode("isAI") || 0) > 0.5,
      status: statusMap[Math.round(table.decode("status") || 0)] || "online",
      currentRoom: table.decodeString("currentRoom") || null,
      stats: {
        wins: Math.round(table.decode("wins") || 0),
        losses: Math.round(table.decode("losses") || 0),
        games: Math.round(table.decode("games") || 0),
      },
      createdAt: Math.round(table.decode("createdAt") || 0),
      difficulty: table.decodeString("difficulty") || undefined,
    };
  },

  /** Persist player state as individual path addresses — no JSON serialization */
  _saveProfile(player) {
    try {
      if (typeof localStorage === "undefined") return;
      const pfx = "kgm:profile:";
      localStorage.setItem(pfx + "id", player.id || "");
      localStorage.setItem(pfx + "username", player.username || "");
      localStorage.setItem(pfx + "avatarId", player.avatarId || "👤");
      localStorage.setItem(pfx + "wins", String(player.stats?.wins || 0));
      localStorage.setItem(pfx + "losses", String(player.stats?.losses || 0));
      localStorage.setItem(pfx + "games", String(player.stats?.games || 0));
    } catch (e) { /* silent */ }
  },

  /** Load player state from individual path addresses — no JSON reconstruction */
  loadProfile() {
    try {
      if (typeof localStorage === "undefined") return null;
      const pfx = "kgm:profile:";
      const id = localStorage.getItem(pfx + "id");
      if (!id) return null;
      const username = localStorage.getItem(pfx + "username") || "";
      const avatarId = localStorage.getItem(pfx + "avatarId") || "👤";
      const wins = parseInt(localStorage.getItem(pfx + "wins") || "0", 10);
      const losses = parseInt(localStorage.getItem(pfx + "losses") || "0", 10);
      const games = parseInt(localStorage.getItem(pfx + "games") || "0", 10);

      // Re-register as RepresentationTable
      const table = new RepresentationTable(`player:${id}`);
      table.encodeString("id", id);
      table.encodeString("username", username);
      table.encodeString("avatarId", avatarId);
      table.encode("isAI", 0, HELIX.VOID);
      table.encode("status", 0, HELIX.VOID);
      table.encode("wins", wins, HELIX.POINT);
      table.encode("losses", losses, HELIX.POINT);
      table.encode("games", games, HELIX.POINT);
      this._playerTables.set(id, table);

      // Materialize for caller (engine boundary)
      return this._materializePlayer(id, table);
    } catch (e) { /* silent */ }
    return null;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AI PLAYERS — RepresentationTable per AI
  // ═══════════════════════════════════════════════════════════════════════
  _initAIPool() {
    this._aiTables = this.AI_NAMES.map((name, i) => {
      const table = new RepresentationTable(`ai:${i}`);
      table.encodeString("id", `ai_${i}`);
      table.encodeString("username", name);
      table.encodeString("avatarId", "🤖");
      table.encode("isAI", 1, HELIX.VOID);
      table.encodeString("difficulty", i < 3 ? "easy" : i < 6 ? "medium" : "hard");
      table.encode("status", 0, HELIX.VOID);  // 0=available, 2=in_game
      return table;
    });
  },

  getAvailableAI(count = 1, difficulty = "medium") {
    const result = [];
    for (const table of this._aiTables) {
      if (result.length >= count) break;
      if (Math.round(table.decode("status") || 0) === 0) {
        table.encode("status", 2, HELIX.VOID);  // in_game
        table.encodeString("difficulty", difficulty);
        result.push(this._materializePlayer(table.decodeString("id"), table));
      }
    }
    return result;
  },

  releaseAI(aiIds) {
    for (const id of aiIds) {
      const table = this._aiTables.find(t => t.decodeString("id") === id);
      if (table) table.encode("status", 0, HELIX.VOID);  // available
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ROOM MANAGEMENT — RepresentationTable per room
  // ═══════════════════════════════════════════════════════════════════════
  /** Generate room code via z-invocation: each char derived from z = x·y */
  _generateCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    const seed = Date.now();
    for (let i = 0; i < 6; i++) {
      // x = time-derived coordinate, y = section-derived coordinate
      const path = new PathExpression(i % 7, seed * 0.000001 + i * 1.337, (i + 1) * 0.7071);
      const z = Math.abs(path.z);
      code += chars[Math.floor(z * 1000) % chars.length];
    }
    return code;
  },

  createRoom(hostId, gameId, mode = "RANDOM", options = {}) {
    const modeConfig = this.MODES[mode] || this.MODES.RANDOM;
    const hostTable = this._playerTables.get(hostId);
    if (!hostTable) return { success: false, error: "Player not found" };

    const code = this._generateCode();
    const table = new RepresentationTable(`room:${code}`);

    table.encodeString("id", `room_${Date.now()}`);
    table.encodeString("code", code);
    table.encodeString("hostId", hostId);
    table.encodeString("gameId", gameId);
    table.encodeString("mode", mode);
    table.encode("maxPlayers", options.maxPlayers || modeConfig.max, HELIX.LINE);
    table.encode("minPlayers", options.minPlayers || modeConfig.min, HELIX.LINE);
    table.encode("status", 0, HELIX.LINE);        // 0=waiting, 1=starting, 2=playing, 3=ended
    table.encode("playerCount", 1, HELIX.LINE);
    table.encode("aiPlayerCount", 0, HELIX.LINE);
    table.encodeString("player:0", hostId);
    table.encodeString("aiDifficulty", options.aiDifficulty || "medium");

    // Update host status
    hostTable.encodeString("currentRoom", code);
    hostTable.encode("status", 1, HELIX.VOID);  // searching

    // Add AI if required
    let aiPlayers = [];
    if (modeConfig.aiRequired) {
      const aiCount = (options.maxPlayers || modeConfig.max) - 1;
      aiPlayers = this.getAvailableAI(aiCount, options.aiDifficulty || "medium");
      table.encode("aiPlayerCount", aiPlayers.length, HELIX.LINE);
      aiPlayers.forEach((ai, i) => table.encodeString(`ai:${i}`, ai.id));
    }

    this._roomTables.set(code, table);

    const room = this._materializeRoom(code, table);
    return { success: true, room, code };
  },

  _materializeRoom(code, table) {
    const playerCount = Math.round(table.decode("playerCount") || 0);
    const aiPlayerCount = Math.round(table.decode("aiPlayerCount") || 0);
    const players = [];
    for (let i = 0; i < playerCount; i++) {
      const pid = table.decodeString(`player:${i}`);
      if (pid) {
        const pt = this._playerTables.get(pid);
        players.push(pt ? this._materializePlayer(pid, pt) : { id: pid, username: pid, avatarId: "👤", isAI: false });
      }
    }
    const aiPlayers = [];
    for (let i = 0; i < aiPlayerCount; i++) {
      const aid = table.decodeString(`ai:${i}`);
      if (aid) {
        const at = this._aiTables.find(t => t.decodeString("id") === aid);
        aiPlayers.push(at ? this._materializePlayer(aid, at) : { id: aid, username: aid, avatarId: "🤖", isAI: true });
      }
    }

    const statusMap = { 0: "waiting", 1: "starting", 2: "playing", 3: "ended" };
    return {
      id: table.decodeString("id") || "",
      code: table.decodeString("code") || code,
      hostId: table.decodeString("hostId") || "",
      gameId: table.decodeString("gameId") || "",
      mode: table.decodeString("mode") || "RANDOM",
      players,
      aiPlayers,
      maxPlayers: Math.round(table.decode("maxPlayers") || 4),
      minPlayers: Math.round(table.decode("minPlayers") || 2),
      status: statusMap[Math.round(table.decode("status") || 0)] || "waiting",
      settings: { aiDifficulty: table.decodeString("aiDifficulty") || "medium" },
    };
  },

  joinRoom(playerId, code) {
    const table = this._roomTables.get(code);
    const playerTable = this._playerTables.get(playerId);

    if (!table) return { success: false, error: "Room not found" };
    if (!playerTable) return { success: false, error: "Player not found" };

    const status = Math.round(table.decode("status") || -1);
    if (status !== 0) return { success: false, error: "Game already started" };

    const playerCount = Math.round(table.decode("playerCount") || 0);
    const maxPlayers = Math.round(table.decode("maxPlayers") || 0);
    if (playerCount >= maxPlayers) return { success: false, error: "Room is full" };

    table.encodeString(`player:${playerCount}`, playerId);
    table.encode("playerCount", playerCount + 1, HELIX.LINE);

    playerTable.encodeString("currentRoom", code);
    playerTable.encode("status", 1, HELIX.VOID);

    this._checkAutoStart(code);

    const room = this._materializeRoom(code, table);
    return { success: true, room };
  },

  _checkAutoStart(code) {
    const table = this._roomTables.get(code);
    if (!table) return;
    const playerCount = Math.round(table.decode("playerCount") || 0);
    const aiCount = Math.round(table.decode("aiPlayerCount") || 0);
    const minPlayers = Math.round(table.decode("minPlayers") || 2);
    const status = Math.round(table.decode("status") || 0);
    if ((playerCount + aiCount) >= minPlayers && status === 0) {
      setTimeout(() => this.startGame(code), 1000);
    }
  },

  startGame(code) {
    const table = this._roomTables.get(code);
    if (!table || Math.round(table.decode("status") || -1) !== 0) return { success: false };

    table.encode("status", 2, HELIX.LINE);  // playing

    // Update player statuses
    const playerCount = Math.round(table.decode("playerCount") || 0);
    for (let i = 0; i < playerCount; i++) {
      const pid = table.decodeString(`player:${i}`);
      const pt = this._playerTables.get(pid);
      if (pt) pt.encode("status", 2, HELIX.VOID);  // in_game
    }

    const room = this._materializeRoom(code, table);
    return { success: true, room };
  },

  // ═══════════════════════════════════════════════════════════════════════
  // QUICK ACTIONS
  // ═══════════════════════════════════════════════════════════════════════
  quickMatch(playerId, gameId) {
    for (const [code, table] of this._roomTables) {
      const status = Math.round(table.decode("status") || -1);
      const mode = table.decodeString("mode");
      const gid = table.decodeString("gameId");
      const playerCount = Math.round(table.decode("playerCount") || 0);
      const maxPlayers = Math.round(table.decode("maxPlayers") || 0);
      if (gid === gameId && status === 0 && mode === "RANDOM" && playerCount < maxPlayers) {
        return this.joinRoom(playerId, code);
      }
    }
    return this.createRoom(playerId, gameId, "RANDOM");
  },

  vsAI(playerId, gameId, difficulty = "medium") {
    return this.createRoom(playerId, gameId, "SOLO", { aiDifficulty: difficulty });
  },

  practiceMode(playerId, gameId) {
    return this.createRoom(playerId, gameId, "AI_ONLY", { maxPlayers: 4 });
  },

  leaveRoom(playerId, code) {
    const table = this._roomTables.get(code);
    const playerTable = this._playerTables.get(playerId);
    if (!table || !playerTable) return;

    // Remove player from room
    const playerCount = Math.round(table.decode("playerCount") || 0);
    const remaining = [];
    for (let i = 0; i < playerCount; i++) {
      const pid = table.decodeString(`player:${i}`);
      if (pid && pid !== playerId) remaining.push(pid);
    }

    playerTable.encodeString("currentRoom", "");
    playerTable.encode("status", 0, HELIX.VOID);  // online

    if (remaining.length === 0) {
      // Release AI and delete room
      const aiCount = Math.round(table.decode("aiPlayerCount") || 0);
      const aiIds = [];
      for (let i = 0; i < aiCount; i++) {
        const aid = table.decodeString(`ai:${i}`);
        if (aid) aiIds.push(aid);
      }
      this.releaseAI(aiIds);
      this._roomTables.delete(code);
    } else {
      // Update remaining players
      remaining.forEach((pid, i) => table.encodeString(`player:${i}`, pid));
      table.encode("playerCount", remaining.length, HELIX.LINE);
      // Transfer host if needed
      const hostId = table.decodeString("hostId");
      if (hostId === playerId) {
        table.encodeString("hostId", remaining[0]);
      }
    }
  },

  /** Expose rooms for UI iteration (finite set of addresses) */
  get rooms() {
    const result = new Map();
    for (const [code, table] of this._roomTables) {
      result.set(code, this._materializeRoom(code, table));
    }
    return result;
  },

  /** Expose players for UI (finite set) */
  get players() {
    return this._playerTables;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET CONDUIT — Two-labyrinth client-server bridge
// ═══════════════════════════════════════════════════════════════════════════
//   Labyrinth A (Encode): Client sends deltas to server
//   Labyrinth B (Decode): Server broadcasts arrive and materialize locally
//   When offline: falls back to local-only LobbyManifold operations
// ═══════════════════════════════════════════════════════════════════════════

const SocketConduit = {
  /** @type {WebSocket|null} */
  _ws: null,
  _token: null,
  _connected: false,
  _reconnectTimer: null,
  _serverUrl: null,
  _handlers: {},  // event -> [callbacks]
  _pingInterval: null,

  /**
   * Connect to the manifold server.
   * @param {string} url - WebSocket URL (ws://host:port or wss://host:port)
   */
  connect(url) {
    if (this._ws) this.disconnect();
    this._serverUrl = url;

    try {
      this._ws = new WebSocket(url);
    } catch (e) {
      console.warn('[SocketConduit] WebSocket unavailable, local-only mode');
      return;
    }

    this._ws.onopen = () => {
      this._connected = true;
      console.log('[SocketConduit] Connected to manifold server');
      this._emit('connected');
      // Start heartbeat
      this._pingInterval = setInterval(() => this.send({ t: 'ping' }), 25000);
      // Re-auth if we have a token
      if (this._token) {
        this.send({ t: 'auth', d: { action: 'validate', token: this._token } });
      }
    };

    this._ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._route(msg);
    };

    this._ws.onclose = () => {
      this._connected = false;
      clearInterval(this._pingInterval);
      console.log('[SocketConduit] Disconnected');
      this._emit('disconnected');
      // Auto-reconnect after 3s
      this._reconnectTimer = setTimeout(() => {
        if (this._serverUrl) this.connect(this._serverUrl);
      }, 3000);
    };

    this._ws.onerror = () => { /* onclose will fire */ };
  },

  disconnect() {
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingInterval);
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
    this._connected = false;
  },

  /** Labyrinth A: encode and send */
  send(msg) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  },

  /** Route incoming messages (Labyrinth B: decode) */
  _route(msg) {
    switch (msg.t) {
      case 'welcome':
        this._emit('welcome', msg.d);
        break;
      case 'auth':
        if (msg.d.action === 'registered' || msg.d.action === 'validated') {
          this._token = msg.d.token || this._token;
          this._emit('authenticated', msg.d);
        } else if (msg.d.action === 'invalid') {
          this._token = null;
          this._emit('auth_invalid');
        }
        break;
      case 'room':
        this._emit('room', msg.d);
        break;
      case 'delta':
        this._emit('delta', msg.d);
        break;
      case 'signal':
        this._emit('signal', msg.d);
        break;
      case 'pong':
        // Heartbeat acknowledged
        break;
      case 'error':
        console.warn('[SocketConduit] Server error:', msg.d?.msg);
        this._emit('error', msg.d);
        break;
    }
  },

  // ─── Auth Helpers ───────────────────────────────────────────────────
  register(username, avatarId) {
    return this.send({ t: 'auth', d: { action: 'register', username, avatarId } });
  },

  registerGuest() {
    return this.send({ t: 'auth', d: { action: 'guest' } });
  },

  // ─── Room Helpers ───────────────────────────────────────────────────
  createRoom(gameId, mode, options) {
    return this.send({ t: 'room', d: { action: 'create', gameId, mode, ...options } });
  },

  joinRoom(code) {
    return this.send({ t: 'room', d: { action: 'join', code } });
  },

  leaveRoom() {
    return this.send({ t: 'room', d: { action: 'leave' } });
  },

  listRooms() {
    return this.send({ t: 'room', d: { action: 'list' } });
  },

  startGame() {
    return this.send({ t: 'room', d: { action: 'start' } });
  },

  // ─── Delta Helpers ──────────────────────────────────────────────────
  sendDelta(key, value) {
    return this.send({ t: 'delta', d: { key, value } });
  },

  sendSignal(type, data) {
    return this.send({ t: 'signal', d: { type, ...data } });
  },

  // ─── Event System ───────────────────────────────────────────────────
  on(event, callback) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(callback);
  },

  off(event, callback) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(cb => cb !== callback);
  },

  _emit(event, data) {
    const handlers = this._handlers[event];
    if (handlers) handlers.forEach(cb => cb(data));
  },

  get connected() { return this._connected; },
  get token() { return this._token; },
};

// Export
if (typeof window !== "undefined") {
  window.LobbyManifold = LobbyManifold;
  window.SocketConduit = SocketConduit;
}
if (typeof module !== "undefined") {
  module.exports = { LobbyManifold, SocketConduit };
}

