import { Op } from 'sequelize';
import { CatalogOrder, CatalogInvoice } from '../models';
import { confirmCatalogPayment } from '../services/catalog.service';
import { logger } from '../utils/logger';

const DEFAULT_STALE_MINUTES = 5;
const DEFAULT_LOOKBACK_DAYS = 30;

function getStaleMinutes(): number {
  const raw = parseInt(process.env.RECONCILE_STALE_MINUTES ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_MINUTES;
}

function getLookbackDays(): number {
  const raw = parseInt(process.env.CATALOG_RECONCILE_LOOKBACK_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOOKBACK_DAYS;
}

/**
 * Reconciliación de pagos de MercadoPago de las ventas de catálogo — el
 * equivalente de `reconcilePayments.ts` para el circuito mayorista.
 *
 * Por qué hace falta además del webhook: el webhook puede no llegar nunca
 * (MP_WEBHOOK_SECRET sin configurar hace que se rechacen todas las
 * notificaciones — ver DEC-014; y una preference vieja se creó sin
 * `notification_url`). En el catálogo esto es todavía más probable que en la
 * tienda, porque el flujo típico es un QR que el cliente escanea desde SU
 * teléfono: nadie vuelve al panel a confirmar nada. Sin este job, un pedido
 * cobrado se ve igual que uno impago.
 *
 * Busca pedidos con link/QR de pago generado (`mp_preference_id`) cuya factura
 * todavía no está saldada, y le pregunta a MP si en realidad ya se cobraron.
 * Reutiliza `confirmCatalogPayment()`, que es idempotente y valida moneda
 * antes de acreditar — este job no reimplementa nada de eso.
 *
 * La ventana hacia atrás (`CATALOG_RECONCILE_LOOKBACK_DAYS`, 30 por defecto)
 * existe para no consultar a MP indefinidamente por pedidos viejos que
 * simplemente nunca se pagaron por ese medio.
 */
export async function reconcileCatalogPayments(): Promise<{ checked: number; updated: number; errors: number }> {
  const staleMinutes = getStaleMinutes();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const lookbackFrom = new Date(Date.now() - getLookbackDays() * 24 * 60 * 60_000);

  const orders = await CatalogOrder.findAll({
    where: {
      mp_preference_id: { [Op.ne]: null },
      createdAt: { [Op.lte]: cutoff, [Op.gte]: lookbackFrom },
    },
    include: [{
      model: CatalogInvoice,
      as: 'invoice',
      required: true,
      // Anulada no se cobra, y saldada ya no tiene nada que reconciliar.
      where: { status: { [Op.notIn]: ['paid', 'cancelled'] } },
      attributes: ['id', 'status'],
    }],
    attributes: ['id', 'order_number'],
  });

  let updated = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      const results = await confirmCatalogPayment(order.order_number);
      if (results.some((r) => r.applied)) updated++;
    } catch (err) {
      errors++;
      logger.error('jobs.reconcileCatalogPayments.orderFailed', err, {
        meta: { orderNumber: order.order_number },
      });
    }
  }

  if (orders.length > 0) {
    logger.info('jobs.reconcileCatalogPayments.run', {
      meta: { checked: orders.length, updated, errors, staleMinutes },
    });
  }

  return { checked: orders.length, updated, errors };
}
