// fasttrack/x/match.x.js — the MATCH seed (`x` = sealed `m`)
// ─────────────────────────────────────────────────────────────────────────
// A match is the closed whole produced by inhaling players × board into
// one body (D7 `sealM` per PARADIGM.md §3). The match is itself an `x`:
// the next tier (history, ladder, season) takes matches as its seeds.
//
// This factory is pure construction — no state mutation, no rendering.
// It returns a frozen-ish snapshot of the initial conditions; the rules
// engine then evolves it by applying lenses (turn, draw, move) which
// produce `z`s — those still live in the legacy `state` tables today.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  function create(spec) {
    spec = spec || {};
    if (!Array.isArray(spec.players) || spec.players.length === 0) {
      throw new Error('match.x: players[] is required');
    }
    if (!spec.board || typeof spec.board.holes !== 'object') {
      throw new Error('match.x: board seed is required');
    }
    return {
      // ── identity ──
      id: spec.id || ('m-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36)),
      seed: (spec.seed != null) ? spec.seed : Math.floor(Math.random() * 0xFFFFFFFF),
      createdAt: spec.createdAt || Date.now(),
      // ── composed `x`s by reference ──
      players: spec.players,
      board: spec.board,
      // ── config (lens hints — drives later behavior) ──
      config: {
        humanName: spec.humanName || 'You',
        humanAvatar: spec.humanAvatar || '🎮',
        aiDifficulty: spec.aiDifficulty || 'normal',
        playerCount: spec.players.length
      }
    };
  }

  root.FastTrackX = root.FastTrackX || {};
  root.FastTrackX.match = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
