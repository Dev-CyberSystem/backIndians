import { Op } from 'sequelize';
import { StoreOrder } from '../models/StoreOrder';
import { StoreReturn } from '../models/StoreReturn';
import { Invoice } from '../models/Invoice';
import { CatalogInvoice } from '../models/CatalogInvoice';
import { logger } from '../utils/logger';
import { sendAlert } from '../utils/alerts';

const DEFAULT_EXPIRY_HOURS = 48;
function getExpiryHours(): number {
  const raw = parseInt(process.env.ORDER_EXPIRY_HOURS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPIRY_HOURS;
}

/**
 * Job diario de detección de inconsistencias (1.8 / C-8 parcial, ampliado en
 * 2.7 / C-7). Son estados que, dado el diseño actual, NUNCA deberían ocurrir
 * — es una red de seguridad para encontrar bugs, jobs caídos o ediciones
 * manuales de la base, no un flujo esperado.
 *
 * Loguea cada hallazgo por separado (ERROR, estructurado y buscable) y, desde
 * D-02 de la auditoría del 2026-08-19, además manda UNA alerta con el resumen
 * cuando encontró algo. Antes sólo logueaba: el job podía detectar pedidos
 * pagados sin asiento en caja a las 03:00 y nadie enterarse hasta que alguien
 * abriera los logs de Railway por otro motivo — lo que anota
 * `documentos/ALERTAS_Y_MONITOREO.md` como pendiente.
 *
 * Una sola alerta con todo, y no una por tipo, a propósito: seis mensajes de
 * madrugada se ignoran en bloque; uno con el detalle se lee.
 *
 * Sigue sin haber una bandeja de alertas de admin persistente (ver B-7 de la
 * auditoría) — queda para una fase posterior.
 */
export async function reportDailyInconsistencies(): Promise<{
  cancelledWithoutRestock: number;
  approvedButPending: number;
  staleUnreleasedReservations: number;
  paidWithoutCashEntry: number;
  afipErrors: number;
  approvedReturnsWithoutRefundUpdate: number;
}> {
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

  // Reserva de stock (2.1) que debería haber expirado hace rato y seguir
  // pending_payment — expireStaleOrders (2.2) corre cada hora, así que un
  // pedido con más del doble de la ventana configurada sin expirar indica
  // que el job dejó de correr o está fallando silenciosamente.
  const staleCutoff = new Date(Date.now() - getExpiryHours() * 2 * 3_600_000);
  const staleUnreleasedReservations = await StoreOrder.findAll({
    where: {
      status: 'pending_payment',
      stock_reserved_at: { [Op.lte]: staleCutoff },
    },
    attributes: ['id', 'order_number', 'stock_reserved_at'],
  });

  // Pedido que ya confirmó stock (pago acreditado) pero nunca quedó
  // registrado en caja/banco (2.3) — típicamente porque falta configurar la
  // cuenta que corresponde a su medio de pago (`store_cash_account_id` para
  // efectivo, `store_bank_account_id` para MercadoPago/transferencia desde
  // la Fase 3). No es un bug de código, pero es plata que no se está viendo
  // en la conciliación — vale la pena que el admin lo sepa.
  const paidWithoutCashEntry = await StoreOrder.findAll({
    where: {
      stock_confirmed_at: { [Op.not]: null },
      cash_recorded_at: null,
    },
    attributes: ['id', 'order_number', 'payment_method'],
  });

  // Comprobantes (pedidos de fábrica, catálogo o tienda) que quedaron en
  // afip_status='error' — necesitan que un admin los reintente a mano desde
  // el botón "Reintentar AFIP" (2.5).
  const [invoiceAfipErrors, catalogInvoiceAfipErrors, storeOrderAfipErrors] = await Promise.all([
    Invoice.count({ where: { afip_status: 'error' } }),
    CatalogInvoice.count({ where: { afip_status: 'error' } }),
    StoreOrder.count({ where: { afip_status: 'error' } }),
  ]);
  const afipErrors = invoiceAfipErrors + catalogInvoiceAfipErrors + storeOrderAfipErrors;

  // Devolución aprobada (2.4) hace más de 7 días sin que se haya actualizado
  // el estado de reintegro — el reintegro se ejecuta manualmente desde
  // MercadoPago (decisión de negocio #5); esto solo avisa que quedó sin
  // seguimiento, no dispara nada.
  const returnFollowUpCutoff = new Date(Date.now() - 7 * 24 * 3_600_000);
  const approvedReturnsWithoutRefundUpdate = await StoreReturn.findAll({
    where: {
      status: 'approved',
      refund_status: 'none',
      reviewed_at: { [Op.lte]: returnFollowUpCutoff },
    },
    attributes: ['id', 'store_order_id', 'reviewed_at'],
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

  if (staleUnreleasedReservations.length > 0) {
    logger.error(
      'jobs.reportInconsistencies.staleUnreleasedReservations',
      new Error(`${staleUnreleasedReservations.length} pedido(s) con reserva de stock vencida sin expirar (¿job expireStaleOrders caído?)`),
      { meta: { orderNumbers: staleUnreleasedReservations.map((o) => o.order_number) } }
    );
  }

  if (paidWithoutCashEntry.length > 0) {
    const missingCash = paidWithoutCashEntry.filter((o) => o.payment_method === 'cash');
    const missingBank = paidWithoutCashEntry.filter((o) => o.payment_method !== 'cash');
    logger.error(
      'jobs.reportInconsistencies.paidWithoutCashEntry',
      new Error(
        `${paidWithoutCashEntry.length} pedido(s) pagado(s) sin registro en caja/banco `
        + `(¿falta configurar store_cash_account_id o store_bank_account_id?)`
      ),
      {
        meta: {
          orderNumbers: paidWithoutCashEntry.map((o) => o.order_number),
          missingCashAccountConfig: missingCash.map((o) => o.order_number),
          missingBankAccountConfig: missingBank.map((o) => o.order_number),
        },
      }
    );
  }

  if (afipErrors > 0) {
    logger.error(
      'jobs.reportInconsistencies.afipErrors',
      new Error(`${afipErrors} comprobante(s) con envío a AFIP en estado error`),
      { meta: { invoices: invoiceAfipErrors, catalogInvoices: catalogInvoiceAfipErrors, storeOrders: storeOrderAfipErrors } }
    );
  }

  if (approvedReturnsWithoutRefundUpdate.length > 0) {
    logger.error(
      'jobs.reportInconsistencies.approvedReturnsWithoutRefundUpdate',
      new Error(`${approvedReturnsWithoutRefundUpdate.length} devolución(es) aprobada(s) hace más de 7 días sin actualizar el estado de reintegro`),
      { meta: { returnIds: approvedReturnsWithoutRefundUpdate.map((r) => r.id) } }
    );
  }

  const resumen: Array<[string, number]> = [
    ['Pedidos cancelados sin restituir stock', cancelledWithoutRestock.length],
    ['Pagos aprobados en MercadoPago sin acreditar en el pedido', approvedButPending.length],
    ['Reservas de stock vencidas sin expirar (¿job expireStaleOrders caído?)', staleUnreleasedReservations.length],
    ['Pedidos pagados sin asiento en caja/banco', paidWithoutCashEntry.length],
    ['Comprobantes con envío a AFIP en error', afipErrors],
    ['Devoluciones aprobadas hace +7 días sin estado de reintegro', approvedReturnsWithoutRefundUpdate.length],
  ];
  const encontradas = resumen.filter(([, cantidad]) => cantidad > 0);

  if (encontradas.length > 0) {
    const total = encontradas.reduce((acc, [, cantidad]) => acc + cantidad, 0);
    await sendAlert({
      key: 'inconsistencias-diarias',
      severity: 'warning',
      title: `${total} inconsistencia(s) detectadas en el control diario`,
      detail:
        `El control de las 03:00 encontró estados que no deberían ocurrir:\n\n` +
        encontradas.map(([etiqueta, cantidad]) => `  - ${etiqueta}: ${cantidad}`).join('\n') +
        `\n\nEl detalle (números de pedido, ids) está en los logs de Railway, ` +
        `filtrando por "jobs.reportInconsistencies".`,
    });
  }

  return {
    cancelledWithoutRestock: cancelledWithoutRestock.length,
    approvedButPending: approvedButPending.length,
    staleUnreleasedReservations: staleUnreleasedReservations.length,
    paidWithoutCashEntry: paidWithoutCashEntry.length,
    afipErrors,
    approvedReturnsWithoutRefundUpdate: approvedReturnsWithoutRefundUpdate.length,
  };
}
