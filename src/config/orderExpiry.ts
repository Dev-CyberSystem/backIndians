/**
 * Ventana de expiración de un pedido de tienda impago (BR-STORE-004).
 *
 * Vivía como constante privada dentro de `jobs/expireStaleOrders.ts`, que era el
 * único que la necesitaba. Dejó de alcanzar cuando el plazo pasó a comunicarse
 * al comprador ANTES de que venza — en el mail de confirmación del pedido, en la
 * pantalla de espera del pago y en "Mis pedidos". Si cada uno hardcodea "48",
 * cambiar `ORDER_EXPIRY_HOURS` en Railway hace que el sistema le prometa al
 * cliente un plazo distinto del que efectivamente aplica el job.
 *
 * Este módulo es la única fuente de verdad: el job la usa para cancelar, y
 * `getPublicStoreSettings()` la publica a la tienda como `order_expiry_hours`.
 */

const DEFAULT_ORDER_EXPIRY_HOURS = 48;

export function getOrderExpiryHours(): number {
  const raw = parseInt(process.env.ORDER_EXPIRY_HOURS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ORDER_EXPIRY_HOURS;
}

/**
 * ¿Este pedido está sujeto a la expiración automática?
 *
 * Es el MISMO criterio que el `where` de `expireStaleOrders()` — si los dos se
 * separan, el sistema le avisa al comprador que su pedido vence y después no lo
 * cancela (o peor: lo cancela sin haberle avisado). Cualquier cambio va acá y en
 * el job a la vez.
 *
 * - `mercadopago`: siempre expira.
 * - `bank_transfer`: expira solo si NO subió comprobante. Con comprobante ya
 *   subido el comprador hizo su parte y solo falta que un admin lo revise.
 * - `cash`: nunca (pago presencial, no es un pago online abandonado).
 */
export function orderExpiresUnpaid(
  paymentMethod: string | null | undefined,
  hasPaymentProof: boolean
): boolean {
  if (paymentMethod === 'mercadopago') return true;
  if (paymentMethod === 'bank_transfer') return !hasPaymentProof;
  return false;
}
