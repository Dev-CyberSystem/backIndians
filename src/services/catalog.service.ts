import { v2 as cloudinary } from 'cloudinary';
import { type Includeable, Op } from 'sequelize';
import { AppError } from '../middlewares/errorHandler';
import {
  CatalogProduct,
  CatalogProductImage,
  CatalogProductSize,
  CatalogOrder,
  CatalogOrderItem,
  CatalogInvoice,
  CatalogInvoiceImage,
  CatalogInvoicePayment,
  Client,
  User,
} from '../models';
import { sequelize } from '../config/db';
import * as mpService from './mercadopago.service';

// ─── Include estándar de un producto ─────────────────────────────────────────

const PRODUCT_INCLUDE: Includeable[] = [
  { model: CatalogProductImage, as: 'images', order: [['sort_order', 'ASC']] as [string, string][] },
  { model: CatalogProductSize,  as: 'sizes',  order: [['sort_order', 'ASC']] as [string, string][] },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateInvoiceNumber(): Promise<string> {
  const last = await CatalogInvoice.findOne({ order: [['id', 'DESC']] });
  const lastNum = last
    ? parseInt(last.invoice_number.replace('CATFACT-', '')) || 0
    : 0;
  return `CATFACT-${String(lastNum + 1).padStart(5, '0')}`;
}

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const lastOrder = await CatalogOrder.findOne({
    where: sequelize.literal(`order_number LIKE 'CAT-${year}-%'`),
    order: [['id', 'DESC']],
  });
  let seq = 1;
  if (lastOrder) {
    const parts = lastOrder.order_number.split('-');
    seq = parseInt(parts[2]) + 1;
  }
  return `CAT-${year}-${String(seq).padStart(5, '0')}`;
}

// ─── Productos del catálogo ───────────────────────────────────────────────────

export interface SizeInput {
  size_name: string;
  stock_quantity: number;
  sort_order?: number;
}

export interface ProductInput {
  client_id:     number;
  title:         string;
  description?:  string;
  price:         number;
  public_price?: number | null;
  discount_percentage?: number;
  show_in_store?: boolean;
  category?:     string | null;
  gender?:       'masculino' | 'femenino' | 'infantil' | 'unisex' | null;
  tags?:         string[] | null;
  stock_quantity?: number;
  active?:       boolean;
  sizes?:        SizeInput[];
}

export async function listClientProducts(clientId: number) {
  return CatalogProduct.findAll({
    where: { client_id: clientId },
    include: PRODUCT_INCLUDE,
    order: [['createdAt', 'DESC']],
  });
}

export async function listAllProducts(page: number, limit: number, clientId?: number) {
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = { active: true };
  if (clientId) where['client_id'] = clientId;

  const { rows, count } = await CatalogProduct.findAndCountAll({
    where,
    include: [
      ...PRODUCT_INCLUDE,
      { model: Client, as: 'client', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  return { products: rows, total: count, page, limit };
}

export async function getProduct(id: number) {
  const product = await CatalogProduct.findByPk(id, {
    include: [
      ...PRODUCT_INCLUDE,
      { model: Client, as: 'client', attributes: ['id', 'name'] },
    ],
  });
  if (!product) throw new AppError('Producto no encontrado', 404);
  return product;
}

export async function createProduct(input: ProductInput): Promise<CatalogProduct> {
  const client = await Client.findByPk(input.client_id);
  if (!client) throw new AppError('Cliente no encontrado', 404);

  const t = await sequelize.transaction();
  try {
    const product = await CatalogProduct.create({
      client_id:       input.client_id,
      title:           input.title,
      description:     input.description || null,
      price:           input.price,
      public_price:    input.public_price ?? null,
      discount_percentage: Math.min(100, Math.max(0, Math.round(input.discount_percentage ?? 0))),
      show_in_store:   input.show_in_store ?? false,
      category:        input.category ?? null,
      gender:          input.gender ?? null,
      tags:            input.tags?.length ? input.tags : null,
      stock_quantity:  input.stock_quantity ?? 0,
      active:          input.active ?? true,
    }, { transaction: t });

    if (input.sizes?.length) {
      await CatalogProductSize.bulkCreate(
        input.sizes.map((s, i) => ({
          product_id: product.id,
          size_name: s.size_name,
          stock_quantity: s.stock_quantity,
          sort_order: s.sort_order ?? i,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    return getProduct(product.id);
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

export async function updateProduct(
  id: number,
  input: Partial<Omit<ProductInput, 'client_id'>>
): Promise<CatalogProduct> {
  const product = await CatalogProduct.findByPk(id);
  if (!product) throw new AppError('Producto no encontrado', 404);
  const { sizes, ...rest } = input;
  if (rest.discount_percentage != null) {
    rest.discount_percentage = Math.min(100, Math.max(0, Math.round(rest.discount_percentage)));
  }
  await product.update(rest);
  return getProduct(id);
}

export async function saveProductSizes(productId: number, sizes: SizeInput[]): Promise<CatalogProductSize[]> {
  const product = await CatalogProduct.findByPk(productId);
  if (!product) throw new AppError('Producto no encontrado', 404);

  const t = await sequelize.transaction();
  try {
    // Eliminar los talles existentes y recrear
    await CatalogProductSize.destroy({ where: { product_id: productId }, transaction: t });

    if (sizes.length) {
      await CatalogProductSize.bulkCreate(
        sizes.map((s, i) => ({
          product_id: productId,
          size_name: s.size_name,
          stock_quantity: s.stock_quantity,
          sort_order: s.sort_order ?? i,
        })),
        { transaction: t }
      );
    }

    await t.commit();
    return CatalogProductSize.findAll({
      where: { product_id: productId },
      order: [['sort_order', 'ASC']],
    });
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

export async function adjustProductStock(id: number, quantity: number): Promise<CatalogProduct> {
  const product = await CatalogProduct.findByPk(id);
  if (!product) throw new AppError('Producto no encontrado', 404);
  if (quantity < 0) throw new AppError('El stock no puede ser negativo', 400);
  await product.update({ stock_quantity: quantity });
  return product;
}

export async function deleteProduct(id: number): Promise<{ soft: boolean }> {
  const product = await CatalogProduct.findByPk(id, {
    include: [{ model: CatalogProductImage, as: 'images' }],
  });
  if (!product) throw new AppError('Producto no encontrado', 404);

  const usedCount = await CatalogOrderItem.count({ where: { product_id: id } });

  if (usedCount > 0) {
    // Tiene pedidos asociados: desactivar en vez de borrar
    await product.update({ active: false, show_in_store: false });
    return { soft: true };
  }

  const images = (product as CatalogProduct & { images?: CatalogProductImage[] }).images ?? [];
  for (const img of images) {
    if (img.cloudinary_public_id) {
      await cloudinary.uploader.destroy(img.cloudinary_public_id).catch(() => null);
    }
  }
  await product.destroy();
  return { soft: false };
}

// ─── Imágenes de productos ───────────────────────────────────────────────────

export async function addProductImage(
  productId: number,
  file: Express.Multer.File
): Promise<CatalogProductImage> {
  const product = await CatalogProduct.findByPk(productId, {
    include: [{ model: CatalogProductImage, as: 'images' }],
  });
  if (!product) throw new AppError('Producto no encontrado', 404);

  const images = (product as CatalogProduct & { images?: CatalogProductImage[] }).images ?? [];
  if (images.length >= 3) {
    throw new AppError('El producto ya tiene el máximo de 3 imágenes', 400);
  }

  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'indians/catalog', resource_type: 'image' },
      (err, res) => {
        if (err || !res) return reject(err || new Error('Upload fallido'));
        resolve({ secure_url: res.secure_url, public_id: res.public_id });
      }
    ).end(file.buffer);
  });

  return CatalogProductImage.create({
    product_id: productId,
    url: result.secure_url,
    cloudinary_public_id: result.public_id,
    sort_order: images.length,
  });
}

export async function deleteProductImage(imageId: number): Promise<void> {
  const image = await CatalogProductImage.findByPk(imageId);
  if (!image) throw new AppError('Imagen no encontrada', 404);

  if (image.cloudinary_public_id) {
    await cloudinary.uploader.destroy(image.cloudinary_public_id).catch(() => null);
  }
  await image.destroy();
}

// ─── Pedidos del catálogo ─────────────────────────────────────────────────────

export interface OrderItemInput {
  product_id: number;
  size_name?: string | null;
  quantity: number;
}

export interface CreateCatalogOrderInput {
  client_id?: number | null;
  seller_id: number;
  payment_type: 'full' | 'half';
  items: OrderItemInput[];
  notes?: string;
  back_urls?: { success: string; failure: string; pending: string };
}

export async function createCatalogOrder(input: CreateCatalogOrderInput) {
  const t = await sequelize.transaction();
  try {
    if (!input.items.length) throw new AppError('El pedido debe tener al menos un ítem', 400);

    const productIds = [...new Set(input.items.map((i) => i.product_id))];
    const products = await CatalogProduct.findAll({
      where: { id: productIds, active: true },
      include: [{ model: CatalogProductSize, as: 'sizes' }],
    });
    if (products.length !== productIds.length) {
      throw new AppError('Uno o más productos no existen o están inactivos', 400);
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Verificar stock por ítem
    for (const item of input.items) {
      const product = productMap.get(item.product_id)!;
      const sizes = (product as CatalogProduct & { sizes?: CatalogProductSize[] }).sizes ?? [];

      if (sizes.length > 0) {
        // Producto con talles — el talle es obligatorio
        if (!item.size_name) {
          throw new AppError(`Debés seleccionar un talle para "${product.title}"`, 400);
        }
        const sizeRecord = sizes.find((s) => s.size_name === item.size_name);
        if (!sizeRecord) {
          throw new AppError(`Talle "${item.size_name}" no existe en "${product.title}"`, 400);
        }
        if (sizeRecord.stock_quantity < item.quantity) {
          throw new AppError(
            `Stock insuficiente para "${product.title}" talle ${item.size_name}. Disponible: ${sizeRecord.stock_quantity}`,
            400
          );
        }
      } else {
        // Producto sin talles
        if (product.stock_quantity < item.quantity) {
          throw new AppError(
            `Stock insuficiente para "${product.title}". Disponible: ${product.stock_quantity}`,
            400
          );
        }
      }
    }

    // Calcular totales
    let totalAmount = 0;
    const resolvedItems = input.items.map((item) => {
      const product = productMap.get(item.product_id)!;
      const subtotal = parseFloat((product.price * item.quantity).toFixed(2));
      totalAmount += subtotal;
      return { ...item, unit_price: product.price, subtotal };
    });
    totalAmount = parseFloat(totalAmount.toFixed(2));
    const paymentAmount = input.payment_type === 'half'
      ? parseFloat((totalAmount / 2).toFixed(2))
      : totalAmount;

    // Auto-detectar client_id si todos los ítems pertenecen al mismo cliente
    const uniqueClientIds = [...new Set(products.map((p) => p.client_id))];
    const resolvedClientId =
      input.client_id ?? (uniqueClientIds.length === 1 ? uniqueClientIds[0] : null);

    const orderNumber = await generateOrderNumber();
    const order = await CatalogOrder.create({
      order_number: orderNumber,
      client_id: resolvedClientId,
      seller_id: input.seller_id,
      status: 'created',
      payment_type: input.payment_type,
      total_amount: totalAmount,
      payment_amount: paymentAmount,
      notes: input.notes || null,
    }, { transaction: t });

    await CatalogOrderItem.bulkCreate(
      resolvedItems.map((item) => ({
        catalog_order_id: order.id,
        product_id: item.product_id,
        size_name: item.size_name || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      })),
      { transaction: t }
    );

    // Decrementar stock (paralelo — una query por ítem en lugar de secuencial)
    await Promise.all(resolvedItems.map((item) => {
      const product = productMap.get(item.product_id)!;
      const sizes = (product as CatalogProduct & { sizes?: CatalogProductSize[] }).sizes ?? [];
      if (sizes.length > 0 && item.size_name) {
        const sizeRecord = sizes.find((s) => s.size_name === item.size_name)!;
        return sizeRecord.decrement('stock_quantity', { by: item.quantity, transaction: t });
      }
      return product.decrement('stock_quantity', { by: item.quantity, transaction: t });
    }));

    // Auto-crear factura del catálogo
    const invoiceNumber = await generateInvoiceNumber();
    await CatalogInvoice.create({
      catalog_order_id: order.id,
      invoice_number: invoiceNumber,
      issue_date: new Date().toISOString().split('T')[0],
      status: 'issued',
      total_amount: totalAmount,
      payment_amount: 0,
    }, { transaction: t });

    await t.commit();

    // Crear preferencia MercadoPago
    if (input.back_urls && process.env.MP_ACCESS_TOKEN) {
      try {
        const mpItems = resolvedItems.map((item) => {
          const prod = productMap.get(item.product_id)!;
          return {
            id: `${item.product_id}${item.size_name ? `-${item.size_name}` : ''}`,
            title: `${prod.title}${item.size_name ? ` (${item.size_name})` : ''}`,
            quantity: item.quantity,
            unit_price: item.unit_price,
          };
        });

        const mpResult = await mpService.createPreference({
          externalReference: order.order_number,
          items: mpItems,
          totalAmount,
          paymentType: input.payment_type,
          backUrls: input.back_urls,
        });

        await order.update({ mp_preference_id: mpResult.preference_id ?? undefined });
        return { ...order.toJSON(), mp_init_point: mpResult.init_point, mp_sandbox_init_point: mpResult.sandbox_init_point };
      } catch {
        // Si MP falla, el pedido igual queda creado
      }
    }

    return await getCatalogOrder(order.id);
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

export async function listCatalogOrders(
  page: number,
  limit: number,
  filters: { client_id?: number; seller_id?: number; status?: string } = {}
) {
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (filters.client_id) where['client_id'] = filters.client_id;
  if (filters.seller_id) where['seller_id'] = filters.seller_id;
  if (filters.status) where['status'] = filters.status;

  const { rows, count } = await CatalogOrder.findAndCountAll({
    where,
    include: [
      { model: Client, as: 'client', attributes: ['id', 'name'] },
      { model: User, as: 'seller', attributes: ['id', 'name', 'email'] },
      {
        model: CatalogOrderItem, as: 'items',
        include: [{ model: CatalogProduct, as: 'product', attributes: ['id', 'title', 'price'] }],
      },
      {
        model: CatalogInvoice, as: 'invoice',
        include: [
          { model: CatalogInvoiceImage, as: 'images', order: [['createdAt', 'ASC']] as [string, string][] },
          { model: CatalogInvoicePayment, as: 'payments', order: [['paid_at', 'ASC']] as [string, string][] },
        ],
      },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  return { orders: rows, total: count, page, limit };
}

export async function listCatalogInvoices(
  page: number,
  limit: number,
  filters: { status?: string; client_id?: number; seller_id?: number; date_from?: string; date_to?: string } = {}
) {
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = {};
  if (filters.status) where['status'] = filters.status;
  if (filters.date_from || filters.date_to) {
    const dateFilter: Record<symbol, string> = {};
    if (filters.date_from) dateFilter[Op.gte] = filters.date_from;
    if (filters.date_to)   dateFilter[Op.lte] = filters.date_to;
    where['issue_date'] = dateFilter;
  }

  const orderWhere: Record<string, unknown> = {};
  if (filters.client_id) orderWhere['client_id'] = filters.client_id;
  if (filters.seller_id) orderWhere['seller_id'] = filters.seller_id;
  const hasOrderFilter = Object.keys(orderWhere).length > 0;

  const { rows, count } = await CatalogInvoice.findAndCountAll({
    where,
    include: [
      {
        model: CatalogOrder, as: 'order',
        ...(hasOrderFilter ? { where: orderWhere, required: true } : {}),
        include: [
          { model: Client, as: 'client', attributes: ['id', 'name'] },
          { model: User, as: 'seller', attributes: ['id', 'name'] },
        ],
      },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
    distinct: true,
  });

  return { invoices: rows, total: count, page, limit };
}

export async function getCatalogOrder(id: number) {
  const order = await CatalogOrder.findByPk(id, {
    include: [
      { model: Client, as: 'client', attributes: ['id', 'name', 'email', 'phone'] },
      { model: User, as: 'seller', attributes: ['id', 'name', 'email'] },
      {
        model: CatalogOrderItem, as: 'items',
        include: [{
          model: CatalogProduct, as: 'product',
          include: [{ model: CatalogProductImage, as: 'images', order: [['sort_order', 'ASC']] as [string, string][] }],
        }],
      },
      {
        model: CatalogInvoice, as: 'invoice',
        include: [
          { model: CatalogInvoiceImage, as: 'images', order: [['createdAt', 'ASC']] as [string, string][] },
          { model: CatalogInvoicePayment, as: 'payments', order: [['paid_at', 'ASC']] as [string, string][] },
        ],
      },
    ],
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  return order;
}

export async function getCatalogInvoice(orderId: number) {
  const invoice = await CatalogInvoice.findOne({
    where: { catalog_order_id: orderId },
    include: [
      { model: CatalogInvoiceImage, as: 'images', order: [['createdAt', 'ASC']] as [string, string][] },
      { model: CatalogInvoicePayment, as: 'payments', order: [['paid_at', 'ASC']] as [string, string][] },
    ],
  });
  if (!invoice) throw new AppError('Factura no encontrada', 404);
  return invoice;
}

export async function updateCatalogInvoiceStatus(
  orderId: number,
  status: 'draft' | 'issued' | 'paid' | 'cancelled',
  payment_amount?: number | null
) {
  const invoice = await CatalogInvoice.findOne({ where: { catalog_order_id: orderId } });
  if (!invoice) throw new AppError('Factura no encontrada', 404);
  const updates: Partial<{ status: typeof status; payment_amount: number }> = { status };
  if (payment_amount !== undefined && payment_amount !== null) {
    updates.payment_amount = payment_amount;
  }
  await invoice.update(updates);
  return invoice;
}

export async function addInvoiceImage(
  orderId: number,
  file: Express.Multer.File,
  uploadedBy?: number
): Promise<CatalogInvoiceImage> {
  const invoice = await CatalogInvoice.findOne({ where: { catalog_order_id: orderId } });
  if (!invoice) throw new AppError('Factura no encontrada', 404);

  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'indians/invoice-payments', resource_type: 'image' },
      (err, res) => {
        if (err || !res) return reject(err || new Error('Upload fallido'));
        resolve({ secure_url: res.secure_url, public_id: res.public_id });
      }
    ).end(file.buffer);
  });

  return CatalogInvoiceImage.create({
    catalog_invoice_id: invoice.id,
    url: result.secure_url,
    cloudinary_public_id: result.public_id,
    uploaded_by: uploadedBy ?? null,
  });
}

export async function deleteInvoiceImage(imageId: number): Promise<void> {
  const image = await CatalogInvoiceImage.findByPk(imageId);
  if (!image) throw new AppError('Imagen no encontrada', 404);
  if (image.cloudinary_public_id) {
    await cloudinary.uploader.destroy(image.cloudinary_public_id).catch(() => null);
  }
  await image.destroy();
}

export async function updateCatalogOrderStatus(
  id: number,
  status: 'created' | 'invoice_created' | 'delivered'
) {
  const order = await CatalogOrder.findByPk(id);
  if (!order) throw new AppError('Pedido no encontrado', 404);
  await order.update({ status });
  return order;
}

export async function initiateCatalogPayment(
  orderId: number,
  backUrls: { success: string; failure: string; pending: string },
  customAmount?: number
) {
  const order = await getCatalogOrder(orderId);
  const items = (order as CatalogOrder & { items?: (CatalogOrderItem & { product?: CatalogProduct })[] }).items ?? [];

  const mpItems = items.map((item) => ({
    id: `${item.product_id}${item.size_name ? `-${item.size_name}` : ''}`,
    title: `${item.product?.title ?? `Producto ${item.product_id}`}${item.size_name ? ` (${item.size_name})` : ''}`,
    quantity: item.quantity,
    unit_price: item.unit_price,
  }));

  const mpResult = await mpService.createPreference({
    externalReference: order.order_number,
    items: mpItems,
    totalAmount: order.total_amount,
    paymentType: order.payment_type,
    overrideAmount: customAmount,
    backUrls,
  });

  await order.update({ mp_preference_id: mpResult.preference_id ?? undefined });
  return mpResult;
}

export async function addPaymentToCatalogInvoice(
  orderId: number,
  amount: number,
  notes?: string
) {
  const invoice = await CatalogInvoice.findOne({ where: { catalog_order_id: orderId } });
  if (!invoice) throw new AppError('Factura no encontrada', 404);
  if (invoice.status === 'cancelled') throw new AppError('No se puede pagar una factura cancelada', 400);
  if (invoice.status === 'paid') throw new AppError('La factura ya está completamente pagada', 400);

  await CatalogInvoicePayment.create({ catalog_invoice_id: invoice.id, amount, notes: notes ?? null });

  const rows = await CatalogInvoicePayment.findAll({ where: { catalog_invoice_id: invoice.id } });
  const totalPaid = rows.reduce((s, p) => s + p.amount, 0);
  const invoiceTotal = Number(invoice.total_amount ?? 0);

  await invoice.update({
    payment_amount: totalPaid,
    status: invoiceTotal > 0 && totalPaid >= invoiceTotal ? 'paid' : invoice.status,
  });

  return getCatalogInvoice(orderId);
}

export async function handleMPWebhook(paymentId: string) {
  const paymentInfo = await mpService.getPaymentInfo(paymentId);
  const externalRef = paymentInfo.external_reference;
  if (!externalRef) return;

  const order = await CatalogOrder.findOne({ where: { order_number: externalRef } });
  if (!order) return;

  await order.update({
    mp_payment_id: String(paymentInfo.id),
    mp_payment_status: paymentInfo.status ?? null,
  });
}
