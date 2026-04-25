// fasttrack/x/player.x.js — the PLAYER seed (`x`)
// ─────────────────────────────────────────────────────────────────────────
// Per PARADIGM.md: a player is `x`. Pegs are `x`s composed *by reference*
// into the player. The player's color comes from the board-position lens
// (boardPosition × PLAYER_COLORS) — so it is technically a `z`, cached
// here for renderer convenience. Once the theme is a lens, color drops.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  var PEGS_PER_PLAYER = 5;

  function create(spec) {
    if (!spec || typeof spec.index !== 'number') {
      throw new Error('player.x: index is required');
    }
    if (!spec.peg || typeof spec.peg.create !== 'function') {
      throw new Error('player.x: spec.peg (the peg seed factory) is required');
    }
    var pegFactory = spec.peg;
    var pegCount = spec.pegsPerPlayer || PEGS_PER_PLAYER;

    var pegs = [];
    for (var p = 0; p < pegCount; p++) {
      pegs.push(pegFactory.create({
        ownerIdx: spec.index,
        pegSlot: p,
        assignNickname: spec.assignPegNickname,
        assignPersonality: spec.assignPegPersonality
      }));
    }

    var avatarObj = spec.avatarObject || null;
    var avatarGlyph = (avatarObj && avatarObj.glyph)
      ? avatarObj.glyph
      : (spec.avatar || (spec.isBot ? '🤖' : '🎮'));

    return {
      // ── identity ──
      index: spec.index,
      isBot: !!spec.isBot,
      userId: spec.userId || null,
      isHost: !!spec.isHost,
      // ── lens-derived but cached for the renderer ──
      name: spec.name || ('Player ' + (spec.index + 1)),
      avatar: avatarGlyph,
      avatarObject: avatarObj,
      color: spec.color,
      boardPosition: spec.boardPosition,
      aiDifficulty: spec.isBot ? (spec.aiDifficulty || 'normal') : null,
      // ── composed parts (`x`s by reference) ──
      pegs: pegs
    };
  }

  root.FastTrackX = root.FastTrackX || {};
  root.FastTrackX.player = { create: create, PEGS_PER_PLAYER: PEGS_PER_PLAYER };
})(typeof window !== 'undefined' ? window : globalThis);
