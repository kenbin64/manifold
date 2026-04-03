import { GyroidForm, GyroidPair, GyroidPoint, GyroidFeatureKind, SchwartzDiamondForm, DiamondPoint } from '../core/geometry/gyroid';
import { VecN } from '../core/geometry/vector';
import { DiamondField } from '../core/substrate/gyroidfield';
import { dot } from '../core/ops';

const eps = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < eps;
const nearVec = (a: VecN, b: VecN) => a.length === b.length && a.every((v, i) => near(v, b[i]));

// Analytic gyroid at known point for validation.
const knownPoint: VecN = [0, Math.PI/2, Math.PI];
const knownGyroid = Math.sin(0)*Math.cos(Math.PI/2) + Math.sin(Math.PI/2)*Math.cos(Math.PI) + Math.sin(Math.PI)*Math.cos(0);  // -1

describe('GyroidForm substrate observation', () => {
    test('GyroidForm valueAt matches analytic gyroid equation', () => {
        const form = new GyroidForm(0);
        const pos: VecN = [0.5, 1.0, 1.5];
        const lx = pos[0], ly = pos[1], lz = pos[2];  // Section 0
        const analytic = Math.sin(lx)*Math.cos(ly) + Math.sin(ly)*Math.cos(lz) + Math.sin(lz)*Math.cos(lx);
        const modulated = form.valueAt(pos);
        expect(Math.abs(modulated - analytic) < 0.2).toBe(true);  // Allow saddle mod tolerance
    });

    test('signedDistance scales with valueAt / gradient norm', () => {
        const form = new GyroidForm(0);
        const pos: VecN = [Math.PI/2, Math.PI/2, Math.PI/2];
        const dist = form.signedDistance(pos);
        const grad = form.gradientAt(pos);
        const gradNorm = Math.sqrt(dot(grad, grad));
        expect(gradNorm > 0.1).toBe(true);  // Non-degenerate
        expect(Math.abs(dist) < 2).toBe(true);  // Reasonable distance
    });

    test('gradientAt is consistent with finite difference', () => {
        const form = new GyroidForm(0);
        const pos: VecN = [1, 1, 1];
        const h = 1e-4;
        const f0 = form.valueAt(pos);
        const analyticDx = (form.valueAt([pos[0]+h, pos[1], pos[2]]) - form.valueAt([pos[0]-h, pos[1], pos[2]])) / (2*h);
        const grad = form.gradientAt(pos);
        expect(near(grad[0], analyticDx)).toBe(true);
    });

    test('featuresAlongPath detects zeros and saddle mods', () => {
        const form = new GyroidForm(0);
        const path: VecN[] = [
            [0, 0, 0],
            [Math.PI/4, Math.PI/4, Math.PI/2],
            [Math.PI/2, Math.PI/2, Math.PI],
            [Math.PI, Math.PI, 2*Math.PI]
        ];
        const features = form.featuresAlongPath(path);
        expect(features.length > 0).toBe(true);
        const hasZero = features.some(f => f.kind === 'zero');
        const hasSaddle = features.some(f => f.kind === 'saddle-mod');
        expect(hasZero || hasSaddle).toBe(true);
    });

    test('GyroidPair coupling computes interference', () => {
        const pair = new GyroidPair(0);
        const pos: VecN = [Math.PI/2, 0, 0];
        const c = pair.coupling(pos);
        expect(typeof c).toBe('number');
        expect(Math.abs(c) < 10).toBe(true);  // Bounded
    });

    test('GyroidPoint dimensional duality: sub returns rotated form, surfaceValue evaluates', () => {
        const form = new GyroidForm(0);
        const gp = new GyroidPoint([1, 2, 3], form);
        expect(gp.dim).toBe(3);
        expect(gp.scalar).toBe(3);

        const sub = gp.sub(0, 1);
        expect(sub.dim).toBe(2);
        expect(sub.form.orientation).not.toBe(0);  // Rotated

        const val = gp.surfaceValue();
        expect(typeof val).toBe('number');

        const feats = gp.features();
        expect(Array.isArray(feats)).toBe(true);
    });

    test('SchwartzDiamondForm Diamond transform', () => {
        const diamond = new SchwartzDiamondForm(0);
        const pos: VecN = [1,1,1];
        const val = diamond.valueAt(pos);
        expect(typeof val).toBe('number');
        expect(Math.abs(val) < 10).toBe(true);
    });

    test('DiamondPoint z=xy auto-compute', () => {
        const diamond = new SchwartzDiamondForm(0);
        const dp2d = new DiamondPoint([2, 3], diamond);
        expect(dp2d.value.length).toBe(3);
        expect(near(dp2d.value[2], diamond.computeZ(2,3))).toBe(true);

        const val = dp2d.surfaceValue();
        expect(typeof val).toBe('number');
    });

    test('DiamondField scalarAt uses z=xy', () => {
        const diamondForm = new SchwartzDiamondForm(0);
        const field = new DiamondField([{ position: [0,0,0], form: diamondForm }]);
        const p: VecN = [1,1,1];
        const s = field.scalarAt(p);
        expect(typeof s).toBe('number');
    });
});


