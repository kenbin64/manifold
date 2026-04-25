/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KENSGAMES UNIFIED GAME SERVER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WebSocket server for ALL games: FastTrack, BrickBreaker3D, Starfighter,
 * ConnectIV, SwartzDiamond, and future titles.
 *
 * Listens on port 8765 — nginx proxies wss://kensgames.com/ws here.
 *
 * Features:
 *   - Game-agnostic session management (game_id on every session)
 *   - Invite codes that resolve to the correct game automatically
 *   - Real-time state relay for action games (Starfighter, BrickBreaker)
 *   - Turn-based state relay for board games (FastTrack, ConnectIV)
 *   - Matchmaking by game type
 *   - Guest + authenticated auth
 *   - AI bot slots
 *   - Chat + guilds
 *
 * Protocol: JSON over WebSocket. Every message has { type: '...' }.
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const AuthHandler = require('./auth-handler');

// ── Match server (authoritative game state, dimensional `x`-style) ──
// Optional TetracubeDB persistence: only enabled when env credentials present.
let _tcube = null;
try {
  if (process.env.TETRACUBE_CLIENT_ID && process.env.TETRACUBE_API_KEY) {
    const TetracubeClient = require('../../../tetracubedb/client/tetracube_client');
    _tcube = new TetracubeClient({
      url: process.env.TETRACUBE_URL || 'https://tetracubedb.com',
      clientId: process.env.TETRACUBE_CLIENT_ID,
      apiKey: process.env.TETRACUBE_API_KEY,
      namespace: process.env.TETRACUBE_NAMESPACE || 'kensgames',
    });
    console.log('[Lobby] TetracubeDB persistence enabled');
  } else {
    console.log('[Lobby] TetracubeDB persistence disabled (no credentials in env)');
  }
} catch (e) {
  console.warn('[Lobby] TetracubeDB client load failed:', e.message);
}
const matchServer = require('./match-server')({
  tetracube: _tcube,
  namespace: 'kensgames',
  log: (...a) => console.log('[match]', ...a),
});

const PORT = 8765;

const authHandler = new AuthHandler();

function stableGuestIdFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (!token.startsWith('guest-')) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `guest_${hash.slice(0, 16)}`;
}

function postAuthSendSessionState(ws, userId) {
  if (!userId) return;
  const session = findSessionByPlayer(userId);
  if (!session) return;

  // Mark the player back online — they may have been flagged offline by
  // a previous disconnect (browser refresh, tab switch, network blip).
  const player = session.players.find(p => p.user_id === userId);
  if (player) {
    player.online = true;
    delete player.disconnected_at;
  }

  // Unified clients expect a session_update to hydrate UI.
  send(ws, { type: 'session_update', session: sanitizeSession(session), action: 'resume' });
  if (session.status === 'playing') {
    send(ws, { type: 'game_started', session: sanitizeSession(session) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory state
// ═══════════════════════════════════════════════════════════════════════════

const users = new Map();       // oddddd oddddd user_id → { user_id, username, password_hash, ... }
const sessions = new Map();    // session_id → { session_id, session_code, host_id, players, ... }
const codeIndex = new Map();   // 6-char code → session_id
const connections = new Map(); // ws → { user_id, user }
const launchObjects = new Map(); // launch_id → signed launch object envelope
const guestAnchors = new Map(); // guest_token → { guest_id, username, avatar_id, ip_hash, ua_hash, expires_at }
const guestAnchorRate = new Map(); // ip_hash → [timestamps within the rate window]

let nextUserId = 1;
let nextSessionId = 1;

const LAUNCH_OBJECT_TTL_MS = 20 * 60 * 1000; // 20 minutes
const GUEST_ANCHOR_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const GUEST_ANCHOR_RATE_LIMIT = 10; // requests per IP per window
const GUEST_ANCHOR_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const LAUNCH_SIGNING_SECRET = process.env.LOBBY_LAUNCH_SECRET
  || process.env.JWT_SECRET
  || 'dev-launch-secret-change-in-production';

// ── disk persistence for sessions/codeIndex ───────────────────────────────
// kensgames-lobby is a separate PM2 process; without disk persistence every
// restart wipes all in-flight invite codes ("Invalid game code" for joiners).
const _fsLP = require('fs');
const _pathLP = require('path');
const LOBBY_SESSIONS_FILE = process.env.LOBBY_SESSIONS_FILE
  || _pathLP.join(__dirname, 'data', 'lobby-sessions.json');
const LOBBY_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4h — generous; expired entries skipped on load

try { _fsLP.mkdirSync(_pathLP.dirname(LOBBY_SESSIONS_FILE), { recursive: true }); } catch (_) { }

// Restore on boot
try {
  if (_fsLP.existsSync(LOBBY_SESSIONS_FILE)) {
    const raw = _fsLP.readFileSync(LOBBY_SESSIONS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    let restored = 0;
    for (const sess of Object.values(parsed.sessions || {})) {
      if (!sess || typeof sess !== 'object' || !sess.session_id) continue;
      if (sess.created_at && (now - sess.created_at) > LOBBY_SESSION_TTL_MS) continue;
      // Mark all previously-connected players as offline; they must reconnect.
      if (Array.isArray(sess.players)) {
        for (const p of sess.players) { if (p) p.online = false; }
      }
      sessions.set(sess.session_id, sess);
      if (sess.session_code) codeIndex.set(sess.session_code, sess.session_id);
      restored++;
    }
    if (restored > 0) console.log(`[lobby] restored ${restored} session(s) from ${LOBBY_SESSIONS_FILE}`);
  }
} catch (err) {
  console.warn('[lobby] failed to load sessions from disk:', err.message);
}

let _lobbyLastSer = '';
function _flushLobbySessions() {
  try {
    const dump = { sessions: {} };
    for (const [id, s] of sessions.entries()) {
      // Strip transient/non-serialisable fields if present.
      const { ws: _ws, _ws: _ws2, ...safe } = s || {};
      dump.sessions[id] = safe;
    }
    const ser = JSON.stringify(dump);
    if (ser === _lobbyLastSer) return;
    const tmp = `${LOBBY_SESSIONS_FILE}.tmp`;
    _fsLP.writeFileSync(tmp, ser);
    _fsLP.renameSync(tmp, LOBBY_SESSIONS_FILE);
    _lobbyLastSer = ser;
  } catch (err) {
    console.warn('[lobby] sessions flush failed:', err.message);
  }
}
const _lobbyFlushTimer = setInterval(_flushLobbySessions, 1500);
if (typeof _lobbyFlushTimer.unref === 'function') _lobbyFlushTimer.unref();
process.once('SIGINT', _flushLobbySessions);
process.once('SIGTERM', _flushLobbySessions);
process.once('beforeExit', _flushLobbySessions);

// AI name pool
const AI_NAMES = [
  'Bot Alpha', 'Bot Bravo', 'Bot Charlie', 'Bot Delta',
  'Bot Echo', 'Bot Sierra', 'Bot Tango', 'Bot Whiskey'
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness
  if (codeIndex.has(code)) return generateCode();
  return code;
}

// Call the auth API server (port 3000)
function authApiRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('Invalid JSON from auth API')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Auth API timeout')); });
    req.write(payload);
    req.end();
  });
}

function authApiValidateToken(token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/auth/validate',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('Invalid JSON from auth validate')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Auth validate timeout')); });
    req.end();
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function hmacLaunchSig(launchId, launchHash, expiresAt) {
  return crypto
    .createHmac('sha256', LAUNCH_SIGNING_SECRET)
    .update(`${launchId}:${launchHash}:${expiresAt}`)
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sanitizeExtraParams(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k || typeof k !== 'string') continue;
    if (typeof v === 'string') out[k.slice(0, 64)] = v.slice(0, 256);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k.slice(0, 64)] = v;
  }
  return out;
}

function buildLaunchObjectEnvelope(session, authUserId, reqBody, req) {
  const now = Date.now();
  const launchId = generateId('launch');
  const expiresAt = now + LAUNCH_OBJECT_TTL_MS;
  const requesterLobbyUserId = `user_${authUserId}`;
  const players = (session.players || []).map((p) => ({
    user_id: p.user_id,
    username: p.username,
    avatar_id: p.avatar_id,
    is_host: !!p.is_host,
    is_ai: !!p.is_ai,
    ready: !!p.ready,
    slot: Number(p.slot) || 0,
  }));
  const bots = players.filter((p) => p.is_ai).length;
  const humanPlayers = players.filter((p) => !p.is_ai).length;
  const forwardedFor = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';
  const extraParams = sanitizeExtraParams(reqBody && reqBody.extra_params);

  const launchObject = {
    launch_id: launchId,
    game_id: session.game_id || 'fasttrack',
    mode: 'multi',
    session_id: session.session_id,
    code: session.session_code,
    match_id: (reqBody && reqBody.match_id) || session.match_id || null,
    host_id: session.host_id,
    host_username: session.host_username,
    players,
    player_count: players.length,
    human_players: humanPlayers,
    bots,
    max_players: Number(session.max_players) || players.length,
    status: session.status || 'waiting',
    settings: session.settings || {},
    authorization: {
      requested_by: requesterLobbyUserId,
      requested_by_auth_user_id: String(authUserId),
      auth_hash: sha256Hex(`${session.session_id}:${requesterLobbyUserId}:${session.session_code}:${LAUNCH_SIGNING_SECRET}`),
      ip_hash: sha256Hex(forwardedFor),
      user_agent_hash: sha256Hex(userAgent),
    },
    extra_params: extraParams,
    created_at: now,
    expires_at: expiresAt,
  };

  const launchHash = sha256Hex(JSON.stringify(launchObject));
  const sig = hmacLaunchSig(launchId, launchHash, expiresAt);
  const envelope = {
    launch_id: launchId,
    launch_hash: launchHash,
    sig,
    created_at: now,
    expires_at: expiresAt,
    launch: launchObject,
  };
  launchObjects.set(launchId, envelope);
  return envelope;
}

// ── Guest anchor (x_1 in higher plane for unauthenticated invitees) ──────
// A guest anchor binds a user-chosen username + avatar to a server-minted
// guest_id, signed via HMAC. The guest_token returned is accepted by
// /ws/launch-object the same way a Bearer JWT is, but namespace-isolated
// (guest_id, never user_id) so guests cannot impersonate registered players.

function sanitizeAnchorString(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max || 64);
}

function guestAnchorRateLimitOk(ipHash) {
  const now = Date.now();
  const cutoff = now - GUEST_ANCHOR_RATE_WINDOW_MS;
  const arr = guestAnchorRate.get(ipHash) || [];
  const fresh = arr.filter((t) => t > cutoff);
  fresh.push(now);
  guestAnchorRate.set(ipHash, fresh);
  return fresh.length <= GUEST_ANCHOR_RATE_LIMIT;
}

function mintGuestAnchor(username, avatarId, req) {
  const cleanName = sanitizeAnchorString(username, 32);
  const cleanAvatar = sanitizeAnchorString(avatarId, 64);
  if (!cleanName) return { error: 'username required' };
  const forwardedFor = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';
  const ipHash = sha256Hex(forwardedFor);
  if (!guestAnchorRateLimitOk(ipHash)) return { error: 'Rate limit exceeded' };

  const now = Date.now();
  const expiresAt = now + GUEST_ANCHOR_TTL_MS;
  const guestId = `guest_${crypto.randomBytes(16).toString('hex')}`;
  const tokenSeed = crypto.randomBytes(24).toString('hex');
  const guestToken = `guest-${guestId.slice(6)}-${tokenSeed}`;
  const anchor = {
    guest_id: guestId,
    guest_token: guestToken,
    username: cleanName,
    avatar_id: cleanAvatar,
    ip_hash: ipHash,
    user_agent_hash: sha256Hex(userAgent),
    created_at: now,
    expires_at: expiresAt,
  };
  guestAnchors.set(guestToken, anchor);
  return { anchor };
}

function validateGuestToken(token) {
  if (!token || typeof token !== 'string') return null;
  const anchor = guestAnchors.get(token);
  if (!anchor) return null;
  if (Date.now() > anchor.expires_at) {
    guestAnchors.delete(token);
    return null;
  }
  return anchor;
}

// ── Solo launch envelope (no lobby session, single player + optional bots) ──
function buildSoloLaunchEnvelope(identity, reqBody, req) {
  const now = Date.now();
  const launchId = generateId('launch');
  const expiresAt = now + LAUNCH_OBJECT_TTL_MS;
  const gameId = sanitizeAnchorString(reqBody && reqBody.game_id, 32) || 'fasttrack';
  const extraParams = sanitizeExtraParams(reqBody && reqBody.extra_params);
  const forwardedFor = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  const humanPlayer = {
    user_id: identity.user_id,
    username: identity.username,
    avatar_id: identity.avatar_id,
    is_host: true,
    is_ai: false,
    ready: true,
    slot: 0,
  };
  const botCount = Math.max(0, Math.min(7, Number(extraParams.bots) || 0));
  const aiLevel = sanitizeAnchorString(extraParams.ai_level, 16) || 'normal';
  const players = [humanPlayer];
  for (let i = 0; i < botCount; i++) {
    players.push({
      user_id: `bot_${launchId}_${i}`,
      username: AI_NAMES[i % AI_NAMES.length],
      avatar_id: '🤖',
      is_host: false,
      is_ai: true,
      ai_level: aiLevel,
      ready: true,
      slot: i + 1,
    });
  }

  const launchObject = {
    launch_id: launchId,
    game_id: gameId,
    mode: 'solo',
    session_id: null,
    code: null,
    match_id: null,
    host_id: identity.user_id,
    host_username: identity.username,
    players,
    player_count: players.length,
    human_players: 1,
    bots: botCount,
    max_players: players.length,
    status: 'playing',
    settings: {},
    authorization: {
      requested_by: identity.user_id,
      requested_by_auth_user_id: identity.auth_user_id || null,
      identity_kind: identity.kind,
      auth_hash: sha256Hex(`${launchId}:${identity.user_id}:${gameId}:${LAUNCH_SIGNING_SECRET}`),
      ip_hash: sha256Hex(forwardedFor),
      user_agent_hash: sha256Hex(userAgent),
    },
    extra_params: extraParams,
    created_at: now,
    expires_at: expiresAt,
  };

  const launchHash = sha256Hex(JSON.stringify(launchObject));
  const sig = hmacLaunchSig(launchId, launchHash, expiresAt);
  const envelope = {
    launch_id: launchId,
    launch_hash: launchHash,
    sig,
    created_at: now,
    expires_at: expiresAt,
    launch: launchObject,
  };
  launchObjects.set(launchId, envelope);
  return envelope;
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(sessionId, data, excludeWs) {
  const session = sessions.get(sessionId);
  if (!session) return;
  for (const [ws, conn] of connections) {
    if (ws === excludeWs) continue;
    if (session.players.some(p => p.user_id === conn.user_id)) {
      send(ws, data);
    }
  }
}

function broadcastAll(data) {
  for (const [ws] of connections) {
    send(ws, data);
  }
}

function getWsByUserId(userId) {
  for (const [ws, conn] of connections) {
    if (conn.user_id === userId) return ws;
  }
  return null;
}

// ── Registered game types ──
const GAME_REGISTRY = {
  // Standard entry point: every game uses game.html as canonical
  fasttrack: { name: 'Fast Track', path: '/fasttrack/game.html', lobby: '/play/?game=fasttrack', maxPlayers: 6, type: 'turn' },
  brickbreaker3d: { name: 'BrickBreaker 3D', path: '/brickbreaker3d/game.html', lobby: '/play/?game=brickbreaker3d', maxPlayers: 4, type: 'realtime' },
  brickbreaker: { name: 'BrickBreaker 3D', path: '/brickbreaker3d/game.html', lobby: '/play/?game=brickbreaker3d', maxPlayers: 4, type: 'realtime' }, // legacy alias
  starfighter: { name: 'Starfighter', path: '/starfighter/', lobby: '/play/?game=starfighter', maxPlayers: 6, type: 'realtime' },
  assemble: { name: 'Assemble', path: '/assemble/game.html', lobby: '/play/?game=assemble', maxPlayers: 4, type: 'realtime' },
  '4dconnect': { name: '4D Connect', path: '/4dconnect/game.html', lobby: '/play/?game=4dconnect', maxPlayers: 2, type: 'turn' },
  chomp: { name: 'Chomp! Wally', path: '/chomp/game.html', lobby: '/play/?game=chomp', maxPlayers: 1, type: 'solo' },
  connectiv: { name: 'ConnectIV', path: '/connectiv/index.html', lobby: '/connectiv/lobby.html', maxPlayers: 2, type: 'turn' },
  swartzdia: { name: 'Swartz Diamond', path: '/swartzdia/index.html', lobby: '/swartzdia/lobby.html', maxPlayers: 4, type: 'turn' },
  cubemarble: { name: 'Cube Marble', path: '/cubemarble/index.html', lobby: '/cubemarble/lobby.html', maxPlayers: 4, type: 'turn' },
  tictactoe: { name: '4D Connect', path: '/4dconnect/game.html', lobby: '/play/?game=4dconnect', maxPlayers: 2, type: 'turn' }, // legacy alias
  '4dtictactoe': { name: '4D Connect', path: '/4dconnect/game.html', lobby: '/play/?game=4dconnect', maxPlayers: 2, type: 'turn' }, // legacy alias -> 4dconnect
};

function resetLobbyAcceptance(session) {
  if (!session) return;
  if (!session.settings) session.settings = {};
  session.settings.lobby_accepted = false;
}

function broadcastSessionUpdate(session, extra) {
  if (!session) return;
  broadcast(session.session_id, { type: 'session_update', session: sanitizeSession(session), ...(extra || {}) });
}

function getPublicSessions(gameId) {
  const result = [];
  for (const [, session] of sessions) {
    if (session.status !== 'waiting') continue;
    if (session.is_private) continue;
    if (gameId && session.game_id !== gameId) continue; // filter by game
    result.push(sanitizeSession(session));
  }
  return result;
}

function sanitizeSession(s) {
  return {
    session_id: s.session_id,
    session_code: s.session_code,
    game_id: s.game_id || 'fasttrack',
    game_name: (GAME_REGISTRY[s.game_id] || {}).name || s.game_id,
    host_id: s.host_id,
    host_username: s.host_username,
    is_private: s.is_private,
    max_players: s.max_players,
    player_count: s.players.length,
    players: s.players.map(p => ({
      user_id: p.user_id,
      username: p.username,
      avatar_id: p.avatar_id,
      is_host: p.is_host,
      is_ai: p.is_ai,
      slot: p.slot,
      ready: p.ready
    })),
    settings: s.settings,
    status: s.status,
    match_id: s.match_id || null,
  };
}

function findSessionByPlayer(userId) {
  for (const [, session] of sessions) {
    if (session.players.some(p => p.user_id === userId)) {
      return session;
    }
  }
  return null;
}

function removePlayerFromSession(userId) {
  const session = findSessionByPlayer(userId);
  if (!session) return null;

  session.players = session.players.filter(p => p.user_id !== userId);

  // Re-index slots
  session.players.forEach((p, i) => { p.slot = i; });

  // If empty or host left, clean up
  if (session.players.length === 0 || (session.host_id === userId && session.players.filter(p => !p.is_ai).length === 0)) {
    sessions.delete(session.session_id);
    codeIndex.delete(session.session_code);
    broadcastAll({ type: 'lobby_update', action: 'session_removed', session_id: session.session_id });
    return session;
  }

  // Transfer host if needed
  if (session.host_id === userId) {
    const newHost = session.players.find(p => !p.is_ai);
    if (newHost) {
      session.host_id = newHost.user_id;
      session.host_username = newHost.username;
      newHost.is_host = true;
    }
  }

  return session;
}

// ═══════════════════════════════════════════════════════════════════════════
// Message handlers
// ═══════════════════════════════════════════════════════════════════════════

const handlers = {};

handlers.ping = (ws) => {
  send(ws, { type: 'pong' });
};

// Portal home page — real-time online count. No auth required.
// Count only authenticated, non-guest users (one per distinct user_id).
handlers.get_portal_stats = (ws) => {
  const authedUsers = new Set();
  for (const conn of connections.values()) {
    const uid = conn && conn.user_id;
    if (!uid) continue;
    if (typeof uid === 'string' && uid.startsWith('guest-')) continue;
    authedUsers.add(uid);
  }
  send(ws, {
    type: 'portal_stats',
    online: authedUsers.size,
    active_sessions: sessions.size
  });
};

// Some join flows send this when the user hits Cancel on a join spinner.
// We don't currently keep a pending-approval queue, so this is a no-op.
handlers.cancel_join_request = () => { };

// --- Unified auth (KGMultiplayer) ---
// Accepts { token, username, guest_name, avatar_id }
// - token missing OR token starts with "guest-" → guest_login
// - otherwise validate JWT via Auth API and treat as signed-in user
handlers.auth = async (ws, data) => {
  const token = data && data.token ? String(data.token) : '';
  const username = (data && (data.username || data.guest_name)) ? String(data.username || data.guest_name) : 'Guest';
  const avatarId = (data && data.avatar_id) ? String(data.avatar_id) : (data && data.avatarId) ? String(data.avatarId) : null;

  // Multiplayer flows require a signed-in account identity.
  if (!token || token.startsWith('guest-')) {
    send(ws, { type: 'error', message: 'Sign in required for multiplayer and lobby actions' });
    return;
  }

  // Signed-in path (validate token)
  try {
    const res = await authApiValidateToken(token);
    if (res.status !== 200 || !res.body || !res.body.valid) {
      send(ws, { type: 'error', message: 'Session expired. Please sign in again.' });
      return;
    }

    if (res.body.profileSetup !== true) {
      send(ws, { type: 'error', message: 'Complete profile setup before joining multiplayer' });
      return;
    }

    const userId = `user_${res.body.userId}`;
    const user = {
      user_id: userId,
      id: userId,
      username: (res.body.playername || username).slice(0, 20),
      avatar_id: res.body.avatarId || avatarId || 'person_smile',
      is_guest: false,
      profileSetup: res.body.profileSetup === true,
      prestige_level: 'bronze',
      prestige_points: 0,
      games_played: 0,
      games_won: 0,
      guild_id: null
    };

    connections.set(ws, { user_id: userId, user });
    send(ws, { type: 'auth_success', action: 'token_auth', user, user_id: user.user_id, username: user.username });
    postAuthSendSessionState(ws, userId);
  } catch (e) {
    console.error('[Lobby] Auth validate error:', e.message);
    send(ws, { type: 'error', message: 'Authentication unavailable. Please try again.' });
    return;
  }
};

// --- Auth ---

handlers.guest_login = (ws, data) => {
  const stableId = stableGuestIdFromToken(data && data.token ? String(data.token) : '');
  const userId = stableId || generateId('guest');
  const username = (data.name || `Guest_${Math.random().toString(36).slice(2, 6)}`).slice(0, 20);
  const avatarId = data.avatar_id || 'person_smile';

  const user = {
    user_id: userId,
    id: userId,
    username,
    avatar_id: avatarId,
    is_guest: true,
    prestige_level: 'bronze',
    prestige_points: 0,
    games_played: 0,
    games_won: 0,
    guild_id: null
  };

  connections.set(ws, { user_id: userId, user });

  send(ws, {
    type: 'auth_success',
    action: 'guest_login',
    user,
    user_id: user.user_id,
    username: user.username
  });

  postAuthSendSessionState(ws, userId);
};

handlers.login = async (ws, data) => {
  const { username, password } = data;
  if (!username || !password) {
    send(ws, { type: 'error', message: 'Username and password required' });
    return;
  }

  try {
    const res = await authApiRequest('/api/auth/login', { username, password });
    if (res.body.success) {
      const userId = `user_${res.body.userId}`;
      const user = {
        user_id: userId,
        id: userId,
        username: res.body.username || username,
        avatar_id: 'person_smile',
        is_guest: false,
        prestige_level: 'bronze',
        prestige_points: 0,
        games_played: 0,
        games_won: 0,
        guild_id: null,
        auth_token: res.body.token
      };
      // Cache in local users map
      users.set(username, user);
      connections.set(ws, { user_id: userId, user });
      send(ws, {
        type: 'auth_success',
        action: 'login',
        user: { ...user, auth_token: undefined },
        user_id: user.user_id,
        username: user.username
      });
    } else {
      send(ws, { type: 'error', message: res.body.error || 'Invalid credentials' });
    }
  } catch (e) {
    console.error('[Lobby] Auth API login error:', e.message);
    send(ws, { type: 'error', message: 'Login service unavailable. Try again.' });
  }
};

handlers.register = async (ws, data) => {
  send(ws, {
    type: 'error',
    message: 'Use /register for account creation (email, password confirmation, TOS).'
  });
};

handlers.logout = (ws) => {
  const conn = connections.get(ws);
  if (conn) {
    removePlayerFromSession(conn.user_id);
  }
  connections.delete(ws);
  send(ws, { type: 'logged_out' });
};

handlers.get_profile = (ws) => {
  const conn = connections.get(ws);
  if (!conn) return;
  send(ws, { type: 'profile', user: { ...conn.user, password_hash: undefined } });
};

handlers.update_profile = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  if (data.avatar_id) {
    conn.user.avatar_id = data.avatar_id;
    if (!conn.user.is_guest && users.has(conn.user.username)) {
      users.get(conn.user.username).avatar_id = data.avatar_id;
    }
  }

  send(ws, { type: 'profile_updated', user: { ...conn.user, password_hash: undefined } });
};

// --- Sessions ---

handlers.create_session = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) {
    send(ws, { type: 'error', message: 'Not authenticated' });
    return;
  }

  // Multiplayer sessions are persistent and require signed-in accounts.
  if (conn.user.is_guest) {
    send(ws, { type: 'error', message: 'Sign in to create multiplayer sessions' });
    return;
  }

  // Leave any existing session first
  const existing = findSessionByPlayer(conn.user_id);
  if (existing) {
    removePlayerFromSession(conn.user_id);
    broadcast(existing.session_id, {
      type: 'player_left',
      username: conn.user.username,
      players: existing.players.map(p => ({
        user_id: p.user_id, username: p.username, avatar_id: p.avatar_id,
        is_host: p.is_host, is_ai: p.is_ai, slot: p.slot
      }))
    }, ws);
  }

  const sessionId = generateId('session');
  const code = generateCode();
  // Game ID: which game is this session for? Defaults to fasttrack for backward compat.
  const gameId = data.game_id || 'fasttrack';
  const gameInfo = GAME_REGISTRY[gameId] || {};
  const maxPlayers = Math.min(Math.max(data.max_players || gameInfo.maxPlayers || 4, 2), gameInfo.maxPlayers || 6);

  const session = {
    session_id: sessionId,
    session_code: code,
    game_id: gameId,
    host_id: conn.user_id,
    host_username: conn.user.username,
    is_private: !!data.private,
    max_players: maxPlayers,
    settings: { ...(data.settings || {}), lobby_accepted: false },
    status: 'waiting',
    created_at: Date.now(),
    players: [{
      user_id: conn.user_id,
      username: conn.user.username,
      avatar_id: conn.user.avatar_id,
      is_host: true,
      is_ai: false,
      slot: 0,
      ready: true
    }]
  };

  sessions.set(sessionId, session);
  codeIndex.set(code, sessionId);

  // Canonical invite URL format used across all games.
  const shareUrl = `/play/?game=${encodeURIComponent(gameId)}&code=${encodeURIComponent(code)}`;

  send(ws, {
    type: 'session_created',
    session: sanitizeSession(session),
    share_code: code,
    share_url: shareUrl
  });

  broadcastAll({ type: 'lobby_update', action: 'session_created', session_id: sessionId });
};

handlers.list_sessions = (ws, data) => {
  const gameId = (data && data.game_id) || null; // optional filter
  send(ws, { type: 'session_list', sessions: getPublicSessions(gameId) });
};

// ── Quick Matchmaking ──
// Finds or creates a public game for the requested game_id
handlers.matchmake = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  // Spec: matchmaking requires sign-in
  if (conn.user.is_guest) {
    send(ws, { type: 'error', message: 'Sign in to use matchmaking' });
    return;
  }

  const gameId = data.game_id || 'fasttrack';
  const existing = findSessionByPlayer(conn.user_id);
  if (existing) removePlayerFromSession(conn.user_id);

  // Find a waiting public session for this game
  for (const [, session] of sessions) {
    if (session.game_id !== gameId) continue;
    if (session.status !== 'waiting') continue;
    if (session.is_private) continue;
    if (session.players.length >= session.max_players) continue;

    // Join this session
    const slot = session.players.length;
    const player = {
      user_id: conn.user_id,
      username: conn.user.username,
      avatar_id: conn.user.avatar_id,
      is_host: false,
      is_ai: false,
      slot,
      ready: false
    };
    session.players.push(player);

    resetLobbyAcceptance(session);

    const playersPayload = session.players.map(p => ({
      user_id: p.user_id,
      username: p.username,
      avatar_id: p.avatar_id,
      is_host: p.is_host,
      is_ai: p.is_ai,
      slot: p.slot,
      ready: p.ready
    }));

    broadcast(session.session_id, {
      type: 'player_joined',
      session: sanitizeSession(session),
      player: {
        user_id: player.user_id,
        username: player.username,
        avatar_id: player.avatar_id,
        is_host: false,
        is_ai: false,
        slot: player.slot,
        ready: player.ready
      },
      players: playersPayload,
      username: conn.user.username
    });

    send(ws, { type: 'session_joined', session: sanitizeSession(session) });

    // Starfighter Versus: auto-start when both players are present.
    if (gameId === 'starfighter' && session.players.length >= 2) {
      if (!session.settings) session.settings = {};
      session.settings.lobby_accepted = true;
      session.status = 'playing';
      for (const p of session.players) {
        const pws = getWsByUserId(p.user_id);
        if (pws) send(pws, { type: 'game_started', session: sanitizeSession(session) });
      }
      broadcastAll({ type: 'lobby_update', action: 'session_removed', session_id: session.session_id });
    }
    return;
  }

  // No match found — create a new public session
  const gameInfo = GAME_REGISTRY[gameId] || {};
  const sessionId = generateId('session');
  const code = generateCode();
  const session = {
    session_id: sessionId,
    session_code: code,
    game_id: gameId,
    host_id: conn.user_id,
    host_username: conn.user.username,
    is_private: false,
    // Starfighter Versus is 2-player quick match
    max_players: (gameId === 'starfighter') ? 2 : (gameInfo.maxPlayers || 4),
    settings: { lobby_accepted: false },
    status: 'waiting',
    created_at: Date.now(),
    players: [{
      user_id: conn.user_id,
      username: conn.user.username,
      avatar_id: conn.user.avatar_id,
      is_host: true,
      is_ai: false,
      slot: 0,
      ready: true
    }]
  };
  sessions.set(sessionId, session);
  codeIndex.set(code, sessionId);
  send(ws, { type: 'matchmake_result', action: 'created', session: sanitizeSession(session) });
  broadcastAll({ type: 'lobby_update', action: 'session_created', session_id: sessionId });
};

// ── Resolve Code → Game ──
// Client sends a code, server responds with which game it belongs to + session info
handlers.resolve_code = (ws, data) => {
  const code = (data.code || '').toUpperCase().trim();
  const sessionId = codeIndex.get(code);
  console.log(`[lobby] resolve_code code=${code} known=${codeIndex.size} hit=${!!sessionId}`);
  if (!sessionId) {
    send(ws, { type: 'resolve_code_result', found: false, code });
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    send(ws, { type: 'resolve_code_result', found: false, code });
    return;
  }
  const gameInfo = GAME_REGISTRY[session.game_id] || {};
  send(ws, {
    type: 'resolve_code_result',
    found: true,
    code,
    game_id: session.game_id,
    game_name: gameInfo.name || session.game_id,
    game_path: gameInfo.path || '/',
    game_lobby_path: gameInfo.lobby || gameInfo.path || '/',
    session: sanitizeSession(session),
  });
};

handlers.join_session = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) {
    send(ws, { type: 'error', message: 'Not authenticated' });
    return;
  }

  // Back-compat: allow { code } in join_session by delegating
  if (data && data.code) {
    return handlers.join_by_code(ws, { code: data.code });
  }

  // Joining multiplayer requires a signed-in identity, EXCEPT when the
  // join was triggered by a private invite code (data._fromCode === true).
  // Invite-code joiners can be guests (the host vouched for them by sharing
  // the code).
  if (conn.user.is_guest && !data._fromCode) {
    send(ws, { type: 'error', message: 'Sign in to join multiplayer sessions' });
    return;
  }

  const session = sessions.get(data.session_id);
  if (!session) {
    send(ws, { type: 'error', message: 'Game not found' });
    return;
  }

  // Rejoin / resume: if the player is already in this session, allow it even if started.
  // This enables lobby → game navigation and reconnects for stable guest tokens.
  if (session.players.some(p => p.user_id === conn.user_id)) {
    send(ws, { type: 'session_joined', session: sanitizeSession(session), action: 'rejoined' });
    send(ws, { type: 'session_update', session: sanitizeSession(session), action: 'rejoined' });
    if (session.status === 'playing') {
      send(ws, { type: 'game_started', session: sanitizeSession(session) });
    }
    return;
  }
  if (session.status !== 'waiting') {
    send(ws, { type: 'error', message: 'Game already started' });
    return;
  }
  if (session.players.length >= session.max_players) {
    send(ws, { type: 'error', message: 'Game is full' });
    return;
  }
  if (session.players.some(p => p.user_id === conn.user_id)) {
    send(ws, { type: 'error', message: 'Already in this game' });
    return;
  }

  // Leave existing session
  const existing = findSessionByPlayer(conn.user_id);
  if (existing) removePlayerFromSession(conn.user_id);

  const player = {
    user_id: conn.user_id,
    username: conn.user.username,
    avatar_id: conn.user.avatar_id,
    is_host: false,
    is_ai: false,
    slot: session.players.length,
    ready: false
  };
  session.players.push(player);

  resetLobbyAcceptance(session);

  // Notify joiner
  send(ws, { type: 'session_joined', session: sanitizeSession(session) });

  // Notify others in session
  broadcast(session.session_id, {
    type: 'player_joined',
    player: {
      user_id: player.user_id,
      username: player.username,
      avatar_id: player.avatar_id,
      is_host: false,
      is_ai: false,
      slot: player.slot
    },
    players: session.players.map(p => ({
      user_id: p.user_id, username: p.username, avatar_id: p.avatar_id,
      is_host: p.is_host, is_ai: p.is_ai, slot: p.slot, ready: p.ready
    }))
  }, ws);

  // Also send a canonical session update for unified clients
  broadcastSessionUpdate(session, { action: 'player_joined' });
  send(ws, { type: 'session_update', session: sanitizeSession(session), action: 'joined' });
};

handlers.join_by_code = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) {
    send(ws, { type: 'error', message: 'Not authenticated' });
    return;
  }

  const code = (data.code || '').toUpperCase().trim();
  let sessionId = codeIndex.get(code);
  if (!sessionId) {
    // Fallback: linear scan in case codeIndex got out of sync with sessions
    for (const s of sessions.values()) {
      if (s && s.session_code === code) { sessionId = s.session_id; codeIndex.set(code, sessionId); break; }
    }
  }
  console.log(`[lobby] join_by_code code=${JSON.stringify(code)} rawData=${JSON.stringify(data)} known=${codeIndex.size} keys=${JSON.stringify([...codeIndex.keys()])} hit=${!!sessionId} user=${conn.user_id}`);
  if (!sessionId) {
    send(ws, { type: 'error', message: 'Invalid game code' });
    return;
  }

  // Optional inline name/avatar update from the invitee onboarding panel.
  if (data.name && conn.user) {
    conn.user.username = String(data.name).slice(0, 20).trim() || conn.user.username;
  }
  if (data.avatar_id && conn.user) {
    conn.user.avatar_id = String(data.avatar_id);
  }

  // Delegate to join_session, marking the call as code-originated so guests
  // (invitees who haven't registered) are allowed through.
  handlers.join_session(ws, { session_id: sessionId, _fromCode: true });
};

handlers.leave_session = (ws) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session) return;

  const sessionId = session.session_id;
  removePlayerFromSession(conn.user_id);

  resetLobbyAcceptance(session);

  send(ws, { type: 'left_session' });

  // Notify remaining
  if (sessions.has(sessionId)) {
    broadcast(sessionId, {
      type: 'player_left',
      username: conn.user.username,
      players: session.players.map(p => ({
        user_id: p.user_id, username: p.username, avatar_id: p.avatar_id,
        is_host: p.is_host, is_ai: p.is_ai, slot: p.slot, ready: p.ready
      }))
    });

    broadcastSessionUpdate(session, { action: 'player_left' });
  }
};

handlers.update_player_info = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  // Playername is immutable after registration/profile setup.
  if (data.username) {
    send(ws, { type: 'error', message: 'Playername cannot be changed after account setup' });
  }

  const session = findSessionByPlayer(conn.user_id);
  if (session && session.status === 'playing' && data.avatar_id) {
    send(ws, { type: 'error', message: 'Cannot change avatar during active gameplay' });
    return;
  }

  if (data.avatar_id) {
    conn.user.avatar_id = data.avatar_id;
  }

  // Update in session too
  if (session) {
    const player = session.players.find(p => p.user_id === conn.user_id);
    if (player) {
      if (data.avatar_id) player.avatar_id = conn.user.avatar_id;
    }
  }
};

handlers.update_session_settings = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.host_id !== conn.user_id) return;

  if (data.settings) {
    session.settings = { ...session.settings, ...data.settings };
  }
  if (data.max_players) {
    session.max_players = Math.min(Math.max(data.max_players, 2), 6);
  }

  send(ws, { type: 'session_settings_updated', session: sanitizeSession(session) });
  broadcastSessionUpdate(session, { action: 'settings_updated' });
};

// Host acceptance gate (ready-check then accept)
handlers.accept_lobby = (ws) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session) return;
  if (session.host_id !== conn.user_id) {
    send(ws, { type: 'error', message: 'Only the host can accept the group' });
    return;
  }

  const allHumansReady = session.players
    .filter(p => !p.is_ai)
    .every(p => !!p.ready);

  if (!allHumansReady) {
    send(ws, { type: 'error', message: 'All players must be ready before accepting' });
    return;
  }

  if (!session.settings) session.settings = {};
  session.settings.lobby_accepted = true;
  broadcastSessionUpdate(session, { action: 'accepted' });
  send(ws, { type: 'lobby_accepted', session: sanitizeSession(session) });
};

handlers.add_ai_player = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.host_id !== conn.user_id) {
    send(ws, { type: 'error', message: 'Only host can add bots' });
    return;
  }
  if (session.players.length >= session.max_players) {
    send(ws, { type: 'error', message: 'Game is full' });
    return;
  }

  const aiCount = session.players.filter(p => p.is_ai).length;
  if (aiCount >= 3) {
    send(ws, { type: 'error', message: 'Maximum 3 bots allowed' });
    return;
  }

  const aiId = generateId('ai');
  const aiName = AI_NAMES[aiCount] || `Bot ${aiCount + 1}`;
  const aiAvatars = ['scifi_robot', 'robot', 'space_rocket'];

  const bot = {
    user_id: aiId,
    username: aiName,
    avatar_id: aiAvatars[aiCount % aiAvatars.length],
    is_host: false,
    is_ai: true,
    is_bot: true,
    slot: session.players.length,
    ready: true,
    ai_level: data.level || 'medium'
  };
  session.players.push(bot);

  resetLobbyAcceptance(session);

  // Notify all in session
  broadcast(session.session_id, {
    type: 'player_joined',
    player: {
      user_id: bot.user_id,
      username: bot.username,
      avatar_id: bot.avatar_id,
      is_host: false,
      is_ai: true,
      slot: bot.slot
    },
    players: session.players.map(p => ({
      user_id: p.user_id, username: p.username, avatar_id: p.avatar_id,
      is_host: p.is_host, is_ai: p.is_ai, slot: p.slot, ready: p.ready
    }))
  });

  // Also send to the host who added the bot
  send(ws, {
    type: 'player_joined',
    player: {
      user_id: bot.user_id,
      username: bot.username,
      avatar_id: bot.avatar_id,
      is_host: false,
      is_ai: true,
      slot: bot.slot
    },
    players: session.players.map(p => ({
      user_id: p.user_id, username: p.username, avatar_id: p.avatar_id,
      is_host: p.is_host, is_ai: p.is_ai, slot: p.slot, ready: p.ready
    }))
  });
};

// Aliases for unified clients
handlers.add_ai = (ws, data) => handlers.add_ai_player(ws, { level: data && data.difficulty ? data.difficulty : (data && data.level ? data.level : 'medium') });
handlers.add_bot = (ws, data) => handlers.add_ai_player(ws, { level: (data && data.level) || 'medium' });

// ── Join Requests (host-gated open sessions) ──
// Player requests to join; only the host sees it until accepted.
handlers.request_join = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const sessionId = data.session_id;
  const session = sessions.get(sessionId);
  if (!session) { send(ws, { type: 'error', message: 'Game not found' }); return; }
  if (session.status !== 'waiting') { send(ws, { type: 'error', message: 'Game already started' }); return; }
  if (session.players.length >= session.max_players) { send(ws, { type: 'error', message: 'Game is full' }); return; }
  if (session.players.some(p => p.user_id === conn.user_id)) { send(ws, { type: 'error', message: 'Already in this game' }); return; }

  // Acknowledge requester
  send(ws, { type: 'join_requested', session_id: sessionId });

  // Notify host only
  const hostWs = getWsByUserId(session.host_id);
  if (hostWs) {
    send(hostWs, {
      type: 'join_request',
      session_id: sessionId,
      player: { user_id: conn.user_id, username: conn.user.username, avatar_id: conn.user.avatar_id }
    });
  }
};

handlers.accept_join_request = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.host_id !== conn.user_id) { send(ws, { type: 'error', message: 'Only the host can accept players' }); return; }

  const targetUserId = data.user_id;
  if (!targetUserId) return;
  if (session.players.length >= session.max_players) { send(ws, { type: 'error', message: 'Game is full' }); return; }

  // Find the requester's connection
  let targetWs = null;
  for (const [cws, cconn] of connections) {
    if (cconn.user_id === targetUserId) { targetWs = cws; break; }
  }
  if (!targetWs) { send(ws, { type: 'error', message: 'Player is no longer connected' }); return; }

  const targetConn = connections.get(targetWs);
  const player = {
    user_id: targetUserId,
    username: targetConn.user.username,
    avatar_id: targetConn.user.avatar_id,
    is_host: false, is_ai: false,
    slot: session.players.length,
    ready: false
  };
  session.players.push(player);
  resetLobbyAcceptance(session);

  // Tell the accepted player they're in
  send(targetWs, { type: 'session_joined', session: sanitizeSession(session) });
  // Broadcast new roster to everyone in session
  broadcastSessionUpdate(session, { action: 'player_joined' });
  // Notify host of acceptance
  send(ws, { type: 'join_request_accepted', user_id: targetUserId });
};

handlers.reject_join_request = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.host_id !== conn.user_id) return;

  const targetUserId = data.user_id;
  for (const [cws, cconn] of connections) {
    if (cconn.user_id === targetUserId) {
      send(cws, { type: 'join_request_rejected', session_id: session.session_id });
      break;
    }
  }
  send(ws, { type: 'join_request_rejected_ack', user_id: targetUserId });
};

handlers.remove_ai_player = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.host_id !== conn.user_id) return;

  let removed = false;
  if (data.player_id) {
    const idx = session.players.findIndex(p => p.user_id === data.player_id && p.is_ai);
    if (idx !== -1) {
      session.players.splice(idx, 1);
      removed = true;
    }
  } else {
    // Remove last AI
    for (let i = session.players.length - 1; i >= 0; i--) {
      if (session.players[i].is_ai) {
        session.players.splice(i, 1);
        removed = true;
        break;
      }
    }
  }

  if (removed) {
    resetLobbyAcceptance(session);
    // Re-slot
    session.players.forEach((p, i) => { p.slot = i; });

    const playersPayload = session.players.map(p => ({
      user_id: p.user_id, username: p.username, avatar_id: p.avatar_id,
      is_host: p.is_host, is_ai: p.is_ai, slot: p.slot, ready: p.ready
    }));

    // Notify everyone in session including the sender
    broadcast(session.session_id, {
      type: 'player_left',
      username: 'Bot',
      players: playersPayload
    });
    send(ws, {
      type: 'player_left',
      username: 'Bot',
      players: playersPayload
    });
  }
};

handlers.remove_ai = (ws, data) => handlers.remove_ai_player(ws, { player_id: (data && data.player_id) || null });

handlers.start_game = (ws) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const session = findSessionByPlayer(conn.user_id);
  if (!session) {
    send(ws, { type: 'error', message: 'Not in a game' });
    return;
  }
  if (session.host_id !== conn.user_id) {
    send(ws, { type: 'error', message: 'Only the host can start the game' });
    return;
  }
  if (session.players.length < 2) {
    send(ws, { type: 'error', message: 'Need at least 2 players' });
    return;
  }

  const allHumansReady = session.players
    .filter(p => !p.is_ai && p.user_id !== session.host_id)
    .every(p => !!p.ready);
  if (!allHumansReady) {
    send(ws, { type: 'error', message: 'All players must be ready' });
    return;
  }

  // Auto-accept lobby when host explicitly launches
  if (!session.settings) session.settings = {};
  session.settings.lobby_accepted = true;

  session.status = 'playing';

  // ── Create the authoritative match (dimensional x-seed + replay log) ──
  let matchId = null;
  try {
    matchId = matchServer.createMatch(session);
    session.match_id = matchId;
  } catch (e) {
    console.warn('[Lobby] match server skipped:', e.message);
  }

  const payload = {
    type: 'game_started',
    session: sanitizeSession(session),
    match_id: matchId,
  };

  // Notify all players including host
  for (const [clientWs, clientConn] of connections) {
    if (session.players.some(p => p.user_id === clientConn.user_id)) {
      send(clientWs, payload);
    }
  }

  broadcastAll({ type: 'lobby_update', action: 'session_removed', session_id: session.session_id });
};

// --- Real-Time Game State Relay ---
// These handlers support both real-time (Starfighter, BrickBreaker)
// and turn-based (FastTrack, ConnectIV, 4D Connect) games.
// The server is a RELAY — it doesn't understand game logic, just forwards state.

// Player state — high-frequency position/velocity updates (action games, ~20 Hz)
handlers.player_state = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.status !== 'playing') return;

  // Relay to all other players in the session
  const payload = {
    type: 'player_state',
    user_id: conn.user_id,
    username: conn.user.username,
    ...data // x, y, z, qx, qy, qz, qw, vx, vy, vz, hull, shields, etc.
  };
  delete payload.type; // re-add clean
  const msg = JSON.stringify({ type: 'player_state', ...payload });
  for (const [clientWs, clientConn] of connections) {
    if (clientConn.user_id === conn.user_id) continue;
    if (session.players.some(p => p.user_id === clientConn.user_id)) {
      if (clientWs.readyState === 1) clientWs.send(msg);
    }
  }
};

// Game action — any discrete game event (fire weapon, play card, move piece)
handlers.game_action = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.status !== 'playing') return;

  const payload = JSON.stringify({
    type: 'game_action',
    user_id: conn.user_id,
    username: conn.user.username,
    action: data.action,    // e.g. 'fire', 'move_piece', 'play_card'
    payload: data.payload,  // game-specific data
    seq: data.seq || 0,     // sequence number for ordering
    timestamp: Date.now(),
  });
  for (const [clientWs, clientConn] of connections) {
    if (clientConn.user_id === conn.user_id) continue;
    if (session.players.some(p => p.user_id === clientConn.user_id)) {
      if (clientWs.readyState === 1) clientWs.send(payload);
    }
  }
};

// Game state — authoritative state snapshot from host (periodic or on key events)
handlers.game_state = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.status !== 'playing') return;
  // Only host can broadcast authoritative state
  if (session.host_id !== conn.user_id) return;

  const payload = JSON.stringify({
    type: 'game_state',
    state: data.state,      // game-specific state blob
    seq: data.seq || 0,
    timestamp: Date.now(),
  });
  for (const [clientWs, clientConn] of connections) {
    if (clientConn.user_id === conn.user_id) continue;
    if (session.players.some(p => p.user_id === clientConn.user_id)) {
      if (clientWs.readyState === 1) clientWs.send(payload);
    }
  }
};

// Game over — any player can signal, but only host's is authoritative
handlers.game_over = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session || session.status !== 'playing') return;

  session.status = 'finished';

  const payload = JSON.stringify({
    type: 'game_over',
    result: data.result,    // 'win', 'loss', 'draw', etc.
    winner: data.winner,    // user_id or null
    scores: data.scores,    // { user_id: score, ... }
    message: data.message,
  });
  for (const [clientWs, clientConn] of connections) {
    if (session.players.some(p => p.user_id === clientConn.user_id)) {
      if (clientWs.readyState === 1) clientWs.send(payload);
    }
  }

  // Clean up session after 30 seconds
  setTimeout(() => {
    sessions.delete(session.session_id);
    codeIndex.delete(session.session_code);
  }, 30000);
};

// --- Chat ---

handlers.chat = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;

  const message = (data.message || '').slice(0, 500);
  if (!message) return;

  broadcastAll({
    type: 'chat',
    username: conn.user.username,
    avatar_id: conn.user.avatar_id,
    message,
    timestamp: Date.now()
  });
};

// --- Search ---

handlers.search_users = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const query = (data.query || '').toLowerCase();
  const results = [];
  for (const [, u] of users) {
    if (u.username.toLowerCase().includes(query)) {
      results.push({
        user_id: u.user_id,
        username: u.username,
        avatar_id: u.avatar_id,
        prestige_level: u.prestige_level,
        prestige_points: u.prestige_points,
        games_played: u.games_played,
        games_won: u.games_won
      });
    }
    if (results.length >= 20) break;
  }
  send(ws, { type: 'user_search_results', users: results });
};

// --- Guilds (stubs — return empty to avoid client errors) ---

handlers.create_guild = (ws, data) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const guildId = generateId('guild');
  const guild = {
    guild_id: guildId,
    id: guildId,
    name: (data.name || 'Guild').slice(0, 30),
    tag: (data.tag || 'TAG').slice(0, 4).toUpperCase(),
    guildmaster_id: conn.user_id,
    members: [{ user_id: conn.user_id, username: conn.user.username, online: true }],
    total_prestige: 0
  };
  conn.user.guild_id = guildId;
  send(ws, { type: 'guild_created', guild });
};

handlers.search_guilds = (ws) => {
  send(ws, { type: 'guild_search_results', guilds: [] });
};

handlers.join_guild = (ws) => {
  send(ws, { type: 'error', message: 'Guild not found' });
};

handlers.leave_guild = (ws) => {
  send(ws, { type: 'guild_left' });
};

handlers.get_guild_details = (ws) => {
  send(ws, { type: 'guild_details', guild: null, members: [], tournaments: [], pendingInvites: [] });
};

handlers.get_guild_members = (ws) => {
  send(ws, { type: 'guild_members', members: [] });
};

handlers.get_guild_tournaments = (ws) => {
  send(ws, { type: 'guild_tournaments', tournaments: [], pendingInvites: [] });
};

handlers.disband_guild = (ws) => {
  send(ws, { type: 'guild_disbanded', message: 'Guild has been disbanded' });
};

handlers.boot_guild_member = (ws) => {
  // No-op
};

handlers.create_guild_game = (ws) => {
  send(ws, { type: 'error', message: 'Guild games coming soon' });
};

handlers.invite_guild_member = (ws) => {
  // No-op stub
};

handlers.create_guild_tournament = (ws) => {
  send(ws, { type: 'error', message: 'Tournaments coming soon' });
};

handlers.respond_tournament_invite = (ws) => {
  // No-op
};

// --- Chat stubs ---

handlers.guild_chat_message = () => { };
handlers.toggle_guild_chat = () => { };
handlers.update_chat_preference = () => { };
handlers.approve_chat_user = () => { };
handlers.deny_chat_user = () => { };
handlers.get_blocked_users = (ws) => {
  send(ws, { type: 'blocked_users', blockedUsers: [], blockedByUsers: [] });
};
handlers.block_user = () => { };
handlers.unblock_user = () => { };
handlers.search_users_to_block = (ws) => {
  send(ws, { type: 'block_search_results', users: [] });
};
function emitReadyState(ws, readyValue) {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session) return;
  const player = session.players.find(p => p.user_id === conn.user_id);
  if (player) {
    player.ready = !!readyValue;

    resetLobbyAcceptance(session);

    const sessionPayload = sanitizeSession(session);
    broadcast(session.session_id, { type: 'ready_update', session: sessionPayload, user_id: conn.user_id, ready: player.ready });
    send(ws, { type: 'ready_update', session: sessionPayload, user_id: conn.user_id, ready: player.ready });

    // Back-compat message
    broadcast(session.session_id, {
      type: 'player_ready_changed',
      user_id: conn.user_id,
      ready: player.ready,
      username: conn.user.username
    });
    send(ws, {
      type: 'player_ready_changed',
      user_id: conn.user_id,
      ready: player.ready,
      username: conn.user.username
    });

    broadcastSessionUpdate(session, { action: 'ready_changed' });
  }
}

handlers.toggle_ready = (ws) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session) return;
  const player = session.players.find(p => p.user_id === conn.user_id);
  if (!player) return;
  emitReadyState(ws, !player.ready);
};

handlers.player_ready = (ws, msg) => {
  const conn = connections.get(ws);
  if (!conn) return;
  const session = findSessionByPlayer(conn.user_id);
  if (!session) return;
  const player = session.players.find(p => p.user_id === conn.user_id);
  if (!player) return;

  if (typeof msg.ready === 'boolean') {
    emitReadyState(ws, msg.ready);
    return;
  }

  emitReadyState(ws, !player.ready);
};

// ═══════════════════════════════════════════════════════════════════════════
// HTTP + WebSocket Server (same port)
// ═══════════════════════════════════════════════════════════════════════════

const httpServer = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', 'http://localhost');
  const path = reqUrl.pathname;

  if (req.method === 'OPTIONS' && (
    path === '/ws/launch-object' || path.startsWith('/ws/launch-object/') || path === '/ws/guest-anchor'
  )) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && path === '/ws/guest-anchor') {
    try {
      const body = await parseJsonBody(req);
      const result = mintGuestAnchor(body && body.username, body && body.avatar_id, req);
      if (result.error) {
        const code = result.error === 'Rate limit exceeded' ? 429 : 400;
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: result.error }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        guest_id: result.anchor.guest_id,
        guest_token: result.anchor.guest_token,
        username: result.anchor.username,
        avatar_id: result.anchor.avatar_id,
        expires_at: result.anchor.expires_at,
      }));
      return;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Failed to mint guest anchor' }));
      return;
    }
  }

  if (req.method === 'POST' && path === '/ws/launch-object') {
    try {
      const authz = req.headers.authorization || '';
      if (!authz.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Authentication required' }));
        return;
      }
      const bearerToken = authz.slice(7);
      const body = await parseJsonBody(req);
      const requestedMode = String(body && body.mode || '').toLowerCase();

      // ── Solo branch: x_local anchored to either authed user (x_1=user_id)
      // or guest anchor (x_1=guest_id). No lobby session required.
      if (requestedMode === 'solo') {
        const guestAnchor = validateGuestToken(bearerToken);
        let identity = null;
        if (guestAnchor) {
          identity = {
            kind: 'guest',
            user_id: guestAnchor.guest_id,
            username: guestAnchor.username,
            avatar_id: guestAnchor.avatar_id,
            auth_user_id: null,
          };
        } else {
          const validate = await authApiValidateToken(bearerToken);
          const authUserId = validate && validate.status === 200 && validate.body && validate.body.valid
            ? validate.body.userId
            : null;
          if (!authUserId) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: 'Invalid auth token' }));
            return;
          }
          identity = {
            kind: 'user',
            user_id: `user_${authUserId}`,
            username: sanitizeAnchorString(body && body.username, 32) || (validate.body.username || `Player ${authUserId}`),
            avatar_id: sanitizeAnchorString(body && body.avatar_id, 64) || (validate.body.avatarId || ''),
            auth_user_id: String(authUserId),
          };
        }
        const envelope = buildSoloLaunchEnvelope(identity, body, req);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          launch_ref: {
            launch_id: envelope.launch_id,
            sig: envelope.sig,
            expires_at: envelope.expires_at,
          },
          launch_hash: envelope.launch_hash,
        }));
        return;
      }

      // ── Multi branch (unchanged): requires authed user + session membership.
      const validate = await authApiValidateToken(bearerToken);
      const authUserId = validate && validate.status === 200 && validate.body && validate.body.valid
        ? validate.body.userId
        : null;
      if (!authUserId) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Invalid auth token' }));
        return;
      }
      const sessionId = body && body.session_id ? String(body.session_id) : '';
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'session_id required' }));
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Session not found' }));
        return;
      }

      const lobbyUserId = `user_${authUserId}`;
      const isMember = (session.players || []).some((p) => p.user_id === lobbyUserId);
      if (!isMember) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: 'Not a session participant' }));
        return;
      }

      const envelope = buildLaunchObjectEnvelope(session, authUserId, body, req);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        launch_ref: {
          launch_id: envelope.launch_id,
          sig: envelope.sig,
          expires_at: envelope.expires_at,
        },
        launch_hash: envelope.launch_hash,
      }));
      return;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Failed to create launch object' }));
      return;
    }
  }

  if (req.method === 'GET' && path.startsWith('/ws/launch-object/')) {
    const launchId = decodeURIComponent(path.slice('/ws/launch-object/'.length));
    const sig = String(reqUrl.searchParams.get('sig') || '');
    const envelope = launchObjects.get(launchId);
    if (!envelope) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Launch object not found' }));
      return;
    }
    if (Date.now() > envelope.expires_at) {
      launchObjects.delete(launchId);
      res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Launch object expired' }));
      return;
    }

    const expectedSig = hmacLaunchSig(envelope.launch_id, envelope.launch_hash, envelope.expires_at);
    if (!timingSafeEqualHex(sig, expectedSig)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Invalid launch signature' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      success: true,
      launch_hash: envelope.launch_hash,
      launch: envelope.launch,
    }));
    return;
  }

  if (path === '/' || path === '/health' || path === '/status') {
    const body = {
      service: 'fasttrack-lobby',
      status: 'ok',
      transport: 'websocket',
      wsEndpoint: '/ws',
      connections: connections.size,
      waitingSessions: getPublicSessions().length,
      ts: new Date().toISOString(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not found', hint: 'Use /health or WebSocket upgrade on /ws' }));
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
  console.log(`[Lobby] New connection (total: ${wss.clients.size})`);

  // Send welcome
  send(ws, {
    type: 'connected',
    message: 'Welcome to Fast Track Lobby!'
  });

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format' });
      return;
    }

    const handler = handlers[data.type];
    if (handler) {
      try {
        await handler(ws, data);
      } catch (err) {
        console.error(`[Lobby] Handler error for ${data.type}:`, err);
        send(ws, { type: 'error', message: 'Server error' });
      }
    } else if (matchServer.handleWsMessage(ws, data)) {
      // routed to the match server
    } else {
      console.warn(`[Lobby] Unknown message type: ${data.type}`);
    }
  });

  ws.on('close', () => {
    matchServer.detachWs(ws);
    const conn = connections.get(ws);
    if (conn) {
      // Mark player offline but DO NOT delete the session. Hosts often
      // disconnect briefly (refresh, switch tabs to copy the invite link,
      // mobile network blip) — deleting the session would invalidate the
      // invite code their friends are about to use. The 30-min stale-session
      // sweep still reaps truly abandoned waiting rooms.
      const session = findSessionByPlayer(conn.user_id);
      if (session) {
        const player = session.players.find(p => p.user_id === conn.user_id);
        if (player) {
          player.online = false;
          player.disconnected_at = Date.now();
        }
        // Notify peers that this player went offline (without removing them).
        broadcast(session.session_id, {
          type: 'player_offline',
          user_id: conn.user_id,
          username: conn.user.username,
        });
      }
      connections.delete(ws);
    }
    console.log(`[Lobby] Disconnected (total: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('[Lobby] WebSocket error:', err.message);
  });
});

// Cleanup stale sessions every 5 minutes
setInterval(() => {
  const staleThreshold = Date.now() - (30 * 60 * 1000); // 30 minutes
  for (const [id, session] of sessions) {
    if (session.created_at < staleThreshold && session.status === 'waiting') {
      codeIndex.delete(session.session_code);
      sessions.delete(id);
      console.log(`[Lobby] Cleaned up stale session ${id}`);
    }
  }

  for (const [launchId, envelope] of launchObjects) {
    if (!envelope || Date.now() > envelope.expires_at) {
      launchObjects.delete(launchId);
    }
  }

  for (const [token, anchor] of guestAnchors) {
    if (!anchor || Date.now() > anchor.expires_at) {
      guestAnchors.delete(token);
    }
  }

  const rateCutoff = Date.now() - GUEST_ANCHOR_RATE_WINDOW_MS;
  for (const [ipHash, stamps] of guestAnchorRate) {
    const fresh = stamps.filter((t) => t > rateCutoff);
    if (fresh.length === 0) guestAnchorRate.delete(ipHash);
    else guestAnchorRate.set(ipHash, fresh);
  }
}, 5 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`═══════════════════════════════════════════════`);
  console.log(`  Fast Track Lobby Server`);
  console.log(`  HTTP health: http://0.0.0.0:${PORT}/health`);
  console.log(`  WebSocket: ws://0.0.0.0:${PORT}`);
  console.log(`  nginx proxies wss://kensgames.com/ws → here`);
  console.log(`═══════════════════════════════════════════════`);
});
