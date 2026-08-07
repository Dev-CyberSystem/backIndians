import { QueryTypes, Op, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../config/db';
import { Invoice, Order, Client, OrderItem, GarmentType, FabricType, User, Settings, InvoicePayment } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { InvoiceStatus, JwtPayload } from '../types';
import { InvoiceExtraItem } from '../models/Invoice';
import type { InvoicePaymentMethod } from '../models/InvoicePayment';
import { recordInvoiceCollectionCashIncome, reverseAllForReference } from './cash.service';

export interface UpdateInvoiceInput {
  due_date?: string;
  status?: InvoiceStatus;
  notes?: string;
  discount_amount?: number;
  extra_items?: InvoiceExtraItem[];
  payment_amount?: number | null;
}

const invoiceIncludes = [
  {
    model: Order,
    as: 'order',
    include: [
      { model: Client, as: 'client' },
      { model: User, as: 'seller', attributes: ['id', 'name'] },
      {
        model: OrderItem,
        as: 'items',
        include: [
          { model: GarmentType, as: 'garmentType', attributes: ['id', 'name'] },
          { model: FabricType,  as: 'fabricType',  attributes: ['id', 'name'] },
        ],
      },
    ],
  },
  {
    model: InvoicePayment,
    as: 'payments',
    order: [['paid_at', 'ASC']] as [string, string][],
  },
];

async function generateInvoiceNumber(transaction?: Transaction): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;
  const prefix = `FAC-${dateStr}-`;

  // MAX del correlativo del día (no COUNT): inmune a huecos por facturas borradas
  // que harían reusar un número ya existente. Ver generateOrderNumber.
  const rows = await sequelize.query<{ mx: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(invoice_number, :from) AS UNSIGNED)) AS mx
       FROM invoices
      WHERE invoice_number LIKE :like`,
    {
      replacements: { from: prefix.length + 1, like: `${prefix}%` },
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  const next = Number(rows[0]?.mx ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function calcTotal(orderTotal: number, extraItems: InvoiceExtraItem[], discount: number): number {
  const extras = extraItems.reduce((s, e) => s + (e.amount || 0), 0);
  return Math.max(0, orderTotal + extras - discount);
}

export async function autoCreateInvoiceForOrder(order: Order, transaction?: Transaction): Promise<Invoice> {
  const existing = await Invoice.findOne({ where: { order_id: order.id }, transaction });
  if (existing) return existing;

  const invoice_number = await generateInvoiceNumber(transaction);
  const today = new Date();
  const due = new Date(today);

  const dueDaysSetting = await Settings.findOne({ where: { key: 'invoice_due_days' }, transaction });
  const dueDays = parseInt(dueDaysSetting?.value ?? '30') || 30;
  due.setDate(due.getDate() + dueDays);

  return Invoice.create({
    order_id: order.id,
    invoice_number,
    issue_date: today,
    due_date: due,
    status: 'draft',
    discount_amount: 0,
    extra_items: null,
    total_amount: Number(order.total_amount),
  }, { transaction });
}

export interface ListInvoicesOptions {
  page: number;
  limit: number;
  invoice_number?: string;
  status?: InvoiceStatus;
  client_id?: number;
  seller_id?: number;
  date_from?: string;
  date_to?: string;
}

export async function listInvoices(
  currentUser: JwtPayload,
  options: ListInvoicesOptions
) {
  const { page, limit, invoice_number, status, client_id, seller_id, date_from, date_to } = options;
  const offset = (page - 1) * limit;

  const invoiceWhere: Record<string, unknown> = {};
  if (status) invoiceWhere.status = status;
  if (invoice_number) invoiceWhere.invoice_number = { [Op.like]: `%${invoice_number}%` };
  if (date_from || date_to) {
    const range: Record<symbol, Date> = {};
    if (date_from) range[Op.gte] = new Date(date_from);
    if (date_to)   range[Op.lte] = new Date(`${date_to}T23:59:59`);
    invoiceWhere.issue_date = range;
  }

  const orderWhere: Record<string, unknown> = {};
  if (currentUser.role === 'seller') orderWhere.seller_id = currentUser.id;
  else if (seller_id) orderWhere.seller_id = seller_id;
  if (client_id) orderWhere.client_id = client_id;

  const { rows, count } = await Invoice.findAndCountAll({
    where: invoiceWhere,
    include: [
      {
        model: Order,
        as: 'order',
        required: true,
        where: Object.keys(orderWhere).length ? orderWhere : undefined,
        include: [
          { model: Client, as: 'client', attributes: ['id', 'name', 'contact_name', 'cuit', 'condicion_iva'] },
          { model: User, as: 'seller', attributes: ['id', 'name'] },
        ],
      },
    ],
    order: [['issue_date', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  return { invoices: rows, total: count, page, limit };
}

export async function getInvoiceById(id: number, currentUser?: JwtPayload): Promise<Invoice> {
  const invoice = await Invoice.findByPk(id, { include: invoiceIncludes });
  if (!invoice) throw new AppError('Factura no encontrada', 404);

  if (currentUser?.role === 'seller') {
    const order = (invoice as any).order;
    if (order?.seller_id !== currentUser.id) {
      throw new AppError('No tenés permiso para ver esta factura', 403);
    }
  }

  return invoice;
}

export async function updateInvoice(
  id: number,
  input: UpdateInvoiceInput,
  currentUser: JwtPayload
): Promise<Invoice> {
  const invoice = await Invoice.findByPk(id, {
    include: [{ model: Order, as: 'order', attributes: ['total_amount'] }],
  });
  if (!invoice) throw new AppError('Factura no encontrada', 404);
  if (invoice.status === 'cancelled') throw new AppError('No se puede modificar una factura anulada', 400);
  if (currentUser.role === 'seller') throw new AppError('No tenés permiso para modificar facturas', 403);

  const updateData: Partial<Invoice> = {};

  if (input.status          !== undefined) updateData.status         = input.status;
  if (input.due_date        !== undefined) updateData.due_date       = new Date(input.due_date);
  if (input.notes           !== undefined) updateData.notes          = input.notes;
  if ('payment_amount' in input)           updateData.payment_amount = input.payment_amount ?? null;

  const newDiscount = input.discount_amount !== undefined
    ? input.discount_amount
    : Number(invoice.discount_amount ?? 0);
  const newExtras = input.extra_items !== undefined
    ? input.extra_items
    : (invoice.extra_items ?? []);

  if (input.discount_amount !== undefined) updateData.discount_amount = newDiscount;
  if (input.extra_items     !== undefined) updateData.extra_items     = newExtras;

  const orderTotal = Number((invoice as any).order?.total_amount ?? 0);
  updateData.total_amount = calcTotal(orderTotal, newExtras, newDiscount);

  // Al anular una factura con cobros ya asentados, revertir todos sus
  // ingresos de caja en la MISMA transacción del cambio de estado (DEC-012,
  // cierra CASH-INV-001 del lado de la anulación). Best-effort por diseño de
  // `reverseAllForReference`: nunca bloquea la anulación por un problema de
  // caja. El guard de arriba (`invoice.status === 'cancelled'` → 400) ya
  // impide que esto se dispare dos veces sobre la misma factura.
  //
  // Nota: esta reversión solo cubre la transición HACIA 'cancelled'. Un
  // cambio manual de 'paid' a 'issued'/'draft' sin pasar por 'cancelled' no
  // revierte caja — es un caso de edición administrativa fuera del alcance
  // de esta fase, no una regla de negocio nueva que se esté decidiendo acá.
  // (El guard de arriba ya aseguró que `invoice.status` no puede ser
  // 'cancelled' a esta altura, así que solo hace falta mirar el destino.)
  const cancelling = input.status === 'cancelled';

  if (cancelling) {
    await sequelize.transaction(async (t) => {
      await invoice.update(updateData, { transaction: t });
      await reverseAllForReference(
        'invoice', invoice.id,
        `Anulación de factura ${invoice.invoice_number}`,
        currentUser.id, t
      );
    });
  } else {
    await invoice.update(updateData);
  }

  return getInvoiceById(id);
}

export async function getInvoiceByOrderId(orderId: number): Promise<Invoice | null> {
  return Invoice.findOne({ where: { order_id: orderId }, include: invoiceIncludes });
}

export interface AddInvoicePaymentInput {
  amount: number;
  payment_method: InvoicePaymentMethod;
  notes?: string;
  /** Reintento de red seguro: dos altas con la misma clave devuelven el mismo cobro. */
  idempotency_key?: string;
}

/**
 * Registra un cobro de una factura de fábrica y su asiento de caja
 * correspondiente (DEC-012 — cierra CASH-INV-001/CASH-INV-002).
 *
 * Antes: `InvoicePayment.create` + `findAll` + `update` de la factura, las
 * tres fuera de transacción y sin ninguna clave de idempotencia — dos
 * cobranzas concurrentes podían dejar `payment_amount` subvaluado y la
 * factura sin pasar a `paid` (CASH-INV-002), y el cobro nunca tocaba caja
 * (CASH-INV-001). Ahora: `LOCK.UPDATE` sobre la factura dentro de la misma
 * transacción que crea el pago, recalcula el total y arma el asiento —
 * mismo patrón que `createTransactionCore`/`recordStoreOrderIncome`.
 */
export async function addPaymentToInvoice(
  id: number,
  input: AddInvoicePaymentInput,
  currentUser: JwtPayload
): Promise<Invoice> {
  // Camino rápido: un reintento secuencial genuino ya encuentra el pago sin
  // abrir transacción de más (mismo patrón que `createTransaction` en cash.service.ts).
  if (input.idempotency_key) {
    const existing = await InvoicePayment.findOne({ where: { idempotency_key: input.idempotency_key } });
    if (existing) return getInvoiceById(existing.invoice_id, currentUser);
  }

  let invoiceId = id;
  try {
    await sequelize.transaction(async (t) => {
      const invoice = await Invoice.findByPk(id, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!invoice) throw new AppError('Factura no encontrada', 404);
      if (invoice.status === 'cancelled') throw new AppError('No se puede pagar una factura anulada', 400);
      if (invoice.status === 'paid') throw new AppError('La factura ya está completamente pagada', 400);

      const payment = await InvoicePayment.create(
        {
          invoice_id: id,
          amount: input.amount,
          payment_method: input.payment_method,
          notes: input.notes ?? null,
          idempotency_key: input.idempotency_key ?? null,
        },
        { transaction: t }
      );

      const rows = await InvoicePayment.findAll({ where: { invoice_id: id }, transaction: t });
      const totalPaid = rows.reduce((s, p) => s + p.amount, 0);
      const invoiceTotal = Number(invoice.total_amount ?? 0);

      await invoice.update(
        {
          payment_amount: totalPaid,
          status: invoiceTotal > 0 && totalPaid >= invoiceTotal ? 'paid' : invoice.status,
        },
        { transaction: t }
      );

      const recordedAt = await recordInvoiceCollectionCashIncome(
        {
          referenceType: 'invoice',
          referenceId: invoice.id,
          amount: input.amount,
          paymentMethod: input.payment_method,
          description: `Cobro factura ${invoice.invoice_number}`,
          createdBy: currentUser.id,
        },
        t
      );
      if (recordedAt) await payment.update({ cash_recorded_at: recordedAt }, { transaction: t });

      invoiceId = invoice.id;
    });
  } catch (err) {
    // Carrera genuina: dos requests con la misma clave llegaron a la vez y el
    // índice único de la DB (migración 093) frenó al segundo — mismo patrón
    // que `createTransaction` en cash.service.ts.
    if (err instanceof UniqueConstraintError && input.idempotency_key) {
      const existing = await InvoicePayment.findOne({ where: { idempotency_key: input.idempotency_key } });
      if (existing) return getInvoiceById(existing.invoice_id, currentUser);
    }
    throw err;
  }

  return getInvoiceById(invoiceId, currentUser) as Promise<Invoice>;
}
