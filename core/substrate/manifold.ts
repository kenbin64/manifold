import { Chart } from '../manifold/manifold';
import { GyroidField } from './gyroidfield';
import { saddleManifold } from './manifold';  // Existing

// Stub for gyroidManifold - extend atlas to 3D charts in future.
// For now, return field as scalar topology.
export const gyroidManifold = (field: GyroidField): any => {
    console.warn('Gyroid manifold atlas 3D WIP; using scalar field');
    return {
        field,
        charts: [],  // Future 3D charts
        scalarAt: (p: VecN) => field.scalarAt(p),
    };
};

