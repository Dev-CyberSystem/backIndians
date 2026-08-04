import { Op } from 'sequelize';
import { StoreOrder } from '../models/StoreOrder';
import { confirmStorePayment } from '../services/store.service';
import { logger } from '../utils/logger';

const DEFAULT_STALE_MINUTES = 5;

function getStaleMinutes(): number {
  const raw = parseInt(process.env.RECONCILE_STALE_MINUTES ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_MINUTES;
}

/**
 * Job de reconciliación de pagos (1.8 / C-8 parcial). Busca pedidos que
 * quedaron "pending_payment" con MercadoPago hace más de N minutos y
 * consulta a MP si en realidad ya se acreditaron — cubre el caso del
 * webhook que nunca llega (C-2) y el cliente que nunca vuelve al sitio a
 * confirmar. Reutiliza `confirmStorePayment()` tal cual: ya es idempotente,
 * ya valida monto/moneda antes de acreditar y ya descarta eventos
 * desordenados (1.5) — este job no reimplementa nada de eso.
 *
 * Un error en un pedido individual (p. ej. la API de MP caída un momento)
 * no debe frenar la reconciliación del resto — se loguea y se sigue.
 */
export async function reconcilePendingPayments(): Promise<{ checked: number; updated: number; errors: number }> {
  const staleMinutes = getStaleMinutes();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);

  const orders = await StoreOrder.findAll({
    where: {
      status: 'pending_payment',
      payment_method: 'mercadopago',
      createdAt: { [Op.lte]: cutoff },
    },
    attributes: ['id', 'order_number', 'status'],
  });

  let updated = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      const before = order.status;
      const result = await confirmStorePayment({ orderNumber: order.order_number });
      if (result.status !== before) updated++;
    } catch (err) {
      errors++;
      logger.error('jobs.reconcilePayments.orderFailed', err, {
        meta: { orderNumber: order.order_number },
      });
    }
  }

  if (orders.length > 0) {
    logger.info('jobs.reconcilePayments.run', {
      meta: { checked: orders.length, updated, errors, staleMinutes },
    });
  }

  return { checked: orders.length, updated, errors };
}
