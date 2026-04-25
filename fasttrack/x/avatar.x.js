// fasttrack/x/avatar.x.js — the AVATAR seed (`x`)
// ─────────────────────────────────────────────────────────────────────────
// Avatar identity is decoupled from player identity. Players consume avatar
// seeds by reference, and games consume player seeds by reference.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  function create(spec) {
    spec = spec || {};
    var glyph = (typeof spec.glyph === 'string' && spec.glyph) ? spec.glyph : '👤';
    var id = (typeof spec.id === 'string' && spec.id)
      ? spec.id
      : ('avatar-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36));

    return {
      id: id,
      glyph: glyph,
      image: spec.image || null,
      sprite: spec.sprite || null,
      metadata: spec.metadata || {},
    };
  }

  root.FastTrackX = root.FastTrackX || {};
  root.FastTrackX.avatar = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
