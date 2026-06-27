import { ORDER_STATUS_TRANSITIONS } from '../services/order.service';

// ── Tipos internos replicados para no importar modelos/DB ─────────────────────

type Role = 'admin' | 'billing' | 'workshop' | 'seller';
type Status =
  | 'pending' | 'under_review' | 'workshop_review' | 'observed'
  // Controles de producción (flujo nuevo, 6 controles de calidad)
  | 'raw_material_control' | 'cutting_control' | 'printing_control'
  | 'sewing_control' | 'quality_control' | 'packaging_control'
  | 'ready' | 'cancelled';

function canTransition(role: Role, from: Status, to: Status): boolean {
  return (ORDER_STATUS_TRANSITIONS[role]?.[from] ?? []).includes(to);
}

// Secuencia de los 6 controles, de inicio a fin.
const PRODUCTION_FLOW: Status[] = [
  'workshop_review',
  'raw_material_control',
  'cutting_control',
  'printing_control',
  'sewing_control',
  'quality_control',
  'packaging_control',
  'ready',
];

// ── Workshop: flujo completo de producción ────────────────────────────────────

describe('workshop transitions', () => {
  it('flujo completo: workshop_review → ...6 controles... → ready', () => {
    for (let i = 0; i < PRODUCTION_FLOW.length - 1; i++) {
      expect(canTransition('workshop', PRODUCTION_FLOW[i], PRODUCTION_FLOW[i + 1])).toBe(true);
    }
  });

  it('puede retroceder al control anterior (observar): cada control → el previo', () => {
    // Desde raw_material_control en adelante, cada control puede volver al anterior.
    for (let i = 2; i < PRODUCTION_FLOW.length - 1; i++) {
      expect(canTransition('workshop', PRODUCTION_FLOW[i], PRODUCTION_FLOW[i - 1])).toBe(true);
    }
  });

  it('puede observar desde workshop_review', () => {
    expect(canTransition('workshop', 'workshop_review', 'observed')).toBe(true);
  });

  it('NO puede saltear pasos: raw_material_control → printing_control directo', () => {
    expect(canTransition('workshop', 'raw_material_control', 'printing_control')).toBe(false);
  });

  it('NO puede cancelar (solo admin puede)', () => {
    expect(canTransition('workshop', 'cutting_control', 'cancelled')).toBe(false);
    expect(canTransition('workshop', 'sewing_control',  'cancelled')).toBe(false);
  });
});

// ── Admin: puede cancelar en cualquier estado activo ─────────────────────────

describe('admin transitions', () => {
  const cancelableStates: Status[] = [
    'pending', 'under_review', 'observed', 'workshop_review',
    'raw_material_control', 'cutting_control', 'printing_control',
    'sewing_control', 'quality_control', 'packaging_control', 'ready',
  ];

  it.each(cancelableStates)('puede cancelar desde %s', (state) => {
    expect(canTransition('admin', state, 'cancelled')).toBe(true);
  });

  it('flujo completo admin (happy path)', () => {
    expect(canTransition('admin', 'pending',      'under_review')).toBe(true);
    expect(canTransition('admin', 'under_review', 'workshop_review')).toBe(true);
    for (let i = 0; i < PRODUCTION_FLOW.length - 1; i++) {
      expect(canTransition('admin', PRODUCTION_FLOW[i], PRODUCTION_FLOW[i + 1])).toBe(true);
    }
  });

  it('puede retroceder en admin: cada control → el previo', () => {
    for (let i = 2; i < PRODUCTION_FLOW.length - 1; i++) {
      expect(canTransition('admin', PRODUCTION_FLOW[i], PRODUCTION_FLOW[i - 1])).toBe(true);
    }
  });
});

// ── Billing ───────────────────────────────────────────────────────────────────

describe('billing transitions', () => {
  it('pending → under_review', () => {
    expect(canTransition('billing', 'pending', 'under_review')).toBe(true);
  });

  it('under_review → observed o workshop_review', () => {
    expect(canTransition('billing', 'under_review', 'observed')).toBe(true);
    expect(canTransition('billing', 'under_review', 'workshop_review')).toBe(true);
  });

  it('NO puede mover estados de producción', () => {
    expect(canTransition('billing', 'raw_material_control', 'cutting_control')).toBe(false);
    expect(canTransition('billing', 'sewing_control',       'quality_control')).toBe(false);
  });
});

// ── Seller ────────────────────────────────────────────────────────────────────

describe('seller transitions', () => {
  it('solo puede reenviar observed → under_review', () => {
    expect(canTransition('seller', 'observed', 'under_review')).toBe(true);
  });

  it('NO puede avanzar estados de producción', () => {
    expect(canTransition('seller', 'pending',              'under_review')).toBe(false);
    expect(canTransition('seller', 'raw_material_control', 'cutting_control')).toBe(false);
  });
});

// ── Los 6 controles existen en la tabla ───────────────────────────────────────

describe('los 6 controles de producción están presentes en la tabla', () => {
  const controls: Status[] = [
    'raw_material_control', 'cutting_control', 'printing_control',
    'sewing_control', 'quality_control', 'packaging_control',
  ];

  it.each(controls)('workshop tiene %s definido', (control) => {
    expect(ORDER_STATUS_TRANSITIONS.workshop).toHaveProperty(control);
  });

  it.each(controls)('admin tiene %s definido', (control) => {
    expect(ORDER_STATUS_TRANSITIONS.admin).toHaveProperty(control);
  });
});
