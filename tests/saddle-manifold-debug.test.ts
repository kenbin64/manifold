import { SaddleForm } from "../core/geometry/saddle";
import { SaddleField } from "../core/substrate/saddlefield";
import { saddleManifold, chartAt } from "../core/substrate/manifold";
import { applyTransform } from "../core/transform/transform";

const eps = 1e-9;
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const nearVec = (a: number[], b: number[], e = 1e-6) => {
    if (a.length !== b.length) return false;
    return a.every((v, i) => near(v, b[i], e));
};

describe("SaddleManifold substrate observation", () => {
    test("saddleManifold chartAt picks nearest cell and round-trips coordinates", () => {
        const field = new SaddleField()
            .place([0, 0], new SaddleForm(0))
            .place([10, 0], new SaddleForm(Math.PI / 2));

        const sm = saddleManifold(field);
        expect(sm.manifold.charts.length).toBe(2);

        // Point closer to cell [0,0]
        const p1 = [0.1, 0.2];
        const c1 = chartAt(sm, p1);
        expect(c1.basis.origin).toEqual([0, 0]);

        const local1 = applyTransform(c1.toLocal, p1);
        const round1 = applyTransform(c1.toWorld, local1);
        expect(nearVec(round1, p1)).toBe(true);

        const p2 = [9.8, 0.1];
        const c2 = chartAt(sm, p2);
        expect(c2.basis.origin).toEqual([10, 0]);

        const local2 = applyTransform(c2.toLocal, p2);
        const round2 = applyTransform(c2.toWorld, local2);
        expect(nearVec(round2, p2)).toBe(true);
    });

    test("SaddleField scalarAt/gradientAt are consistent with governing saddle cell", () => {
        const form = new SaddleForm(Math.PI / 4);
        const field = new SaddleField().place([2, 3], form);

        const p = [2.1, 3.2];
        const cell = field.nearest(p);
        expect(cell).not.toBeNull();
        if (cell) {
            const lx = p[0] - cell.position[0];
            const ly = p[1] - cell.position[1];
            expect(near(field.scalarAt(p), cell.form.valueAt(lx, ly))).toBe(true);

            const grad = field.gradientAt(p);
            // Use small step along x in local coords to approximate derivative
            const h = 1e-4;
            const f0 = field.scalarAt(p);
            const f1 = field.scalarAt([p[0] + h, p[1]]);
            const approxDx = (f1 - f0) / h;
            expect(near(grad[0], approxDx, 1e-3)).toBe(true);
        }
    });
});
