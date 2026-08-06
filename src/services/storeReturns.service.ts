import { Transaction } from 'sequelize';
import { sequelize } from '../config/db';
import { StoreOrder, StoreOrderItem, StoreReturn, StoreReturnItem, User } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../utils/logger';
import * as stockLedger from './stockLedger.service';
import { recordStoreOrderStatusChange, resolveStoreOrderItemSize, reverseStoreOrderCashIncome } from './store.service';
import type { StoreReturnRefundStatus } from '../models/StoreReturn';

/**
 * Circuito de devoluciones con revisión (2.4 — Fase 2 / decisión de negocio
 * #4: "requiere revisión, nunca automático"). Solo el admin/billing puede
 * iniciar una devolución desde el panel (decisión confirmada con el
 * usuario) — no hay flujo de autoservicio para el comprador en esta tarea.
 *
 * Reintegros: el sistema NUNCA dispara nada contra MercadoPago (decisión de
 * negocio #5) — `refund_status` es solo un campo informativo que el admin
 * actualiza a mano reflejando lo que hizo afuera del sistema.
 */

const RETURN_INCLUDE = [
  { model: StoreReturnItem, as: 'items', include: [{ model: StoreOrderItem, as: 'orderItem' }] },
  { model: User, as: 'requester', attributes: ['id', 'name'] },
  { model: User, as: 'reviewer', attributes: ['id', 'name'] },
];

export async function getStoreReturn(id: number) {
  const ret = await StoreReturn.findByPk(id, { include: RETURN_INCLUDE });
  if (!ret) throw new AppError('Devolución no encontrada', 404);
  return ret;
}

export async function listStoreReturns(
  filters: { status?: string; storeOrderId?: number; page?: number; limit?: number } = {}
) {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.storeOrderId) where.store_order_id = filters.storeOrderId;

  const { count, rows } = await StoreReturn.findAndCountAll({
    where,
    include: [
      ...RETURN_INCLUDE,
      { model: StoreOrder, as: 'order', attributes: ['id', 'order_number', 'customer_name', 'total_amount'] },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return { data: rows, meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) } };
}

export interface CreateStoreReturnInput {
  storeOrderId: number;
  reason?: string | null;
  items: { store_order_item_id: number; quantity: number }[];
  requestedBy: number;
}

/**
 * Registra una devolución sobre un pedido `delivered` (único estado desde el
 * que se puede devolver — un pedido no entregado no puede "volver"). Pasa el
 * pedido a `returned` reusando `recordStoreOrderStatusChange` (mismo mail,
 * mismo historial), con `enforceTransition:false` porque 'returned' ya no
 * es una transición genérica de la tabla (ver storeOrderFlow.ts).
 */
export async function createStoreReturn(input: CreateStoreReturnInput) {
  const order = await StoreOrder.findByPk(input.storeOrderId);
  if (!order) throw new AppError('Pedido no encontrado', 404);
  if (order.status !== 'delivered') {
    throw new AppError('Solo se puede registrar una devolución sobre un pedido entregado', 409);
  }
  if (!input.items.length) throw new AppError('La devolución necesita al menos un ítem', 400);

  const orderItems = await StoreOrderItem.findAll({ where: { store_order_id: order.id } });
  const orderItemMap = new Map(orderItems.map((i) => [i.id, i]));

  for (const it of input.items) {
    const oi = orderItemMap.get(it.store_order_item_id);
    if (!oi) throw new AppError(`El ítem ${it.store_order_item_id} no pertenece a este pedido`, 400);
    if (!Number.isInteger(it.quantity) || it.quantity <= 0 || it.quantity > oi.quantity) {
      throw new AppError(`Cantidad inválida para "${oi.product_title}" (máximo ${oi.quantity})`, 400);
    }
  }

  let returnId!: number;

  await sequelize.transaction(async (t) => {
    const created = await StoreReturn.create(
      {
        store_order_id: order.id,
        status: 'pending_review',
        reason: input.reason ?? null,
        requested_by: input.requestedBy,
      },
      { transaction: t }
    );
    returnId = created.id;

    await StoreReturnItem.bulkCreate(
      input.items.map((it) => ({
        store_return_id: created.id,
        store_order_item_id: it.store_order_item_id,
        quantity: it.quantity,
      })),
      { transaction: t }
    );

    await recordStoreOrderStatusChange(order, 'returned', {
      enforceTransition: false,
      note: 'Devolución registrada — pendiente de revisión',
      changedBy: input.requestedBy,
      transaction: t,
    });
  });

  return getStoreReturn(returnId);
}

export interface ReviewStoreReturnInput {
  status: 'approved' | 'rejected';
  reviewNotes?: string | null;
  /** Requerido si status='approved': condición de cada ítem de la devolución. */
  items?: { id: number; condition: 'resellable' | 'not_resellable' }[];
  reviewedBy: number;
}

/**
 * Revisa una devolución pendiente. Por ítem (decisión confirmada con el
 * usuario): solo los marcados `resellable` disparan una restitución real de
 * stock (movimiento `return` del ledger, 1.2) — los `not_resellable` quedan
 * registrados pero no vuelven al stock vendible. Rechazar no mueve stock.
 *
 * Idempotente: solo actúa si la devolución sigue en `pending_review` (lock
 * de fila dentro de la transacción).
 */
export async function reviewStoreReturn(returnId: number, input: ReviewStoreReturnInput) {
  const existing = await StoreReturn.findByPk(returnId, { include: [{ model: StoreReturnItem, as: 'items' }] });
  if (!existing) throw new AppError('Devolución no encontrada', 404);
  if (existing.status !== 'pending_review') {
    throw new AppError('Esta devolución ya fue revisada', 409);
  }

  const items = (existing.get('items') as StoreReturnItem[]) ?? [];

  const conditionMap = new Map((input.items ?? []).map((i) => [i.id, i.condition]));
  if (input.status === 'approved') {
    for (const item of items) {
      if (!conditionMap.get(item.id)) {
        throw new AppError(`Falta indicar la condición del ítem ${item.id}`, 400);
      }
    }
  }

  await sequelize.transaction(async (t) => {
    const locked = await StoreReturn.findByPk(returnId, { lock: Transaction.LOCK.UPDATE, transaction: t });
    if (!locked || locked.status !== 'pending_review') return; // carrera: ya se revisó

    const lockedItems = await StoreReturnItem.findAll({
      where: { store_return_id: returnId },
      transaction: t,
    });

    for (const item of lockedItems) {
      const condition = input.status === 'approved' ? (conditionMap.get(item.id) ?? null) : null;

      if (condition === 'resellable') {
        const orderItem = await StoreOrderItem.findByPk(item.store_order_item_id, { transaction: t });
        if (!orderItem) {
          logger.error(
            'storeReturns.review.orderItemMissing',
            new Error('El ítem del pedido original ya no existe'),
            { meta: { returnId, storeReturnItemId: item.id } }
          );
          continue;
        }
        const { catalogProductSizeId } = await resolveStoreOrderItemSize(orderItem, t);
        await stockLedger.adjustStock({
          transaction: t,
          type: 'return',
          source: 'store',
          catalogProductId: orderItem.catalog_product_id,
          catalogProductSizeId,
          delta: item.quantity,
          storeOrderId: locked.store_order_id,
          userId: input.reviewedBy,
          reason: `Devolución #${returnId} aprobada y revendible`,
        });
        await item.update({ condition, restocked_at: new Date() }, { transaction: t });
      } else {
        await item.update({ condition }, { transaction: t });
      }
    }

    await locked.update(
      {
        status: input.status,
        review_notes: input.reviewNotes ?? null,
        reviewed_by: input.reviewedBy,
        reviewed_at: new Date(),
      },
      { transaction: t }
    );
  });

  return getStoreReturn(returnId);
}

export interface UpdateStoreReturnRefundInput {
  refund_status: StoreReturnRefundStatus;
  refunded_amount?: number | null;
  /** Admin que confirma el reintegro — atribución del contraasiento de caja (Fase 4). */
  changedBy: number | null;
}

/**
 * Actualiza el campo informativo de reintegro — nunca llama a la API de
 * MercadoPago (decisión de negocio #5). Desde la Fase 4 del plan de
 * corrección de caja, pasar a `refund_status: 'refunded'` SÍ tiene un efecto
 * real: si el pedido tiene un ingreso de caja/banco registrado
 * (`cash_recorded_at`), revierte ese ingreso por `refunded_amount` (no por
 * el total del pedido — la devolución puede ser parcial). Por eso
 * `refunded_amount` pasa a ser obligatorio en este caso: sin un monto no hay
 * forma de saber cuánto revertir. Idempotente por `cash_reversed_at` propio
 * de la devolución (no el de `store_orders` — puede haber varias
 * devoluciones parciales sobre el mismo pedido, cada una con su propia marca).
 */
export async function updateStoreReturnRefund(returnId: number, input: UpdateStoreReturnRefundInput) {
  const existing = await StoreReturn.findByPk(returnId);
  if (!existing) throw new AppError('Devolución no encontrada', 404);

  if (input.refund_status === 'refunded' && (input.refunded_amount === null || input.refunded_amount === undefined)) {
    throw new AppError('El monto reintegrado es obligatorio para marcar el reintegro como realizado', 400);
  }

  await sequelize.transaction(async (t) => {
    const ret = await StoreReturn.findByPk(returnId, { lock: Transaction.LOCK.UPDATE, transaction: t });
    if (!ret) throw new AppError('Devolución no encontrada', 404);

    const becomesRefunded = input.refund_status === 'refunded';

    await ret.update(
      {
        refund_status: input.refund_status,
        refunded_amount: becomesRefunded ? (input.refunded_amount ?? ret.refunded_amount) : ret.refunded_amount,
        refunded_at: becomesRefunded ? new Date() : ret.refunded_at,
      },
      { transaction: t }
    );

    if (becomesRefunded && !ret.cash_reversed_at) {
      const order = await StoreOrder.findByPk(ret.store_order_id, { transaction: t });
      if (order?.cash_recorded_at) {
        const reversed = await reverseStoreOrderCashIncome(
          order.id,
          `Devolución #${ret.id} de pedido ${order.order_number}`,
          input.changedBy,
          t,
          Number(input.refunded_amount)
        );
        if (reversed) {
          await ret.update({ cash_reversed_at: new Date() }, { transaction: t });
        }
      }
    }
  });

  return getStoreReturn(returnId);
}
