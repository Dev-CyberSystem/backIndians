import { Op } from 'sequelize';
import { StoreOrder } from '../models/StoreOrder';
import { recordStoreOrderStatusChange } from '../services/store.service';
import { logger } from '../utils/logger';

const DEFAULT_EXPIRY_HOURS = 48;

function getExpiryHours(): number {
  const raw = parseInt(process.env.ORDER_EXPIRY_HOURS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPIRY_HOURS;
}

/**
 * Job de expiración de pedidos impagos (2.2 — Fase 2). Cancela pedidos
 * `pending_payment` de más de 48hs — misma ventana para MercadoPago y
 * transferencia (decisión de negocio #3, respuesta explícita del usuario:
 * "Tiene que ser el mismo tiempo para ambas formas de pago"). Reutiliza
 * `recordStoreOrderStatusChange` tal cual: hereda gratis la liberación de la
 * reserva de stock (2.1) vía `restoreStoreOrderStock`, la liberación del
 * cupón y el mail de "cancelado" al comprador — no reimplementa nada de eso.
 *
 * Efectivo queda afuera a propósito: implica pago/retiro en persona, no es
 * "pago online abandonado" — no tiene sentido expirarlo automáticamente.
 *
 * Transferencia con comprobante YA subido (`payment_proof_url`) también
 * queda afuera: el comprador ya hizo su parte, solo falta que un admin lo
 * revise — cancelarlo automáticamente cancelaría un pedido que en los hechos
 * puede estar pagado. Sin comprobante subido sí expira igual que MercadoPago
 * (nunca llegó a intentar pagar).
 *
 * Un error en un pedido individual no debe frenar la expiración del resto —
 * se loguea y se sigue (mismo criterio que reconcilePayments.ts).
 */
export async function expireStaleOrders(): Promise<{ checked: number; expired: number; errors: number }> {
  const expiryHours = getExpiryHours();
  const cutoff = new Date(Date.now() - expiryHours * 3_600_000);

  const orders = await StoreOrder.findAll({
    where: {
      status: 'pending_payment',
      createdAt: { [Op.lte]: cutoff },
      [Op.or]: [
        { payment_method: 'mercadopago' },
        { payment_method: 'bank_transfer', payment_proof_url: null },
      ],
    },
    attributes: ['id', 'order_number', 'status', 'customer_email'],
  });

  let expired = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      await recordStoreOrderStatusChange(order, 'cancelled', {
        enforceTransition: false,
        note: `Cancelado automáticamente por falta de pago (más de ${expiryHours}hs sin acreditarse)`,
      });
      expired++;
    } catch (err) {
      errors++;
      logger.error('jobs.expireStaleOrders.orderFailed', err, {
        meta: { orderNumber: order.order_number },
      });
    }
  }

  if (orders.length > 0) {
    logger.info('jobs.expireStaleOrders.run', {
      meta: { checked: orders.length, expired, errors, expiryHours },
    });
  }

  return { checked: orders.length, expired, errors };
}
