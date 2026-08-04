import { StoreOrder } from '../models/StoreOrder';
import { logger } from '../utils/logger';

/**
 * Job diario de detección de inconsistencias (1.8 / C-8 parcial). Son
 * estados que, dado el diseño actual (1.3/1.5), NUNCA deberían ocurrir —
 * esto es una red de seguridad para encontrar bugs o ediciones manuales de
 * la base, no un flujo esperado. Solo loguea (ERROR, estructurado y
 * buscable); no hay todavía una bandeja de alertas de admin persistente
 * (ver B-7 de la auditoría) — queda para una fase posterior.
 */
export async function reportDailyInconsistencies(): Promise<{ cancelledWithoutRestock: number; approvedButPending: number }> {
  // Pedido cancelado sin restituir stock — restoreStoreOrderStock (1.3) se
  // dispara siempre al entrar en 'cancelled', así que esto nunca debería
  // tener resultados salvo un bug o una edición manual de la base.
  const cancelledWithoutRestock = await StoreOrder.findAll({
    where: { status: 'cancelled', stock_restored_at: null },
    attributes: ['id', 'order_number'],
  });

  // MercadoPago confirmó el pago (mp_status='approved') pero el pedido se
  // quedó en pending_payment — applyPaymentResult (1.5) siempre pasa a
  // 'paid' en ese caso, así que esto indica que algo no se aplicó bien.
  const approvedButPending = await StoreOrder.findAll({
    where: { status: 'pending_payment', mp_status: 'approved' },
    attributes: ['id', 'order_number'],
  });

  if (cancelledWithoutRestock.length > 0) {
    logger.error(
      'jobs.reportInconsistencies.cancelledWithoutRestock',
      new Error(`${cancelledWithoutRestock.length} pedido(s) cancelado(s) sin restituir stock`),
      { meta: { orderNumbers: cancelledWithoutRestock.map((o) => o.order_number) } }
    );
  }

  if (approvedButPending.length > 0) {
    logger.error(
      'jobs.reportInconsistencies.approvedButPending',
      new Error(`${approvedButPending.length} pedido(s) con pago aprobado pero sin acreditar`),
      { meta: { orderNumbers: approvedButPending.map((o) => o.order_number) } }
    );
  }

  return {
    cancelledWithoutRestock: cancelledWithoutRestock.length,
    approvedButPending: approvedButPending.length,
  };
}
