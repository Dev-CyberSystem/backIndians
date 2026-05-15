import { QueryTypes, Op } from 'sequelize';
import { sequelize } from '../config/db';
import { Invoice, Order, Client, OrderItem, GarmentType, FabricType, User, Settings } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { InvoiceStatus, JwtPayload } from '../types';
import { InvoiceExtraItem } from '../models/Invoice';

export interface UpdateInvoiceInput {
  due_date?: string;
  status?: InvoiceStatus;
  notes?: string;
  discount_amount?: number;
  extra_items?: InvoiceExtraItem[];
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
];

async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;
  const isoDate = `${y}-${m}-${d}`;

  const rows = await sequelize.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM invoices WHERE DATE(createdAt) = :isoDate`,
    { replacements: { isoDate }, type: QueryTypes.SELECT }
  );
  const count = Number(rows[0]?.cnt ?? 0);
  return `FAC-${dateStr}-${String(count + 1).padStart(4, '0')}`;
}

function calcTotal(orderTotal: number, extraItems: InvoiceExtraItem[], discount: number): number {
  const extras = extraItems.reduce((s, e) => s + (e.amount || 0), 0);
  return Math.max(0, orderTotal + extras - discount);
}

export async function autoCreateInvoiceForOrder(order: Order): Promise<Invoice> {
  const existing = await Invoice.findOne({ where: { order_id: order.id } });
  if (existing) return existing;

  const invoice_number = await generateInvoiceNumber();
  const today = new Date();
  const due = new Date(today);

  const dueDaysSetting = await Settings.findOne({ where: { key: 'invoice_due_days' } });
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
  });
}

export interface ListInvoicesOptions {
  page: number;
  limit: number;
  invoice_number?: string;
  status?: InvoiceStatus;
  client_id?: number;
  date_from?: string;
  date_to?: string;
}

export async function listInvoices(
  currentUser: JwtPayload,
  options: ListInvoicesOptions
) {
  const { page, limit, invoice_number, status, client_id, date_from, date_to } = options;
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
          { model: Client, as: 'client', attributes: ['id', 'name', 'contact_name'] },
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

  if (input.status     !== undefined) updateData.status    = input.status;
  if (input.due_date   !== undefined) updateData.due_date  = new Date(input.due_date);
  if (input.notes      !== undefined) updateData.notes     = input.notes;

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

  await invoice.update(updateData);
  return getInvoiceById(id);
}

export async function getInvoiceByOrderId(orderId: number): Promise<Invoice | null> {
  return Invoice.findOne({ where: { order_id: orderId }, include: invoiceIncludes });
}
