import { StoreOrderStatus } from '../models/StoreOrder';

/**
 * Flujo de estados de un pedido de la tienda online.
 *
 * Modelado configurable (no strings sueltos): las etiquetas, el orden visible en
 * la línea de tiempo, las transiciones válidas y los estados que requieren datos
 * de despacho viven acá y se validan en el backend antes de persistir.
 *
 * Camino feliz: paid → processing → shipped → delivered.
 * `pending_payment` es el estado inicial mientras no se acredita el pago.
 * `review` / `awaiting_courier` son pasos intermedios opcionales.
 * Fuera del camino feliz: cancelled, delayed, returned.
 */

// Etiquetas amigables (deben coincidir con STATUS_LABELS del frontend).
export const STORE_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  pending_payment:  'Pendiente de pago',
  paid:             'Pagado',
  processing:       'En preparación',
  review:           'En revisión',
  awaiting_courier: 'Esperando el correo',
  shipped:          'En camino',
  delivered:        'Entregado',
  cancelled:        'Cancelado',
  delayed:          'Demorado',
  returned:         'Devuelto',
};

// Orden canónico para dibujar la línea de tiempo del "camino feliz". Los estados
// fuera de este flujo (cancelled/delayed/returned) se muestran aparte.
export const STORE_STATUS_FLOW: StoreOrderStatus[] = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
];

// Estados que exigen transportista + N° de seguimiento para poder entrar.
export const STORE_STATUSES_REQUIRING_SHIPPING: StoreOrderStatus[] = ['shipped'];

/**
 * Transiciones válidas por estado (para admin/billing, los únicos roles que
 * cambian estados desde el sistema). Se valida en el backend: p. ej. no se puede
 * pasar de `delivered` a `processing`.
 *
 * `pending_payment → paid → cancelled` los mueve el flujo de pago automático
 * (webhook MP); acá los incluimos igual para permitir correcciones manuales.
 */
export const STORE_ORDER_TRANSITIONS: Partial<Record<StoreOrderStatus, StoreOrderStatus[]>> = {
  pending_payment:  ['paid', 'processing', 'cancelled'],
  paid:             ['processing', 'review', 'cancelled', 'delayed'],
  review:           ['processing', 'awaiting_courier', 'cancelled', 'delayed'],
  processing:       ['awaiting_courier', 'shipped', 'cancelled', 'delayed'],
  awaiting_courier: ['shipped', 'processing', 'cancelled', 'delayed'],
  // 'returned' ya no es una transición genérica de un click: se llega ahí
  // solo a través de POST /store/admin/orders/:id/returns (2.4), que registra
  // motivo + ítems + revisión en vez de un cambio de estado ciego (decisión
  // de negocio #4 — "requiere revisión"). Por eso no aparece como destino acá.
  shipped:          ['delivered', 'delayed', 'cancelled'],
  delayed:          ['processing', 'awaiting_courier', 'shipped', 'cancelled'],
  delivered:        [],
  returned:         ['processing', 'cancelled'],
  cancelled:        [],
};

export function isValidStoreTransition(from: StoreOrderStatus, to: StoreOrderStatus): boolean {
  return (STORE_ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function statusRequiresShipping(status: StoreOrderStatus): boolean {
  return STORE_STATUSES_REQUIRING_SHIPPING.includes(status);
}
