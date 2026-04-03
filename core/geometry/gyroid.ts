import { VecN } from "./vector";
import { dot } from "../ops";
import { SaddleForm } from "./saddle";
import { Point } from "../dimensional/point";
import { Transform, applyTransform } from "../transform/transform";

// Gyroid minimal surface: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) ≈ 0
// Signed distance approximation for implicit surface.
// Modulated by z=xy saddle primitive per periodic section (2π cells).
// Each point is point+dimension; object=dim of points (recursive).

export type GyroidFeatureKind = "zero" | "helix" | "labyrinth" | "saddle-mod" | "diamond-node";

export interface GyroidFeature {
    readonly kind: GyroidFeatureKind;
    readonly position: VecN; // [x, y, z]
    readonly value: number;  // f_gyroid at point
    readonly section: [number, number, number]; // Periodic cell indices
}

export class GyroidForm {
    readonly orientation: number; // Radians; Bonnet rotation to Schwarz D/Diamond

    constructor(orientation: number = 0) {
        this.orientation = orientation;
    }

    private gyroidValue(x: number, y: number, z: number): number {
        return (
            Math.sin(x) * Math.cos(y) +
            Math.sin(y) * Math.cos(z) +
            Math.sin(z) * Math.cos(x)
        );
    }

    protected saddleModulation(sectionX: number, sectionY: number, localX: number, localY: number): number {
        const saddle = new SaddleForm(this.orientation);
        return saddle.valueAt(localX + sectionX * 2 * Math.PI, localY + sectionY * 2 * Math.PI);
    }

    valueAt(pos: VecN): number {
        const [x, y, z] = pos;
        const sectionX = Math.floor(x / (2 * Math.PI));
        const sectionY = Math.floor(y / (2 * Math.PI));
        const sectionZ = Math.floor(z / (2 * Math.PI));
        const lx = x - sectionX * 2 * Math.PI;
        const ly = y - sectionY * 2 * Math.PI;
        const lz = z - sectionZ * 2 * Math.PI;

        const g = this.gyroidValue(lx, ly, lz);
        const s = this.saddleModulation(sectionX, sectionY, lx, ly);
        return g + 0.1 * s;  // Modulate z=xy primitive into gyroid sections
    }

    signedDistance(pos: VecN, epsilon: number = 1e-4): number {
        const f = this.valueAt(pos);
        const grad = this.gradientAt(pos, epsilon);
        return f / Math.sqrt(dot(grad, grad) + 1e-6);
    }

    gradientAt(pos: VecN, h: number = 1e-4): VecN {
        const f = (p: VecN) => this.valueAt(p);
        return [
            f([pos[0] + h, pos[1], pos[2]]) - f([pos[0] - h, pos[1], pos[2]]),
            f([pos[0], pos[1] + h, pos[2]]) - f([pos[0], pos[1] - h, pos[2]]),
            f([pos[0], pos[1], pos[2] + h]) - f([pos[0], pos[1], pos[2] - h])
        ].map((d: number) => d / (2 * h)) as VecN;
    }

    featuresAlongPath(path: VecN[]): GyroidFeature[] {
        if (path.length < 3) return [];

        const features: GyroidFeature[] = [];
        for (let i = 1; i < path.length - 1; i++) {
            const pos = path[i];
            const f = this.valueAt(pos);
            const section: [number, number, number] = [
                Math.floor(pos[0] / (2 * Math.PI)),
                Math.floor(pos[1] / (2 * Math.PI)),
                Math.floor(pos[2] / (2 * Math.PI))
            ];

            // Zero crossing: surface intersection
            const fPrev = this.valueAt(path[i - 1]);
            const fNext = this.valueAt(path[i + 1]);
            if ((fPrev * f <= 0) || (f * fNext <= 0)) {
                features.push({ kind: "zero", position: [...pos], value: f, section });
            }

            // Helix/curvature change (simplified)
            const grad = this.gradientAt(pos);
            const curvature = Math.abs(grad[2] - 0.5 * (this.valueAt([...pos, pos[2] + 0.1]) + this.valueAt([...pos, pos[2] - 0.1])));
            if (curvature > 0.5) {
                features.push({ kind: "helix", position: [...pos], value: f, section });
            }

            // Saddle modulation peak (z=xy extremum)
            if (Math.abs(f - this.saddleModulation(section[0], section[1], pos[0], pos[1])) < 0.05) {
                features.push({ kind: "saddle-mod", position: [...pos], value: f, section });
            }

            // Diamond node: high curvature intersection
            const curv = Math.abs(grad[0]*grad[1]*grad[2]);  // Product high at nodes
            if (curv > 1.5) {
                features.push({ kind: "diamond-node" as GyroidFeatureKind, position: [...pos], value: f, section });
            }
        }
        return features;
    }

    rotated(angle: number): GyroidForm {
        return new GyroidForm(this.orientation + angle);
    }

    labyrinthPair(): GyroidPair {
        return new GyroidPair(this.orientation);
    }
}

export class SchwartzDiamondForm extends GyroidForm {
    constructor(orientation: number = 0) {
        super(orientation);
    }

    private diamondTransform(pos: VecN): VecN {
        const s2 = Math.SQRT2;
        const x = pos[0], y = pos[1], z = pos[2];
        return [
            (x + y + z) / s2,
            (y + z - x) / s2,
            (z + x - y) / s2
        ] as VecN;
    }

    valueAt(pos: VecN): number {
        const dt = this.diamondTransform(pos);
        const g = super.valueAt(dt);
        return Math.SQRT2 * g;
    }

    computeZ(x: number, y: number): number {
        const sectionX = Math.floor(x / (2 * Math.PI));
        const sectionY = Math.floor(y / (2 * Math.PI));
        const s = this.saddleModulation(sectionX, sectionY, x % (2 * Math.PI), y % (2 * Math.PI));
        return x * y * (1 + 0.1 * s);
    }

    gyroidForm(): GyroidForm {
        return this;
    }

    rotated(angle: number): SchwartzDiamondForm {
        return new SchwartzDiamondForm(this.orientation + angle);
    }

    signedDistance(pos: VecN, epsilon: number = 1e-4): number {
        const f = this.valueAt(pos);
        const grad = this.gradientAt(pos, epsilon);
        return f / Math.sqrt(dot(grad, grad) + 1e-6);
    }
}

export class GyroidPair {
    readonly primary: GyroidForm;
    readonly secondary: GyroidForm;

    constructor(orientation: number = 0) {
        this.primary = new GyroidForm(orientation);
        this.secondary = new GyroidForm(orientation + Math.PI);
    }

    valueAt(pos: VecN): { primary: number; secondary: number } {
        return {
            primary: this.primary.valueAt(pos),
            secondary: this.secondary.valueAt(pos)
        };
    }

    coupling(pos: VecN): number {
        const { primary, secondary } = this.valueAt(pos);
        return primary * secondary;
    }
}

export class GyroidPoint extends Point {
    readonly form: GyroidForm;

    constructor(coords: number[], form: GyroidForm) {
        super(coords);
        this.form = form;
    }

    sub(...indices: number[]): GyroidPoint {
        const subCoords = indices.map(i => this.coord(i));
        return new GyroidPoint(subCoords, this.form.rotated(Math.PI / 4));
    }

    surfaceValue(): number {
        return this.form.valueAt(this.value as VecN);
    }

    features(): GyroidFeature[] {
        const path = [this.value as VecN, ...this.value.map((c: number, i: number) => {
            const delta = [...this.value];
            delta[i] += 0.1;
            return delta as VecN;
        })];

        return this.form.featuresAlongPath(path);
    }
}

export class DiamondPoint extends GyroidPoint {
    readonly form: SchwartzDiamondForm;

    constructor(coords: number[], form: SchwartzDiamondForm) {
        let fullCoords = coords.slice();
        if (coords.length === 2) {
            fullCoords.push(form.computeZ(coords[0], coords[1]));
        }
        super(fullCoords, form.gyroidForm());
        this.form = form;
    }

    sub(...indices: number[]): DiamondPoint {
        const subCoords = indices.map(i => this.coord(i));
        return new DiamondPoint(subCoords, this.form.rotated(Math.PI / 4));
    }

    surfaceValue(): number {
        return this.form.valueAt(this.value as VecN);
    }
}

