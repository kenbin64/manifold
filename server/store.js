/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KENSGAMES — SHARED IN-MEMORY STORE
 * ═══════════════════════════════════════════════════════════════════════════
 * Single source of truth imported by index.js and all route modules.
 * In production this would be replaced with a persistent DB (Redis / Postgres).
 *
 * Maps:
 *   manifoldData   — user records (auth, profile, stats)
 *   guildsData     — guild records
 *   friendsData    — friendship graph & block lists
 *   leaderboardData— per-game high-score lists
 *   tournamentsData— tournament announcements + results
 *   notifQueue     — pending notifications (guild appeals, friend requests)
 *   sessionsData   — active game sessions (waiting room, invite codes, player ready state)
 */

const manifoldData = {};  // key: "user-<username>"  value: UserRecord
const guildsData = {};  // key: "guild-<id>"       value: GuildRecord
const friendsData = {};  // key: <userId>           value: FriendRecord
const leaderboardData = {};  // key: <gameId>           value: ScoreEntry[]
const tournamentsData = [];  // TournamentRecord[]
const notifQueue = {};  // key: <userId>           value: Notification[]
const sessionsData = {};  // key: <sessionId>       value: GameSession

// ── sessionsData disk persistence ────────────────────────────────────────────
// sessionsData lives in RAM; restarts of the auth process would otherwise wipe
// all in-flight invite codes. Mirror it to disk so codes survive restarts.
const fs = require('fs');
const path = require('path');

const SESSIONS_FILE = process.env.SESSIONS_FILE
  || path.join(__dirname, 'data', 'sessions.json');

try {
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
} catch (_) { /* ignore */ }

// Load on boot
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    const TTL = 2 * 60 * 60 * 1000; // mirror of game-sessions SESSION_TTL_MS
    let restored = 0;
    for (const [id, s] of Object.entries(parsed || {})) {
      if (!s || typeof s !== 'object') continue;
      // Drop already-expired waiting sessions; keep active ones regardless.
      if (s.status !== 'active' && s.createdAt && (now - s.createdAt) > TTL) continue;
      sessionsData[id] = s;
      restored++;
    }
    if (restored > 0) console.log(`[store] restored ${restored} session(s) from ${SESSIONS_FILE}`);
  }
} catch (err) {
  console.warn('[store] failed to load sessions from disk:', err.message);
}

// Periodic flush: write only when content changes.
let lastSerialized = '';
function flushSessions() {
  try {
    const ser = JSON.stringify(sessionsData);
    if (ser === lastSerialized) return;
    const tmp = `${SESSIONS_FILE}.tmp`;
    fs.writeFileSync(tmp, ser);
    fs.renameSync(tmp, SESSIONS_FILE);
    lastSerialized = ser;
  } catch (err) {
    console.warn('[store] sessions flush failed:', err.message);
  }
}
const flushTimer = setInterval(flushSessions, 1500);
if (typeof flushTimer.unref === 'function') flushTimer.unref();

// Best-effort flush on shutdown
function flushOnExit() { try { flushSessions(); } catch (_) { } }
process.once('SIGINT', flushOnExit);
process.once('SIGTERM', flushOnExit);
process.once('beforeExit', flushOnExit);

module.exports = {
  manifoldData,
  guildsData,
  friendsData,
  leaderboardData,
  tournamentsData,
  notifQueue,
  sessionsData,
  flushSessions,
};
