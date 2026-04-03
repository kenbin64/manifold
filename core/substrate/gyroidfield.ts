import { VecN } from "../geometry/vector";
import { GyroidForm, SchwartzDiamondForm } from "../geometry/gyroid";
import { ScalarField, VectorField } from "./field";
import { FlowField } from "../manifold/flow";

// GyroidCell: GyroidForm placed at 3D position in field.
export interface GyroidCell {
    readonly position: [number, number, number];
    readonly form: GyroidForm;
}

// GyroidField: Collection of positioned GyroidForms for triply-periodic topology.
// Nearest cell governs local geometry; bridges to field interfaces.
export class GyroidField {
    readonly cells: GyroidCell[];

    constructor(cells: GyroidCell[] = []) {
        this.cells = cells;
    }

    get cellCount(): number {
        return this.cells.length;
    }

    place(position: [number, number, number], form: GyroidForm): GyroidField {
        return new GyroidField([...this.cells, { position, form }]);
    }

    nearest(p: VecN): GyroidCell | null {
        if (this.cells.length === 0) return null;
        let best = this.cells[0];
        let bestDist = dist3(p, best.position);
        for (let i = 1; i < this.cells.length; i++) {
            const d = dist3(p, this.cells[i].position);
            if (d < bestDist) {
                bestDist = d;
                best = this.cells[i];
            }
        }
        return best;
    }

    scalarAt(p: VecN): number {
        const cell = this.nearest(p);
        if (!cell) return 0;
        const lx = p[0] - cell.position[0];
        const ly = p[1] - cell.position[1];
        const lz = p[2] - cell.position[2];
        return cell.form.valueAt([lx, ly, lz]);
    }

    gradientAt(p: VecN): VecN {
        const cell = this.nearest(p);
        if (!cell) return [0, 0, 0];
        return cell.form.gradientAt(p);
    }

    asScalarField(): ScalarField {
        return { valueAt: (p: VecN) => this.scalarAt(p) };
    }

    asVectorField(): VectorField {
        return { valueAt: (p: VecN) => this.gradientAt(p) };
    }

    asFlowField(): FlowField {
        return { velocity: (p: VecN) => this.gradientAt(p) };
    }
}

const dist3 = (p: VecN, pos: [number, number, number]): number => {
    const dx = p[0] - pos[0];
    const dy = p[1] - pos[1];
    const dz = p[2] - pos[2];
    return dx*dx + dy*dy + dz*dz;
};

// DiamondCell: SchwartzDiamondForm placed at 3D position.
export interface DiamondCell {
    readonly position: [number, number, number];
    readonly form: SchwartzDiamondForm;
}

// DiamondField: Triply-periodic Diamond topology with toroidal wrapping.
export class DiamondField {
    readonly cells: DiamondCell[];
    readonly period: number = 2 * Math.PI;

    constructor(cells: DiamondCell[] = []) {
        this.cells = cells;
    }

    get cellCount(): number {
        return this.cells.length;
    }

    place(position: [number, number, number], form: SchwartzDiamondForm): DiamondField {
        return new DiamondField([...this.cells, { position, form }]);
    }

    // Periodic nearest: wrap p to cell space
    nearest(p: VecN): DiamondCell | null {
        if (this.cells.length === 0) return null;

        const period = this.period;
        let bestDist = Infinity;
        let bestCell = this.cells[0];

        for (const cell of this.cells) {
            // Toroidal distance: min over ±period wraps
            const dx = ((p[0] - cell.position[0] + period/2) % period) - period/2;
            const dy = ((p[1] - cell.position[1] + period/2) % period) - period/2;
            const dz = ((p[2] - cell.position[2] + period/2) % period) - period/2;
            const d = dx*dx + dy*dy + dz*dz;
            if (d < bestDist) {
                bestDist = d;
                bestCell = cell;
            }
        }
        return bestCell;
    }

    scalarAt(p: VecN): number {
        const cell = this.nearest(p);
        if (!cell) return 0;
        const lx = p[0] - cell.position[0];
        const ly = p[1] - cell.position[1];
        const lz = cell.form.computeZ(lx, ly);  // z=xy primitive
        return cell.form.valueAt([lx, ly, lz]);
    }

    gradientAt(p: VecN): VecN {
        const cell = this.nearest(p);
        if (!cell) return [0, 0, 0];
        return cell.form.gradientAt(p);
    }

    asScalarField(): ScalarField {
        return { valueAt: (p: VecN) => this.scalarAt(p) };
    }

    asVectorField(): VectorField {
        return { valueAt: (p: VecN) => this.gradientAt(p) };
    }

    asFlowField(): FlowField {
        return { velocity: (p: VecN) => this.gradientAt(p) };
    }
};

