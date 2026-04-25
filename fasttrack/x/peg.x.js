// fasttrack/x/peg.x.js — the PEG seed (`x`)
// ─────────────────────────────────────────────────────────────────────────
// Per PARADIGM.md §1: a peg is `x` (a point, a stored seed). Its current
// holeId, mood, captureCount, etc. are `z`s (depth) — derivable observations
// of the seed under the lens of *play*. We keep them on the seed object
// here only because the existing engine still mutates them; once the
// renderer + rules are extracted into `y/` lenses, those fields move out.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The seed: identity + invariants. NEVER mutate id / ownerIdx / pegSlot.
  // The remaining fields are gameplay deltas that the rules engine writes.
  function create(spec) {
    if (!spec || typeof spec.ownerIdx !== 'number' || typeof spec.pegSlot !== 'number') {
      throw new Error('peg.x: ownerIdx and pegSlot are required');
    }
    var assignName = (spec.assignNickname || function () { return ''; });
    var assignPers = (spec.assignPersonality || function () { return 'NEUTRAL'; });

    return {
      // ── identity (x — never null, never reassigned) ──
      id: 'p' + spec.ownerIdx + '-peg' + spec.pegSlot,
      ownerIdx: spec.ownerIdx,
      pegSlot: spec.pegSlot,
      nickname: assignName(),
      personality: assignPers(),

      // ── play-state deltas (will become z's once rules are a lens) ──
      holeId: 'holding',
      holeType: 'holding',
      onFasttrack: false,
      eligibleForSafeZone: false,
      lockedToSafeZone: false,
      completedCircuit: false,
      fasttrackEntryHole: null,
      mustExitFasttrack: false,
      mood: 'EAGER',
      captureCount: 0,
      timesCaptured: 0,
      rivalPegId: null
    };
  }

  root.FastTrackX = root.FastTrackX || {};
  root.FastTrackX.peg = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
