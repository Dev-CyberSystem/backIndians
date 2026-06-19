import { ORDER_STATUS_TRANSITIONS } from '../services/order.service';

// ── Tipos internos replicados para no importar modelos/DB ─────────────────────

type Role = 'admin' | 'billing' | 'workshop' | 'seller';
type Status =
  | 'pending' | 'under_review' | 'workshop_review' | 'observed'
  | 'in_production' | 'sewing' | 'stamping' | 'quality_check'
  | 'ready' | 'cancelled';

function canTransition(role: Role, from: Status, to: Status): boolean {
  return (ORDER_STATUS_TRANSITIONS[role]?.[from] ?? []).includes(to);
}

// ── Workshop: flujo completo de producción ────────────────────────────────────

describe('workshop transitions', () => {
  it('flujo completo: workshop_review → in_production → sewing → stamping → quality_check → ready', () => {
    expect(canTransition('workshop', 'workshop_review', 'in_production')).toBe(true);
    expect(canTransition('workshop', 'in_production',   'sewing')).toBe(true);
    expect(canTransition('workshop', 'sewing',          'stamping')).toBe(true);
    expect(canTransition('workshop', 'stamping',        'quality_check')).toBe(true);
    expect(canTransition('workshop', 'quality_check',   'ready')).toBe(true);
  });

  it('puede retroceder: stamping → sewing y sewing → in_production', () => {
    expect(canTransition('workshop', 'stamping', 'sewing')).toBe(true);
    expect(canTransition('workshop', 'sewing',   'in_production')).toBe(true);
  });

  it('puede observar desde workshop_review', () => {
    expect(canTransition('workshop', 'workshop_review', 'observed')).toBe(true);
  });

  it('NO puede saltear pasos: in_production → stamping directo', () => {
    expect(canTransition('workshop', 'in_production', 'stamping')).toBe(false);
  });

  it('NO puede cancelar (solo admin puede)', () => {
    expect(canTransition('workshop', 'sewing',   'cancelled')).toBe(false);
    expect(canTransition('workshop', 'stamping', 'cancelled')).toBe(false);
  });
});

// ── Admin: puede cancelar en cualquier estado activo ─────────────────────────

describe('admin transitions', () => {
  const cancelableStates: Status[] = [
    'pending', 'under_review', 'observed', 'workshop_review',
    'in_production', 'sewing', 'stamping', 'quality_check', 'ready',
  ];

  it.each(cancelableStates)('puede cancelar desde %s', (state) => {
    expect(canTransition('admin', state, 'cancelled')).toBe(true);
  });

  it('flujo completo admin (happy path)', () => {
    expect(canTransition('admin', 'pending',         'under_review')).toBe(true);
    expect(canTransition('admin', 'under_review',    'workshop_review')).toBe(true);
    expect(canTransition('admin', 'workshop_review', 'in_production')).toBe(true);
    expect(canTransition('admin', 'in_production',   'sewing')).toBe(true);
    expect(canTransition('admin', 'sewing',          'stamping')).toBe(true);
    expect(canTransition('admin', 'stamping',        'quality_check')).toBe(true);
    expect(canTransition('admin', 'quality_check',   'ready')).toBe(true);
  });

  it('puede retroceder en admin: stamping → sewing y sewing → in_production', () => {
    expect(canTransition('admin', 'stamping', 'sewing')).toBe(true);
    expect(canTransition('admin', 'sewing',   'in_production')).toBe(true);
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
    expect(canTransition('billing', 'in_production', 'sewing')).toBe(false);
    expect(canTransition('billing', 'sewing',        'stamping')).toBe(false);
  });
});

// ── Seller ────────────────────────────────────────────────────────────────────

describe('seller transitions', () => {
  it('solo puede reenviar observed → under_review', () => {
    expect(canTransition('seller', 'observed', 'under_review')).toBe(true);
  });

  it('NO puede avanzar estados de producción', () => {
    expect(canTransition('seller', 'pending',      'under_review')).toBe(false);
    expect(canTransition('seller', 'in_production', 'sewing')).toBe(false);
  });
});

// ── Los nuevos estados existen en la tabla ────────────────────────────────────

describe('nuevos estados sewing y stamping presentes en la tabla', () => {
  it('workshop tiene sewing y stamping definidos', () => {
    expect(ORDER_STATUS_TRANSITIONS.workshop).toHaveProperty('sewing');
    expect(ORDER_STATUS_TRANSITIONS.workshop).toHaveProperty('stamping');
  });

  it('admin tiene sewing y stamping definidos', () => {
    expect(ORDER_STATUS_TRANSITIONS.admin).toHaveProperty('sewing');
    expect(ORDER_STATUS_TRANSITIONS.admin).toHaveProperty('stamping');
  });
});
