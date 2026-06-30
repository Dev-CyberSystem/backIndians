import { Op, QueryTypes, WhereOptions, Transaction, UniqueConstraintError } from 'sequelize';
import { autoCreateInvoiceForOrder } from './invoice.service';
import { sequelize } from '../config/db';
import {
  Order,
  OrderItem,
  OrderImage,
  OrderStatusHistory,
  OrderChecklistCheck,
  Client,
  User,
  GarmentType,
  FabricType,
  StockItem,
  Invoice,
} from '../models';
import { AppError } from '../middlewares/errorHandler';
import {
  ORDER_CHECKLISTS, isControlStatus, nextControlStatus, checklistKeys,
} from '../config/orderChecklists';
import {
  OrderStatus, JwtPayload, SizesMap,
  CollarType, SleeveType, Sponsor, Customization,
} from '../types';
import { cloudinary, deleteImage } from '../config/cloudinary';
import { getIO } from '../config/socket';

// ─── Tipos internos ───────────────────────────────────────────────────────────

export interface OrderItemInput {
  // Prenda y tela
  garment_type_id: number;
  stock_fabric_id?: number;    // legacy — primera tela
  stock_fabric_ids?: number[]; // múltiples telas
  fabric_type_id?: number;     // legacy

  // Diseño
  color: string;
  color_secondary?: string;
  color_sleeves?: string;
  color_collar?: string;
  color_seam_tape?: string;
  collar_type?: CollarType;
  sleeve_type?: SleeveType;

  // Accesorios
  short_description?: string;
  socks_description?: string;

  // Materiales de aplicación
  logo_material?: string;
  size_label_type?: string;
  composition_label?: string;

  // Detalle de tela
  fabric_composition?: string;
  fabric_weight?: string;

  // Sponsors y personalización
  sponsors?: Sponsor[];
  customization?: Customization;

  // Bordado
  has_embroidery?: boolean;
  embroidery_notes?: string;

  // Tallas, jugadores y precio
  sizes: SizesMap;
  players_data?: Record<string, { name: string; number: string }[]>;
  unit_price?: number;
  notes?: string;
}

export interface CreateOrderInput {
  client_id: number;
  delivery_date?: string;
  notes?: string;
  items: OrderItemInput[];
  // seller_id se inyecta desde el controller, no del body del cliente
}

export interface UpdateOrderInput {
  client_id?: number;
  delivery_date?: string;
  notes?: string;
  workshop_notes?: string;
  status?: OrderStatus;
  status_comment?: string;
  items?: OrderItemInput[];
}

interface ListOrdersOptions {
  page: number;
  limit: number;
  status?: OrderStatus;
  client_id?: number;
  seller_id?: number;
  order_number?: string;
  date_from?: string;
  date_to?: string;
  delivery_date_from?: string;
  delivery_date_to?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Genera el número de pedido diario (PED-YYYYMMDD-0001, reinicia cada día).
// El COUNT corre dentro de la transacción que después inserta el pedido; si dos
// pedidos se crean concurrentemente pueden obtener el mismo número y la unique
// constraint rechaza al segundo → createOrder reintenta y recalcula (ve el commit
// del primero). Por eso este número NO es garantía de unicidad por sí solo.
async function generateOrderNumber(transaction?: Transaction): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;
  const prefix = `PED-${dateStr}-`;

  // MAX del correlativo del día (no COUNT): inmune a huecos por pedidos borrados,
  // que harían que COUNT+1 reuse un número ya existente y choque con la unique.
  const rows = await sequelize.query<{ mx: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(order_number, :from) AS UNSIGNED)) AS mx
       FROM orders
      WHERE order_number LIKE :like`,
    {
      replacements: { from: prefix.length + 1, like: `${prefix}%` },
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  const next = Number(rows[0]?.mx ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// Relaciones completas — usadas en detalle de pedido
const orderIncludes = [
  { model: Client, as: 'client', attributes: ['id', 'name', 'contact_name', 'phone', 'email', 'address', 'cuit'] },
  { model: User, as: 'creator', attributes: ['id', 'name', 'email', 'role'] },
  { model: User, as: 'seller', attributes: ['id', 'name', 'email'] },
  {
    model: OrderItem,
    as: 'items',
    include: [
      { model: GarmentType, as: 'garmentType', attributes: ['id', 'name'] },
      { model: FabricType, as: 'fabricType', attributes: ['id', 'name'] },
      { model: StockItem, as: 'stockFabric', attributes: ['id', 'name', 'unit'] },
    ],
  },
  {
    model: OrderImage,
    as: 'images',
    include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
  },
  {
    model: OrderStatusHistory,
    as: 'status_history',
    include: [{ model: User, as: 'changer', attributes: ['id', 'name', 'role'] }],
  },
  {
    model: Invoice,
    as: 'invoices',
    attributes: ['id', 'invoice_number', 'issue_date', 'status'],
    required: false,
  },
];

// Relaciones mínimas — usadas en listado de pedidos (solo lo que muestra la tabla)
const listIncludes = [
  { model: Client, as: 'client', attributes: ['id', 'name', 'contact_name'] },
  { model: User,   as: 'seller', attributes: ['id', 'name'] },
  {
    model: Invoice,
    as: 'invoices',
    attributes: ['id', 'invoice_number', 'issue_date', 'status'],
    required: false,
  },
];

// Calcula el total sumando (sum de quantities en sizes) × unit_price por ítem
function calcTotal(items: OrderItemInput[]): number {
  return items.reduce((total, item) => {
    if (!item.unit_price) return total;
    const totalUnits = Object.values(item.sizes).reduce((s, q) => s + q, 0);
    return total + totalUnits * item.unit_price;
  }, 0);
}

function emitStatusChange(
  orderId: number,
  newStatus: OrderStatus,
  orderNumber: string,
  sellerId: number | null = null
): void {
  try {
    const io = getIO();
    const payload = { orderId, orderNumber, newStatus, sellerId };
    // Broadcast a todos los clientes conectados (el front filtra por rol)
    io.emit('order:status_changed', payload);
    io.emit('notification:status_changed', payload);
  } catch { /* Socket puede no estar inicializado en tests */ }
}

function emitOrderCreated(
  orderId: number,
  orderNumber: string,
  clientName: string,
  sellerId: number | null
): void {
  try {
    getIO().emit('notification:order_created', { orderId, orderNumber, clientName, sellerId });
  } catch { /* no crítico */ }
}

// Registra el cambio de estado en el historial
async function recordStatusChange(
  orderId: number,
  previousStatus: OrderStatus | null,
  newStatus: OrderStatus,
  changedBy: number,
  comment?: string,
  transaction?: Transaction
): Promise<void> {
  await OrderStatusHistory.create({
    order_id: orderId,
    previous_status: previousStatus ?? undefined,
    new_status: newStatus,
    changed_by: changedBy,
    comment: comment || null,
  }, { transaction });
}

// Construye el array de ítems para bulkCreate
function buildItemsPayload(orderId: number, items: OrderItemInput[]) {
  return items.map((item) => ({
    order_id: orderId,
    garment_type_id: item.garment_type_id,
    fabric_type_id: item.fabric_type_id ?? null,
    stock_fabric_ids: item.stock_fabric_ids?.length ? item.stock_fabric_ids : null,
    stock_fabric_id: item.stock_fabric_ids?.[0] ?? item.stock_fabric_id ?? null,
    // Diseño y colores
    color: item.color,
    color_secondary: item.color_secondary || null,
    color_sleeves: item.color_sleeves || null,
    color_collar: item.color_collar || null,
    color_seam_tape: item.color_seam_tape || null,
    collar_type: item.collar_type || null,
    sleeve_type: item.sleeve_type || null,
    // Accesorios
    short_description: item.short_description || null,
    socks_description: item.socks_description || null,
    // Materiales de aplicación
    logo_material: item.logo_material || null,
    size_label_type: item.size_label_type || null,
    composition_label: item.composition_label || null,
    // Detalle de tela
    fabric_composition: item.fabric_composition || null,
    fabric_weight: item.fabric_weight || null,
    // Sponsors y personalización
    sponsors: item.sponsors || null,
    customization: item.customization || null,
    // Bordado
    has_embroidery: item.has_embroidery ?? false,
    embroidery_notes: item.embroidery_notes || null,
    // Tallas, jugadores y precio
    sizes: item.sizes,
    players_data: item.players_data ?? null,
    unit_price: item.unit_price ?? null,
    notes: item.notes || null,
  }));
}

// ─── Validación de transiciones de estado por rol ────────────────────────────

export const ORDER_STATUS_TRANSITIONS: Record<string, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  seller: {
    observed: ['under_review'],
  },
  billing: {
    pending:      ['under_review'],
    under_review: ['observed', 'workshop_review'],
  },
  // Taller: inicia y recorre los controles de producción. En cada control puede
  // avanzar al siguiente (con el checklist completo) o "observar" volviendo al anterior.
  workshop: {
    workshop_review:      ['raw_material_control', 'observed'],
    raw_material_control: ['cutting_control', 'workshop_review'],
    cutting_control:      ['printing_control', 'raw_material_control'],
    printing_control:     ['sewing_control', 'cutting_control'],
    sewing_control:       ['quality_control', 'printing_control'],
    quality_control:      ['packaging_control', 'sewing_control'],
    packaging_control:    ['ready', 'quality_control'],
  },
  admin: {
    pending:              ['under_review', 'cancelled'],
    under_review:         ['observed', 'workshop_review', 'cancelled'],
    observed:             ['under_review', 'cancelled'],
    workshop_review:      ['raw_material_control', 'observed', 'cancelled'],
    raw_material_control: ['cutting_control', 'workshop_review', 'cancelled'],
    cutting_control:      ['printing_control', 'raw_material_control', 'cancelled'],
    printing_control:     ['sewing_control', 'cutting_control', 'cancelled'],
    sewing_control:       ['quality_control', 'printing_control', 'cancelled'],
    quality_control:      ['packaging_control', 'sewing_control', 'cancelled'],
    packaging_control:    ['ready', 'quality_control', 'cancelled'],
    ready:                ['cancelled'],
    cancelled:            [],
  },
};

function validateStatusTransition(
  role: JwtPayload['role'],
  currentStatus: OrderStatus,
  newStatus: OrderStatus
): void {
  const allowed = ORDER_STATUS_TRANSITIONS[role]?.[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new AppError(
      `El rol "${role}" no puede mover un pedido de "${currentStatus}" a "${newStatus}"`,
      403
    );
  }
}

// ─── Servicios ───────────────────────────────────────────────────────────────

export async function listOrders(
  currentUser: JwtPayload,
  options: ListOrdersOptions
) {
  const {
    page, limit, status, client_id, seller_id,
    order_number, date_from, date_to,
    delivery_date_from, delivery_date_to,
  } = options;
  const offset = (page - 1) * limit;

  const where: WhereOptions = {};

  if (status) {
    (where as Record<string, unknown>).status = status;
  }
  if (client_id) (where as Record<string, unknown>).client_id = client_id;
  if (order_number) {
    (where as Record<string, unknown>).order_number = { [Op.like]: `%${order_number}%` };
  }
  if (date_from || date_to) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const range: any = {};
    if (date_from) range[Op.gte] = new Date(date_from);
    if (date_to) range[Op.lte] = new Date(`${date_to}T23:59:59`);
    (where as Record<string, unknown>).createdAt = range;
  }
  if (delivery_date_from || delivery_date_to) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const range: any = {};
    if (delivery_date_from) range[Op.gte] = new Date(delivery_date_from);
    if (delivery_date_to) range[Op.lte] = new Date(delivery_date_to);
    (where as Record<string, unknown>).delivery_date = range;
  }

  // Workshop solo ve pedidos en sus estados relevantes (respeta filtro de status si viene)
  if (currentUser.role === 'workshop' && !status) {
    (where as Record<string, unknown>).status = {
      [Op.in]: ['workshop_review', 'in_production', 'quality_check', 'ready'],
    };
  }

  // Seller solo ve sus propios pedidos
  if (currentUser.role === 'seller') {
    (where as Record<string, unknown>).seller_id = currentUser.id;
  } else if (seller_id) {
    (where as Record<string, unknown>).seller_id = seller_id;
  }

  const { rows, count } = await Order.findAndCountAll({
    where,
    include: listIncludes,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    distinct: true,
  });

  return { orders: rows, total: count, page, limit };
}

export async function getOrderById(
  id: number,
  currentUser?: JwtPayload
): Promise<Order> {
  const order = await Order.findByPk(id, { include: orderIncludes });
  if (!order) throw new AppError('Pedido no encontrado', 404);

  // Seller solo puede ver sus propios pedidos
  if (currentUser?.role === 'seller' && order.seller_id !== currentUser.id) {
    throw new AppError('No tenés permiso para ver este pedido', 403);
  }

  // Resolver nombres de todas las telas (stock_fabric_ids → stockFabrics[])
  const items: OrderItem[] = (order as any).items ?? [];
  const allFabricIds = [...new Set(
    items.flatMap((item) => (item.stock_fabric_ids as number[] | null) ?? [])
  )].filter(Boolean);

  if (allFabricIds.length > 0) {
    const fabrics = await StockItem.findAll({
      where: { id: allFabricIds },
      attributes: ['id', 'name'],
    });
    const fabricMap = Object.fromEntries(fabrics.map((f) => [f.id, { id: f.id, name: f.name }]));
    for (const item of items) {
      const ids: number[] = (item.stock_fabric_ids as number[] | null) ?? [];
      (item as any).stockFabrics = ids.map((fid) => fabricMap[fid]).filter(Boolean);
    }
  }

  return order;
}

export async function createOrder(
  input: CreateOrderInput,
  currentUser: JwtPayload,
  sellerIdOverride?: number
): Promise<Order> {
  const { client_id, delivery_date, notes, items } = input;

  const client = await Client.findByPk(client_id);
  if (!client) throw new AppError('Cliente no encontrado', 404);

  const total_amount = calcTotal(items);
  const seller_id =
    currentUser.role === 'seller' ? currentUser.id : (sellerIdOverride ?? null);

  // Transacción atómica con reintento ante colisión del número correlativo:
  // el número de pedido (y el de factura) se generan por COUNT del día, que no
  // es atómico. Si dos pedidos concurrentes obtienen el mismo número, la unique
  // constraint rechaza al segundo; reintentamos con una transacción nueva, cuyo
  // COUNT ya ve el commit del primero y arroja el siguiente número.
  const MAX_RETRIES = 5;
  let order: Order | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      order = await sequelize.transaction(async (t) => {
        const order_number = await generateOrderNumber(t);
        const o = await Order.create({
          order_number,
          client_id,
          created_by: currentUser.id,
          seller_id,
          status: 'pending',
          delivery_date: delivery_date ? new Date(delivery_date) : null,
          notes: notes || null,
          total_amount,
        }, { transaction: t });

        await OrderItem.bulkCreate(buildItemsPayload(o.id, items), { transaction: t });
        await recordStatusChange(o.id, null, 'pending', currentUser.id, 'Pedido creado', t);
        await autoCreateInvoiceForOrder(o, t);

        return o;
      });
      break; // éxito
    } catch (err) {
      if (err instanceof UniqueConstraintError && attempt < MAX_RETRIES) {
        // Backoff con jitter para dispersar reintentos concurrentes.
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 30)));
        continue;
      }
      throw err;
    }
  }
  if (!order) throw new AppError('No se pudo generar el número de pedido, reintentá', 503);

  const fullOrder = await getOrderById(order.id);

  // Emitir notificaciones después de que la transacción commitea
  emitOrderCreated(
    order.id,
    order.order_number ?? '',
    (fullOrder as any).client?.name ?? '',
    order.seller_id ?? null
  );

  const invoice = (fullOrder as any).invoices?.[0];
  if (invoice) {
    try {
      getIO().emit('notification:invoice_created', {
        invoiceId:     invoice.id,
        invoiceNumber: invoice.invoice_number,
        orderId:       order.id,
        orderNumber:   order.order_number ?? '',
        clientName:    (fullOrder as any).client?.name ?? '',
      });
    } catch { /* no crítico */ }
  }

  return fullOrder;
}

export async function updateOrder(
  id: number,
  input: UpdateOrderInput,
  currentUser: JwtPayload
): Promise<Order> {
  const order = await Order.findByPk(id);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  // Seller: solo puede editar sus propios pedidos en estado 'pending' u 'observed'
  if (currentUser.role === 'seller') {
    if (order.seller_id !== currentUser.id) {
      throw new AppError('No tenés permiso para editar este pedido', 403);
    }
    if (order.status !== 'pending' && order.status !== 'observed') {
      throw new AppError('Solo podés editar pedidos en estado pendiente u observado', 403);
    }
  }

  const { status, workshop_notes, ...dataFields } = input;

  // Validar y aplicar cambio de estado (solo workshop, billing, admin)
  if (status && status !== order.status) {
    const previousStatus = order.status as OrderStatus;
    validateStatusTransition(currentUser.role, previousStatus, status);

    // Si es un AVANCE entre controles, exigir el checklist del control actual completo.
    if (isControlStatus(previousStatus) && status === nextControlStatus(previousStatus)) {
      const keys = checklistKeys(previousStatus);
      const done = await OrderChecklistCheck.count({
        where: { order_id: order.id, status: previousStatus },
      });
      if (done < keys.length) {
        throw new AppError(
          `Completá el checklist del control antes de avanzar (${done}/${keys.length} ítems).`,
          400,
          undefined,
          { code: 'CHECKLIST_INCOMPLETE', type: 'BusinessRuleError' }
        );
      }
    }

    await order.update({ status });

    // Al entrar a un control, reiniciar sus tildes (arranca limpio: avance = vacío,
    // retroceso por observación = se rehace el control).
    if (isControlStatus(status)) {
      await OrderChecklistCheck.destroy({ where: { order_id: order.id, status } });
    }

    await recordStatusChange(order.id, previousStatus, status, currentUser.id, input.status_comment);
    emitStatusChange(order.id, status, order.order_number, order.seller_id ?? null);
  }

  // Actualizar datos del pedido (admin, billing, seller en pending)
  if (currentUser.role !== 'workshop') {
    const updateData: Partial<Order> = {};

    if (dataFields.client_id !== undefined) updateData.client_id = dataFields.client_id;
    if (dataFields.delivery_date !== undefined)
      updateData.delivery_date = new Date(dataFields.delivery_date);
    if (dataFields.notes !== undefined) updateData.notes = dataFields.notes;

    if (Object.keys(updateData).length > 0) await order.update(updateData);

    // Reemplazar ítems en transacción (evita ventana de datos sin items)
    if (input.items?.length) {
      await sequelize.transaction(async (t) => {
        await OrderItem.destroy({ where: { order_id: id }, transaction: t });
        await OrderItem.bulkCreate(buildItemsPayload(id, input.items!), { transaction: t });
        await order.update({ total_amount: calcTotal(input.items!) }, { transaction: t });
      });
    }
  }

  // Notas de taller (workshop, billing y admin — no seller)
  if (workshop_notes !== undefined && currentUser.role !== 'seller') {
    await order.update({ workshop_notes });
  }

  return getOrderById(id, currentUser);
}

export async function deleteOrder(id: number): Promise<void> {
  const order = await Order.findByPk(id, { include: [{ model: OrderImage, as: 'images' }] });
  if (!order) throw new AppError('Pedido no encontrado', 404);

  if (order.images?.length) {
    await Promise.all(order.images.map((img) => deleteImage(img.cloudinary_public_id)));
  }

  await order.destroy();
}

const MAX_IMAGES_PER_ORDER = 5;

export async function uploadOrderImage(
  orderId: number,
  file: Express.Multer.File,
  description: string | undefined,
  currentUser: JwtPayload
): Promise<OrderImage> {
  const order = await Order.findByPk(orderId);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const imageCount = await OrderImage.count({ where: { order_id: orderId } });
  if (imageCount >= MAX_IMAGES_PER_ORDER) {
    throw new AppError(`El pedido ya tiene el máximo de ${MAX_IMAGES_PER_ORDER} imágenes`, 422);
  }

  const result = await new Promise<{ secure_url: string; public_id: string }>(
    (resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: `textil/orders/${orderId}` },
        (error, result) => {
          if (error || !result) return reject(error || new Error('Upload fallido'));
          resolve({ secure_url: result.secure_url, public_id: result.public_id });
        }
      );
      uploadStream.end(file.buffer);
    }
  );

  return OrderImage.create({
    order_id: orderId,
    url: result.secure_url,
    cloudinary_public_id: result.public_id,
    description: description || null,
    uploaded_by: currentUser.id,
  });
}

export async function deleteOrderImage(
  orderId: number,
  imageId: number
): Promise<void> {
  const image = await OrderImage.findOne({
    where: { id: imageId, order_id: orderId },
  });
  if (!image) throw new AppError('Imagen no encontrada', 404);

  await deleteImage(image.cloudinary_public_id);
  await image.destroy();
}

export async function uploadItemSizeChart(
  orderId: number,
  itemId: number,
  file: Express.Multer.File
): Promise<OrderItem> {
  const item = await OrderItem.findOne({ where: { id: itemId, order_id: orderId } });
  if (!item) throw new AppError('Ítem no encontrado', 404);

  // Eliminar imagen anterior si existe
  if (item.size_chart_cloudinary_id) {
    await deleteImage(item.size_chart_cloudinary_id).catch(() => null);
  }

  const result = await new Promise<{ secure_url: string; public_id: string }>(
    (resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: `textil/orders/${orderId}/size-charts` },
        (error, res) => {
          if (error || !res) return reject(error || new Error('Upload fallido'));
          resolve({ secure_url: res.secure_url, public_id: res.public_id });
        }
      );
      uploadStream.end(file.buffer);
    }
  );

  await item.update({
    size_chart_image_url: result.secure_url,
    size_chart_cloudinary_id: result.public_id,
  });

  return item;
}

export async function deleteItemSizeChart(
  orderId: number,
  itemId: number
): Promise<void> {
  const item = await OrderItem.findOne({ where: { id: itemId, order_id: orderId } });
  if (!item) throw new AppError('Ítem no encontrado', 404);

  if (item.size_chart_cloudinary_id) {
    await deleteImage(item.size_chart_cloudinary_id).catch(() => null);
  }

  await item.update({ size_chart_image_url: null, size_chart_cloudinary_id: null });
}

export async function getOrderHistory(
  orderId: number
): Promise<OrderStatusHistory[]> {
  const order = await Order.findByPk(orderId);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  return OrderStatusHistory.findAll({
    where: { order_id: orderId },
    include: [{ model: User, as: 'changer', attributes: ['id', 'name', 'role'] }],
    order: [['createdAt', 'DESC']],
  });
}

// ─── Checklist de controles de producción ─────────────────────────────────────

interface ChecklistView {
  status: string;
  is_control: boolean;
  items: Array<{
    key: string;
    label: string;
    checked: boolean;
    checked_by: string | null;
    checked_at: Date | null;
  }>;
  total: number;
  done: number;
}

/** Devuelve el checklist del control en el que está el pedido, con su estado de tilde. */
export async function getOrderChecklist(orderId: number): Promise<ChecklistView> {
  const order = await Order.findByPk(orderId);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const status = order.status as string;
  const items = ORDER_CHECKLISTS[status] ?? [];

  const checks = await OrderChecklistCheck.findAll({
    where: { order_id: orderId, status },
    include: [{ model: User, as: 'checker', attributes: ['id', 'name'] }],
  });
  const byKey = new Map(checks.map((c) => [c.item_key, c]));

  return {
    status,
    is_control: isControlStatus(status),
    items: items.map((it) => {
      const c = byKey.get(it.key);
      return {
        key: it.key,
        label: it.label,
        checked: !!c,
        checked_by: c ? ((c as { checker?: { name?: string } }).checker?.name ?? null) : null,
        checked_at: c ? c.createdAt : null,
      };
    }),
    total: items.length,
    done: items.filter((it) => byKey.has(it.key)).length,
  };
}

/** Tilda o destilda un ítem del checklist del control actual del pedido. */
export async function toggleChecklistItem(
  orderId: number,
  itemKey: string,
  checked: boolean,
  user: JwtPayload
): Promise<ChecklistView> {
  const order = await Order.findByPk(orderId);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const status = order.status as string;
  if (!isControlStatus(status)) {
    throw new AppError('El pedido no está en un control con checklist', 400);
  }
  if (!checklistKeys(status).includes(itemKey)) {
    throw new AppError('Ítem de checklist inválido para este control', 400);
  }

  if (checked) {
    await OrderChecklistCheck.findOrCreate({
      where: { order_id: orderId, status, item_key: itemKey },
      defaults: { order_id: orderId, status, item_key: itemKey, checked_by: user.id },
    });
  } else {
    await OrderChecklistCheck.destroy({ where: { order_id: orderId, status, item_key: itemKey } });
  }

  return getOrderChecklist(orderId);
}
