/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD SOCKET -- Two-Labyrinth WebSocket Core
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gyroid Architecture:
 *   Labyrinth A (Encode): Client writes -> server encodes deltas
 *   Labyrinth B (Decode): Server broadcasts -> clients decode/materialize
 *   Surface: Delta cache between labyrinths (zero-cost sync)
 *
 * Wire Protocol:
 *   All messages are minimal delta packets. No full-state reconstruction.
 *   Format: { t: TYPE, d: DELTA_DATA, r: ROOM_CODE, s: SEQUENCE }
 *
 * Types:
 *   'auth'    - register/validate identity
 *   'room'    - create/join/leave/list rooms
 *   'delta'   - game state delta (path expression changes)
 *   'signal'  - peer signaling (ready, start, chat)
 *   'ping'    - heartbeat (delta cache keepalive)
 *
 * Minimum material. Maximum strength. Maximum surface area.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { AuthManifold } = require('./auth-manifold');

// ─── Room RepTable (server-side, mirrors client LobbyRepTable) ──────────

class RoomTable {
  constructor(code) {
    this.code = code;
    this._d = new Map();  // numeric fields
    this._s = new Map();  // string fields
    this._delta = new Map(); // delta cache: field -> version
    this._version = 0;
  }
  set(key, value) {
    this._d.set(key, value);
    this._delta.set(key, ++this._version);
  }
  get(key) { return this._d.get(key); }
  setString(key, value) {
    this._s.set(key, value);
    this._delta.set(key, ++this._version);
  }
  getString(key) { return this._s.get(key); }
  has(key) { return this._d.has(key) || this._s.has(key); }

  /** Get only fields changed since given version (delta decode) */
  deltasSince(sinceVersion) {
    const deltas = {};
    for (const [key, ver] of this._delta) {
      if (ver > sinceVersion) {
        deltas[key] = this._d.has(key) ? this._d.get(key) : this._s.get(key);
      }
    }
    return { deltas, version: this._version };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MANIFOLD SOCKET CORE
// ═══════════════════════════════════════════════════════════════════════════

const ManifoldSocket = {
  /** @type {Map<string, RoomTable>} room code -> RoomTable */
  _rooms: new Map(),
  /** @type {Map<WebSocket, object>} ws -> connection state */
  _connections: new Map(),
  /** @type {Map<string, Set<WebSocket>>} room code -> set of ws */
  _roomMembers: new Map(),

  AI_NAMES: ['Byte', 'Glitch', 'Pixel', 'Spark', 'Nova', 'Flux', 'Cipher', 'Pulse', 'Drift'],

  // ═══════════════════════════════════════════════════════════════════════
  // CONNECTION LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Handle new WebSocket connection (Labyrinth A entry point).
   */
  onConnection(ws) {
    const connState = {
      token: null,
      player: null,
      room: null,
      lastVersion: 0,    // delta cache: last known version
      lastPing: Date.now(),
      seq: 0,            // message sequence counter
    };
    this._connections.set(ws, connState);

    ws.on('message', (raw) => this._onMessage(ws, raw));
    ws.on('close', () => this._onClose(ws));
    ws.on('error', () => this._onClose(ws));

    // Send welcome with server stats
    this._send(ws, { t: 'welcome', d: { ts: Date.now(), ...AuthManifold.stats } });
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE ROUTER (Labyrinth A -> Surface -> Labyrinth B)
  // ═══════════════════════════════════════════════════════════════════════

  _onMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this._send(ws, { t: 'error', d: { msg: 'Invalid message' } });
    }

    const conn = this._connections.get(ws);
    if (!conn) return;
    conn.seq++;

    // Route by type (geodesic traversal through message topology)
    switch (msg.t) {
      case 'auth':     return this._handleAuth(ws, conn, msg.d);
      case 'room':     return this._handleRoom(ws, conn, msg.d);
      case 'delta':    return this._handleDelta(ws, conn, msg.d);
      case 'signal':   return this._handleSignal(ws, conn, msg.d);
      case 'ping':     return this._handlePing(ws, conn);
      default:         return this._send(ws, { t: 'error', d: { msg: 'Unknown type' } });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH (Labyrinth A: encode identity)
  // ═══════════════════════════════════════════════════════════════════════

  _handleAuth(ws, conn, data) {
    if (!data) return this._send(ws, { t: 'error', d: { msg: 'Missing auth data' } });

    if (data.action === 'register') {
      const { token, player } = AuthManifold.register(data.username, data.avatarId);
      conn.token = token;
      conn.player = player;
      this._send(ws, { t: 'auth', d: { action: 'registered', token, player } });
    } else if (data.action === 'guest') {
      const { token, player } = AuthManifold.registerGuest();
      conn.token = token;
      conn.player = player;
      this._send(ws, { t: 'auth', d: { action: 'registered', token, player } });
    } else if (data.action === 'validate') {
      const player = AuthManifold.validate(data.token);
      if (player) {
        conn.token = data.token;
        conn.player = player;
        this._send(ws, { t: 'auth', d: { action: 'validated', player } });
      } else {
        this._send(ws, { t: 'auth', d: { action: 'invalid' } });
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ROOM MANAGEMENT (Labyrinth A: encode room state)
  // ═══════════════════════════════════════════════════════════════════════

  _handleRoom(ws, conn, data) {
    if (!conn.player) return this._send(ws, { t: 'error', d: { msg: 'Not authenticated' } });
    if (!data) return this._send(ws, { t: 'error', d: { msg: 'Missing room data' } });

    switch (data.action) {
      case 'create': return this._createRoom(ws, conn, data);
      case 'join':   return this._joinRoom(ws, conn, data);
      case 'leave':  return this._leaveRoom(ws, conn);
      case 'list':   return this._listRooms(ws, conn);
      case 'start':  return this._startGame(ws, conn);
      default:       return this._send(ws, { t: 'error', d: { msg: 'Unknown room action' } });
    }
  },

  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return this._rooms.has(code) ? this._generateCode() : code;
  },

  _createRoom(ws, conn, data) {
    const code = this._generateCode();
    const table = new RoomTable(code);

    table.setString('id', `room_${Date.now().toString(36)}`);
    table.setString('code', code);
    table.setString('hostId', conn.player.id);
    table.setString('gameId', data.gameId || 'fasttrack');
    table.setString('mode', data.mode || 'RANDOM');
    table.set('maxPlayers', data.maxPlayers || 4);
    table.set('minPlayers', data.minPlayers || 2);
    table.set('status', 0); // 0=waiting
    table.set('playerCount', 1);
    table.set('aiPlayerCount', 0);
    table.setString('player:0', conn.player.id);
    table.setString('aiDifficulty', data.aiDifficulty || 'medium');

    // Add AI if solo/ai_only mode
    const aiPlayers = [];
    if (data.mode === 'SOLO' || data.mode === 'AI_ONLY') {
      const aiCount = (data.maxPlayers || 4) - 1;
      for (let i = 0; i < aiCount && i < this.AI_NAMES.length; i++) {
        const ai = { id: `ai_${i}`, username: this.AI_NAMES[i], avatarId: '🤖', isAI: true };
        table.setString(`ai:${i}`, ai.id);
        aiPlayers.push(ai);
      }
      table.set('aiPlayerCount', aiPlayers.length);
    }

    this._rooms.set(code, table);
    this._roomMembers.set(code, new Set([ws]));

    conn.room = code;
    conn.lastVersion = table._version;
    conn.player.currentRoom = code;

    const room = this._materializeRoom(code, table);
    this._send(ws, { t: 'room', d: { action: 'created', room, code } });
  },

  _joinRoom(ws, conn, data) {
    if (!data.code) return this._send(ws, { t: 'error', d: { msg: 'Missing room code' } });
    const code = data.code.toUpperCase();
    const table = this._rooms.get(code);
    if (!table) return this._send(ws, { t: 'room', d: { action: 'not_found' } });
    if (table.get('status') !== 0) return this._send(ws, { t: 'room', d: { action: 'already_started' } });

    const count = table.get('playerCount');
    const max = table.get('maxPlayers');
    if (count >= max) return this._send(ws, { t: 'room', d: { action: 'full' } });

    // Leave current room if in one
    if (conn.room) this._leaveRoom(ws, conn);

    // Encode player into room table
    table.setString(`player:${count}`, conn.player.id);
    table.set('playerCount', count + 1);

    this._roomMembers.get(code).add(ws);
    conn.room = code;
    conn.lastVersion = table._version;
    conn.player.currentRoom = code;

    const room = this._materializeRoom(code, table);
    // Broadcast to all in room (Labyrinth B decode)
    this._broadcast(code, { t: 'room', d: { action: 'player_joined', room, playerId: conn.player.id, player: conn.player } });
  },

  _leaveRoom(ws, conn) {
    const code = conn.room;
    if (!code) return;
    const table = this._rooms.get(code);
    const members = this._roomMembers.get(code);

    if (members) members.delete(ws);
    conn.room = null;
    if (conn.player) conn.player.currentRoom = null;

    if (!table) return;

    // Compact player slots in room table
    const count = table.get('playerCount');
    let found = false;
    for (let i = 0; i < count; i++) {
      if (table.getString(`player:${i}`) === conn.player.id) {
        found = true;
      }
      if (found && i < count - 1) {
        table.setString(`player:${i}`, table.getString(`player:${i + 1}`));
      }
    }
    if (found) {
      table.set('playerCount', count - 1);
      table.setString(`player:${count - 1}`, '');
    }

    // If room empty, destroy it
    if (!members || members.size === 0) {
      this._rooms.delete(code);
      this._roomMembers.delete(code);
      return;
    }

    // Transfer host if host left
    if (table.getString('hostId') === conn.player.id && table.get('playerCount') > 0) {
      table.setString('hostId', table.getString('player:0'));
    }

    const room = this._materializeRoom(code, table);
    this._broadcast(code, { t: 'room', d: { action: 'player_left', room, playerId: conn.player.id } });
  },

  _listRooms(ws, conn) {
    const rooms = [];
    for (const [code, table] of this._rooms) {
      if (table.get('status') === 0) { // only waiting rooms
        rooms.push(this._materializeRoom(code, table));
      }
    }
    this._send(ws, { t: 'room', d: { action: 'list', rooms } });
  },

  _startGame(ws, conn) {
    const code = conn.room;
    if (!code) return this._send(ws, { t: 'error', d: { msg: 'Not in a room' } });
    const table = this._rooms.get(code);
    if (!table) return;
    if (table.getString('hostId') !== conn.player.id) {
      return this._send(ws, { t: 'error', d: { msg: 'Only host can start' } });
    }
    table.set('status', 1); // 1=playing
    const room = this._materializeRoom(code, table);
    this._broadcast(code, { t: 'room', d: { action: 'game_started', room } });
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DELTA RELAY (Surface: the minimal interface between labyrinths)
  // ═══════════════════════════════════════════════════════════════════════

  _handleDelta(ws, conn, data) {
    const code = conn.room;
    if (!code) return this._send(ws, { t: 'error', d: { msg: 'Not in a room' } });
    if (!data) return;

    // Labyrinth A: encode the delta into the room's surface cache
    const table = this._rooms.get(code);
    if (table && data.key !== undefined) {
      if (typeof data.value === 'string') {
        table.setString(data.key, data.value);
      } else if (data.value !== undefined) {
        table.set(data.key, data.value);
      }
    }

    // Labyrinth B: broadcast delta to all OTHER members (chiral: encode ≠ decode)
    const members = this._roomMembers.get(code);
    if (!members) return;
    const packet = JSON.stringify({ t: 'delta', d: data, s: conn.seq });
    for (const peer of members) {
      if (peer !== ws && peer.readyState === 1) {
        peer.send(packet);
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SIGNAL (peer-to-peer signals: ready, chat, custom)
  // ═══════════════════════════════════════════════════════════════════════

  _handleSignal(ws, conn, data) {
    const code = conn.room;
    if (!code || !data) return;

    // Relay signal to all room members including sender (everyone sees signals)
    this._broadcast(code, {
      t: 'signal',
      d: { ...data, from: conn.player ? conn.player.id : null },
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  // HEARTBEAT (delta cache keepalive)
  // ═══════════════════════════════════════════════════════════════════════

  _handlePing(ws, conn) {
    conn.lastPing = Date.now();
    this._send(ws, { t: 'pong', d: { ts: Date.now() } });
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DISCONNECT (Labyrinth A cleanup)
  // ═══════════════════════════════════════════════════════════════════════

  _onClose(ws) {
    const conn = this._connections.get(ws);
    if (!conn) return;

    // Leave room
    if (conn.room) this._leaveRoom(ws, conn);

    // Mark offline in auth
    if (conn.token) AuthManifold.disconnect(conn.token);

    this._connections.delete(ws);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /** Materialize a RoomTable into a plain object (Labyrinth B: decode) */
  _materializeRoom(code, table) {
    const players = [];
    const count = table.get('playerCount') || 0;
    for (let i = 0; i < count; i++) {
      const pid = table.getString(`player:${i}`);
      if (pid) {
        // Find player data from auth
        const token = AuthManifold.tokenFor(pid);
        const player = token ? AuthManifold.validate(token) : null;
        players.push(player || { id: pid, username: pid, avatarId: '👤' });
      }
    }
    const aiPlayers = [];
    const aiCount = table.get('aiPlayerCount') || 0;
    for (let i = 0; i < aiCount; i++) {
      const aiId = table.getString(`ai:${i}`);
      if (aiId) {
        const idx = parseInt(aiId.split('_')[1]) || i;
        aiPlayers.push({ id: aiId, username: this.AI_NAMES[idx] || `Bot_${i}`, avatarId: '🤖', isAI: true });
      }
    }

    return {
      code,
      id: table.getString('id'),
      hostId: table.getString('hostId'),
      gameId: table.getString('gameId'),
      mode: table.getString('mode'),
      maxPlayers: table.get('maxPlayers'),
      minPlayers: table.get('minPlayers'),
      status: table.get('status'),
      players,
      aiPlayers,
      aiDifficulty: table.getString('aiDifficulty'),
      version: table._version,
    };
  },

  /** Send to one client (Labyrinth B: decode to wire) */
  _send(ws, msg) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  },

  /** Broadcast to all in room (Labyrinth B: decode to all) */
  _broadcast(code, msg) {
    const members = this._roomMembers.get(code);
    if (!members) return;
    const packet = JSON.stringify(msg);
    for (const ws of members) {
      if (ws.readyState === 1) ws.send(packet);
    }
  },

  /** Server stats for monitoring */
  get stats() {
    return {
      connections: this._connections.size,
      rooms: this._rooms.size,
      auth: AuthManifold.stats,
    };
  },
};

module.exports = { ManifoldSocket, RoomTable };

