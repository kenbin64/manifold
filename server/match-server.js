// kensgames-portal/manifold/server/match-server.js
// ─────────────────────────────────────────────────────────────────────────
// MATCH SERVER — authoritative game state, dimensional `x`-style.
//
// PARADIGM mapping (PARADIGM.md §1, §3):
//   x  = match seed   (matchId, players, gameId, seed)            stored once
//   z  = frame stack  ([{v, ts, by, intent, effect}, ...])        append-only D5
//   y  = replay lens  pure (seed, frames) → publicState           never stored
//   m  = snapshot     {x, version, state}  — what clients render
//
// TetracubeDB integration (when env credentials present):
//   table 'matches' : row=matchId  col='seed'   → the x (set once)
//   table 'matches' : row=matchId  col='frames' → the z stack (pushDelta)
// If TetracubeDB is unreachable, the in-memory store keeps the game
// running — persistence is mechanics, not the manifold (PARADIGM §3.5).
//
// Public surface:
//   const M = require('./match-server')(opts);
//   M.createMatch(session)            → matchId
//   M.getMatch(matchId)               → { seed, version, state } | null
//   M.applyIntent(matchId, intent)    → { ok, frame? , state?, error? }
//   M.subscribe(matchId, ws)          → unsubscribe()
//   M.handleWsMessage(ws, msg)        → bool (true if this module handled it)
// ─────────────────────────────────────────────────────────────────────────

'use strict';

// ════════════════════════════════════════════════════════════════════
// y — LENS REGISTRY (one per game). Each lens is a pure pair:
//   init(seedX)             → initial state
//   apply(state, intent, x) → { state, effect } | { error }
// ════════════════════════════════════════════════════════════════════
const lenses = Object.create(null);

// ── FastTrack lens v0: just a card-draw heartbeat. No movement yet.
//    Validates: intent.by must equal the current turn player's user_id.
//    Effect: increments turn, picks a pseudo-random card from a 60-card deck.
lenses.fasttrack = (function () {
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function buildDeck(rngSeed) {
    // Tiny LCG so deck is reproducible from the match seed (deterministic replay).
    let s = (rngSeed >>> 0) || 1;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
    const deck = [];
    for (const su of SUITS) for (const r of RANKS) deck.push({ suit: su, rank: r });
    // Fisher–Yates with the seeded RNG
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function init(x) {
    const deck = buildDeck(x.seed);
    return {
      gameId: x.gameId,
      players: x.players.map((p, i) => ({
        slot: i,
        user_id: p.user_id,
        username: p.username,
        avatar_id: p.avatar_id,
        is_ai: !!p.is_ai,
      })),
      deckRemaining: deck.length,
      _deck: deck,            // private — stripped before sending to clients
      discard: [],            // public history of drawn cards
      turn: 0,                // index into players
      lastCard: null,
      log: [`Match started — ${x.players.length} players`],
    };
  }

  function apply(state, intent, x) {
    const me = state.players[state.turn];
    if (!me) return { error: 'No active player' };

    if (intent.action === 'draw') {
      // Server-side authority: only the active player may draw.
      if (intent.by !== me.user_id) {
        return { error: 'Not your turn' };
      }
      if (state._deck.length === 0) {
        // Reshuffle discard back in (still deterministic per current state).
        state._deck = state.discard.slice().reverse();
        state.discard = [];
      }
      const card = state._deck.shift();
      state.discard.push(card);
      state.deckRemaining = state._deck.length;
      state.lastCard = card;
      const drewLine = `${me.username} drew ${card.rank}${card.suit}`;
      state.log.push(drewLine);
      // Advance turn
      state.turn = (state.turn + 1) % state.players.length;
      return { state, effect: { card, drewBy: me.user_id, nextTurn: state.turn } };
    }

    if (intent.action === 'pass') {
      if (intent.by !== me.user_id) return { error: 'Not your turn' };
      state.log.push(`${me.username} passed`);
      state.turn = (state.turn + 1) % state.players.length;
      return { state, effect: { passedBy: me.user_id, nextTurn: state.turn } };
    }

    return { error: 'Unknown intent: ' + intent.action };
  }

  // Strip private fields before shipping to clients.
  function publish(state) {
    const { _deck, ...pub } = state;
    return pub;
  }

  return { init, apply, publish };
})();


// ════════════════════════════════════════════════════════════════════
// MATCH STORE (in-memory; mirrored to TetracubeDB when configured)
// ════════════════════════════════════════════════════════════════════
function makeStore(opts) {
  const matches = new Map();      // matchId → { x, frames[], state, version }
  const subscribers = new Map();  // matchId → Set<ws>
  const tcube = opts.tetracube || null;   // optional TetracubeClient instance
  const ns = opts.namespace || 'kensgames';
  const log = opts.log || console.log.bind(console, '[match]');

  // ── persistence helpers (best-effort; never block gameplay) ──
  function persistSeed(x) {
    if (!tcube) return;
    Promise.resolve()
      .then(() => tcube.set('matches', x.id, 'seed', x, ns))
      .catch(e => log('persistSeed failed:', e.message));
  }
  function persistFrame(matchId, frame) {
    if (!tcube || !tcube.pushDelta) return;
    Promise.resolve()
      .then(() => tcube.pushDelta('matches', matchId, 'frames', frame, ns))
      .catch(e => log('persistFrame failed:', e.message));
  }

  function broadcast(matchId, msg) {
    const subs = subscribers.get(matchId);
    if (!subs) return;
    const json = JSON.stringify(msg);
    for (const ws of subs) {
      if (ws.readyState === 1 /* OPEN */) {
        try { ws.send(json); } catch (e) { /* dropped */ }
      }
    }
  }

  function snapshot(rec) {
    const lens = lenses[rec.x.gameId];
    const publicState = (lens && lens.publish) ? lens.publish(rec.state) : rec.state;
    return {
      type: 'match_snapshot',
      matchId: rec.x.id,
      version: rec.version,
      x: { id: rec.x.id, gameId: rec.x.gameId, players: rec.x.players },
      state: publicState,
    };
  }

  return {
    // ── construction ────────────────────────────────────────────────
    createMatch(session) {
      const lens = lenses[session.game_id];
      if (!lens) throw new Error('No lens for game: ' + session.game_id);

      const x = {
        id: 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        gameId: session.game_id,
        seed: Math.floor(Math.random() * 0x7fffffff),
        players: session.players.map(p => ({
          user_id: p.user_id,
          username: p.username,
          avatar_id: p.avatar_id,
          is_ai: !!(p.is_ai || p.is_bot),
          slot: p.slot,
        })),
        host_id: session.host_id,
        sessionId: session.session_id,
        createdAt: Date.now(),
      };
      const state = lens.init(x);
      const rec = { x, state, frames: [], version: 0 };
      matches.set(x.id, rec);
      persistSeed(x);
      log('createMatch', x.id, 'game=', x.gameId, 'players=', x.players.length);
      return x.id;
    },

    getMatch(matchId) {
      const rec = matches.get(matchId);
      if (!rec) return null;
      return snapshot(rec);
    },

    applyIntent(matchId, intent) {
      const rec = matches.get(matchId);
      if (!rec) return { ok: false, error: 'No such match' };
      const lens = lenses[rec.x.gameId];
      if (!lens) return { ok: false, error: 'No lens loaded' };

      const result = lens.apply(rec.state, intent, rec.x);
      if (result.error) return { ok: false, error: result.error };

      rec.state = result.state;
      rec.version += 1;
      const frame = {
        v: rec.version,
        ts: Date.now(),
        by: intent.by,
        intent: { action: intent.action, args: intent.args || null, nonce: intent.nonce || null },
        effect: result.effect || null,
      };
      rec.frames.push(frame);
      persistFrame(matchId, frame);
      const snap = snapshot(rec);
      broadcast(matchId, snap);
      return { ok: true, frame, snapshot: snap };
    },

    subscribe(matchId, ws) {
      let set = subscribers.get(matchId);
      if (!set) { set = new Set(); subscribers.set(matchId, set); }
      set.add(ws);
      // Send an immediate snapshot so the new subscriber renders the current frame.
      const rec = matches.get(matchId);
      if (rec && ws.readyState === 1) {
        try { ws.send(JSON.stringify(snapshot(rec))); } catch (e) { }
      }
      return function unsubscribe() {
        const s = subscribers.get(matchId);
        if (s) { s.delete(ws); if (s.size === 0) subscribers.delete(matchId); }
      };
    },

    detachWs(ws) {
      for (const [matchId, set] of subscribers) {
        if (set.delete(ws) && set.size === 0) subscribers.delete(matchId);
      }
    },

    // ── WS message router (returns true if handled) ─────────────────
    handleWsMessage(ws, msg) {
      if (!msg || typeof msg !== 'object') return false;
      switch (msg.type) {
        case 'match_subscribe': {
          if (!msg.matchId) {
            try { ws.send(JSON.stringify({ type: 'match_error', error: 'matchId required' })); } catch (e) { }
            return true;
          }
          this.subscribe(msg.matchId, ws);
          return true;
        }
        case 'match_intent': {
          const r = this.applyIntent(msg.matchId, {
            by: msg.by,
            action: msg.action,
            args: msg.args,
            nonce: msg.nonce,
          });
          if (!r.ok) {
            try { ws.send(JSON.stringify({ type: 'match_error', matchId: msg.matchId, error: r.error })); } catch (e) { }
          }
          return true;
        }
        default:
          return false;
      }
    },

    _debug() {
      return {
        matchCount: matches.size,
        subCount: subscribers.size,
        list: [...matches.values()].map(r => ({ id: r.x.id, v: r.version, players: r.x.players.length })),
      };
    },
  };
}

module.exports = function (opts = {}) {
  return makeStore(opts);
};
module.exports.lenses = lenses;
