/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD CORE — z = x · y
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The genuine manifold substrate. No Maps-with-labels. No fake hashing.
 *
 * PathExpression: A coordinate (section, x, y) on the saddle surface.
 *   z = x · y IS the value. Not a function that returns one — IT IS ONE.
 *
 * RepresentationTable: Two labyrinths sharing a surface.
 *   Labyrinth A (Encode): Write path expressions — sets x,y coordinates.
 *   Labyrinth B (Decode): Read z — the product x·y, cached via delta.
 *   The surface between them IS the manifold.
 *
 * Delta Caching: O(1) idle cost.
 *   encode-side marks dirty. decode-side returns cached z if clean.
 *   No reconstruction. No iteration. No JSON.
 *
 * Dimensional Hierarchy (7-section helix):
 *   0=Void  1=Point  2=Line  3=Width  4=Plane  5=Volume  6=Whole
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HELIX = Object.freeze({
  VOID: 0, POINT: 1, LINE: 2, WIDTH: 3, PLANE: 4, VOLUME: 5, WHOLE: 6,
});

// ─── PathExpression ─────────────────────────────────────────────────────
// A coordinate on the saddle surface. z = x · y.
class PathExpression {
  constructor(section, x, y) {
    this.section = section;
    this.x = x;
    this.y = y;
  }
  /** z-invocation: the value IS the traversal */
  get z() { return this.x * this.y; }

  /** Decompose a numeric value into (x, y) such that x·y = value */
  static fromValue(section, value) {
    if (value === 0) return new PathExpression(section, 0, 0);
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    const root = Math.sqrt(abs);
    return new PathExpression(section, root, sign * root);
  }

  /** Equality on the manifold surface */
  equals(other) {
    return other && this.section === other.section
      && this.x === other.x && this.y === other.y;
  }
}

// ─── RepresentationTable ────────────────────────────────────────────────
// Two-labyrinth structure with delta caching.
// Labyrinth A (encode): stores PathExpressions keyed by address.
// Labyrinth B (decode): caches z values, recomputes only when dirty.
// String addresses are stored directly — strings ARE paths.
class RepresentationTable {
  constructor(name) {
    this.name = name;
    // Labyrinth A: encode-side path expressions (address → PathExpression)
    this._paths = Object.create(null);
    // Labyrinth B: decode-side cached z values (address → number)
    this._cache = Object.create(null);
    // Delta tracking: which addresses are dirty since last decode
    this._dirty = Object.create(null);
    // String labyrinth: strings are paths, not encoded values
    this._strings = Object.create(null);
    // Delta set: addresses changed since last flush
    this._deltaSet = new Set();
  }

  // ═══ Labyrinth A: Encode ═══════════════════════════════════════════
  /** Encode a numeric value as a path expression (z = x·y = value) */
  encode(address, value, section = HELIX.POINT) {
    const prev = this._paths[address];
    const path = PathExpression.fromValue(section, value);
    if (prev && prev.equals(path)) return; // no change — zero cost
    this._paths[address] = path;
    this._dirty[address] = true;
    this._deltaSet.add(address);
  }

  /** Encode a string address (strings ARE paths, no decomposition) */
  encodeString(address, value) {
    if (this._strings[address] === value) return; // no change
    this._strings[address] = value;
    this._dirty[address] = true;
    this._deltaSet.add(address);
  }

  // ═══ Labyrinth B: Decode ═══════════════════════════════════════════
  /** Decode a numeric value: z = x·y. O(1) if clean (delta cached). */
  decode(address) {
    if (!this._dirty[address] && address in this._cache) {
      return this._cache[address]; // O(1) — delta cache hit
    }
    const path = this._paths[address];
    if (!path) return undefined;
    const z = path.z; // z-invocation: x · y
    this._cache[address] = z;
    this._dirty[address] = false;
    return z;
  }

  /** Decode a string address */
  decodeString(address) {
    return this._strings[address];
  }

  /** Check if an address exists in either labyrinth */
  has(address) {
    return address in this._paths || address in this._strings;
  }

  // ═══ Delta Operations ══════════════════════════════════════════════
  /** Get all addresses changed since last flush */
  deltas() { return this._deltaSet; }

  /** Flush delta set (call after synchronization) */
  flushDeltas() { this._deltaSet = new Set(); }

  /** Check if any address is dirty */
  get isDirty() { return this._deltaSet.size > 0; }
}

// ─── Manifold Proportion Engine ─────────────────────────────────────────
// Derives proportions from z = x·y where x=bodyCoord, y=genderCoord.
// No hardcoded lookup tables. The proportion IS the saddle product.
const ManifoldProportion = {
  // Body type coordinates on the x-axis of the saddle
  BODY_X: Object.freeze({
    slim: 0.85, average: 1.0, athletic: 1.1, heavy: 1.25,
  }),
  // Gender coordinates on the y-axis of the saddle
  GENDER_Y: Object.freeze({
    male: 1.05, female: 0.95, neutral: 1.0,
  }),
  /**
   * Derive a proportion via z = x·y (saddle product).
   * @param {string} bodyType - slim|average|athletic|heavy
   * @param {string} gender - male|female|neutral
   * @param {number} base - base dimension value
   * @returns {number} z = bodyCoord · genderCoord · base
   */
  derive(bodyType, gender, base) {
    const x = this.BODY_X[bodyType] || 1.0;
    const y = this.GENDER_Y[gender] || 1.0;
    return x * y * base; // z = x · y · base
  },
};

// ─── Exports ────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.HELIX = HELIX;
  window.PathExpression = PathExpression;
  window.RepresentationTable = RepresentationTable;
  window.ManifoldProportion = ManifoldProportion;
}
if (typeof module !== 'undefined') {
  module.exports = { HELIX, PathExpression, RepresentationTable, ManifoldProportion };
}

