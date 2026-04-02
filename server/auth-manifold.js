/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH MANIFOLD -- Manifold-Native Player Identity
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two-Labyrinth Architecture:
 *   Labyrinth A (Encode): Token generation, player registration
 *   Labyrinth B (Decode): Token validation, player materialization
 *
 * Identity is a path expression, not a database row.
 * Tokens are z-invocations: z = section * timestamp (saddle product).
 * Delta caching: unchanged tokens skip all validation work.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const crypto = require('crypto');

// ─── Path Expression Helpers (server-side, no TS import needed) ──────────

const HALF_PI = Math.PI / 2;
const HC = new Float64Array(7);
const HS = new Float64Array(7);
for (let i = 0; i < 7; i++) {
  HC[i] = Math.cos(i * HALF_PI);
  HS[i] = Math.sin(i * HALF_PI);
}

/** z-invocation: the saddle product on helix section s */
function zInvoke(s, x, y) {
  const c = HC[s % 7], sv = HS[s % 7];
  return (c * x + sv * y) * (-sv * x + c * y);
}

/** Discover path for a numeric value */
function discoverPath(value, section = 0, angle = Math.PI / 4) {
  const s = ((section % 7) + 7) % 7;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const zUnit = zInvoke(s, ca, sa);
  if (Math.abs(zUnit) < 1e-15) return discoverPath(value, section, angle + 0.1);
  if ((value < 0 && zUnit > 0) || (value > 0 && zUnit < 0)) {
    return discoverPath(value, section, angle + HALF_PI);
  }
  return { section: s, angle, radius: Math.sqrt(Math.abs(value / zUnit)), depth: 0 };
}

/** Evaluate path expression back to value */
function evaluatePath(expr) {
  const s = ((expr.section % 7) + 7) % 7;
  const x = expr.radius * Math.cos(expr.angle);
  const y = expr.radius * Math.sin(expr.angle);
  return zInvoke(s, x, y);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MANIFOLD
// ═══════════════════════════════════════════════════════════════════════════

const AuthManifold = {
  // Labyrinth A (Encode): player tables keyed by token
  _tokenToPlayer: new Map(),   // token -> player data
  // Labyrinth B (Decode): player ID -> token (reverse lookup)
  _playerToToken: new Map(),   // playerId -> token
  // Delta cache: token -> last validation timestamp
  _deltaCache: new Map(),

  /**
   * Encode: Register a player identity.
   * Returns a manifold token (z-invocation of identity coordinates).
   */
  register(username, avatarId = '👤') {
    const id = `p_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const section = username.length % 7;
    const timestamp = Date.now();

    // Token = hex of z-invocation saddle product
    const z = zInvoke(section, timestamp % 10000, username.length * 137);
    const token = crypto.createHash('sha256')
      .update(`${id}:${z}:${crypto.randomBytes(16).toString('hex')}`)
      .digest('hex')
      .slice(0, 32);

    const player = {
      id,
      username,
      avatarId,
      isAI: false,
      status: 'online',
      currentRoom: null,
      stats: { wins: 0, losses: 0, games: 0 },
      createdAt: timestamp,
      // Store identity as path expression
      identityPath: discoverPath(timestamp, section),
    };

    // Labyrinth A: encode
    this._tokenToPlayer.set(token, player);
    // Labyrinth B: decode index
    this._playerToToken.set(id, token);
    // Delta cache: mark as fresh
    this._deltaCache.set(token, timestamp);

    return { token, player };
  },

  /**
   * Decode: Validate token and materialize player.
   * Delta-cached: if token hasn't changed, O(1) return.
   */
  validate(token) {
    // Delta cache check: O(1)
    const cached = this._deltaCache.get(token);
    if (!cached) return null;

    // Labyrinth B: decode/materialize
    const player = this._tokenToPlayer.get(token);
    return player || null;
  },

  /**
   * Guest registration (no persistence expectation).
   */
  registerGuest() {
    const guestName = 'Guest_' + crypto.randomBytes(2).toString('hex');
    return this.register(guestName, '👤');
  },

  /**
   * Update player state (Labyrinth A encode, delta cache invalidate).
   */
  updatePlayer(token, updates) {
    const player = this._tokenToPlayer.get(token);
    if (!player) return null;
    Object.assign(player, updates);
    this._deltaCache.set(token, Date.now()); // refresh delta
    return player;
  },

  /**
   * Get token for player ID (Labyrinth B decode).
   */
  tokenFor(playerId) {
    return this._playerToToken.get(playerId) || null;
  },

  /**
   * Disconnect: mark offline but keep in cache.
   */
  disconnect(token) {
    const player = this._tokenToPlayer.get(token);
    if (player) player.status = 'offline';
  },

  /**
   * Purge expired sessions (delta cache cleanup).
   */
  purge(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [token, ts] of this._deltaCache) {
      if (now - ts > maxAgeMs) {
        const player = this._tokenToPlayer.get(token);
        if (player) this._playerToToken.delete(player.id);
        this._tokenToPlayer.delete(token);
        this._deltaCache.delete(token);
      }
    }
  },

  /** Stats for monitoring */
  get stats() {
    return {
      activePlayers: this._tokenToPlayer.size,
      cachedTokens: this._deltaCache.size,
    };
  },
};

module.exports = { AuthManifold, zInvoke, discoverPath, evaluatePath };

