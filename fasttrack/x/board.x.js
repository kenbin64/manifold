// fasttrack/x/board.x.js — the BOARD seed (`x`)
// ─────────────────────────────────────────────────────────────────────────
// The board IS an `x` — a closed `m` (per §1) sealed from its hole-`x`s.
// Hole topology (CLOCKWISE_TRACK, safe-zone count, holding panels) is
// pure geometry — `kind: geometry` per PARADIGM.md §6 — so we recompute
// it on demand instead of storing it. We expose:
//
//   create({ clockwiseTrack, getHoleType, safeZoneSize, panels }) → seed
//
// The seed publishes:
//   .holes        Map<holeId, { id, number, type }>   (the hole `x` registry)
//   .firstHomeHoleFor(playerBoardPosition) → 'home-N' (lens helper)
//   .totalHoles   number
//
// No DOM. No THREE. No mutation after creation.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  var DEFAULT_SAFE_ZONE_SIZE = 4;
  var DEFAULT_PANELS = 6;
  var DEFAULT_HOLDING_PER_PANEL = 4;

  function create(spec) {
    spec = spec || {};
    var clockwiseTrack = spec.clockwiseTrack;
    var getHoleType = spec.getHoleType;
    if (!Array.isArray(clockwiseTrack) || typeof getHoleType !== 'function') {
      throw new Error('board.x: clockwiseTrack[] and getHoleType(id) are required');
    }
    var safeZoneSize = spec.safeZoneSize || DEFAULT_SAFE_ZONE_SIZE;
    var panels = spec.panels || DEFAULT_PANELS;
    var holdingPerPanel = spec.holdingPerPanel || DEFAULT_HOLDING_PER_PANEL;

    var holes = new Map();
    var num = 0;

    // ── outer track ──
    for (var i = 0; i < clockwiseTrack.length; i++) {
      var id = clockwiseTrack[i];
      holes.set(id, { id: id, number: num++, type: getHoleType(id) });
    }
    // ── safe zones (one ladder per panel) ──
    for (var p = 0; p < panels; p++) {
      for (var h = 1; h <= safeZoneSize; h++) {
        var sid = 'safe-' + p + '-' + h;
        holes.set(sid, { id: sid, number: num++, type: 'safezone' });
      }
    }
    // ── bullseye (the seal) ──
    holes.set('bullseye', { id: 'bullseye', number: num++, type: 'bullseye' });
    // ── holding pads ──
    for (var p2 = 0; p2 < panels; p2++) {
      for (var h2 = 0; h2 < holdingPerPanel; h2++) {
        var hid = 'hold-' + p2 + '-' + h2;
        holes.set(hid, { id: hid, number: num++, type: 'holding' });
      }
    }

    return {
      holes: holes,
      totalHoles: num,
      safeZoneSize: safeZoneSize,
      panels: panels,
      holdingPerPanel: holdingPerPanel,
      firstHomeHoleFor: function (boardPosition) {
        return 'home-' + boardPosition;
      }
    };
  }

  root.FastTrackX = root.FastTrackX || {};
  root.FastTrackX.board = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
