import { createHash } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { type Includeable, Op, Transaction, UniqueConstraintError } from 'sequelize';
import { AppError } from '../middlewares/errorHandler';
import { invalidateCache } from '../utils/cache';
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
  GarmentType,
  ProductCategory,
} from '../models';
import { sequelize } from '../config/db';
import { getIO } from '../config/socket';
import { WebhookEvent } from '../models/WebhookEvent';
import * as mpService from './mercadopago.service';
import * as stockLedger from './stockLedger.service';
import type { InvoicePaymentMethod } from '../models/InvoicePayment';
import { recordInvoiceCollectionCashIncome, reverseAllForReference } from './cash.service';
import { logger } from '../utils/logger';
import { sendAlert } from '../utils/alerts';
import { enqueueEmail } from '../utils/emailQueue';
import { escapeHtml } from '../utils/escapeHtml';
import { formatPriceNumber } from '../utils/money';

// ─── Include estándar de un producto ─────────────────────────────────────────

const PRODUCT_INCLUDE: Includeable[] = [
  { model: CatalogProductImage, as: 'images',      order: [['sort_order', 'ASC']] as [string, string][] },
  { model: CatalogProductSize,  as: 'sizes',       order: [['sort_order', 'ASC']] as [string, string][] },
  { model: GarmentType,         as: 'garmentType', attributes: ['id', 'name'], required: false },
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
  client_id:       number;
  title:           string;
  description?:    string;
  price:           number;
  public_price?:   number | null;
  discount_percentage?: number;
  show_in_store?:  boolean;
  category?:       string | null;
  gender?:         'masculino' | 'femenino' | 'infantil' | 'unisex' | null;
  tags?:           string[] | null;
  garment_type_id?: number | null;
  stock_quantity?: number;
  active?:         boolean;
  sizes?:          SizeInput[];
}

export async function listClientProducts(clientId: number) {
  return CatalogProduct.findAll({
    where: { client_id: clientId },
    include: PRODUCT_INCLUDE,
    order: [['createdAt', 'DESC']],
  });
}

export async function listAllProducts(page: number, limit: number, clientId?: number, garmentTypeId?: number) {
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = { active: true };
  if (clientId) where['client_id'] = clientId;
  if (garmentTypeId) where['garment_type_id'] = garmentTypeId;

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
      garment_type_id: input.garment_type_id ?? null,
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
    invalidateCache('store:filter-options');
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
  invalidateCache('store:filter-options');
  return getProduct(id);
}

/**
 * Reemplaza el juego de talles de un producto.
 *
 * NO borra y recrea (AUD-15). Hacerlo perdía `stock_reserved` — la columna no
 * se copiaba al recrear, así que volvía a 0 — con tres consecuencias reales:
 *
 *  1. Las reservas vivas de pedidos en `pending_payment` desaparecían y las
 *     mismas unidades se podían vender de nuevo.
 *  2. Al acreditarse el pago, `confirmStoreOrderStock` descuenta la reserva
 *     (`delta: -quantity` sobre `stock_reserved`) y `adjustStock` lanza 400 si
 *     el resultado queda negativo: el pedido pagado quedaba imposible de
 *     confirmar, con la plata ya cobrada.
 *  3. La FK de `catalog_stock_movements.catalog_product_size_id` es
 *     `ON DELETE SET NULL`: borrar el talle dejaba todos sus movimientos
 *     históricos sin referencia, indistinguibles de movimientos de producto.
 *
 * En su lugar: los talles que siguen se actualizan in place (conservan `id`,
 * `stock_reserved` y todas las FKs que los apuntan), los nuevos se crean, y los
 * que desaparecen se borran **sólo si no tienen reservas vivas** — si las
 * tienen, la operación entera se rechaza con 409 en vez de romper en silencio.
 */
export async function saveProductSizes(productId: number, sizes: SizeInput[]): Promise<CatalogProductSize[]> {
  const product = await CatalogProduct.findByPk(productId);
  if (!product) throw new AppError('Producto no encontrado', 404);

  // Dos talles con el mismo nombre harían ambiguo el emparejamiento por nombre
  // (y ya eran un dato inválido antes, sólo que se guardaban igual).
  const names = sizes.map((s) => s.size_name);
  const duplicated = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicated) {
    throw new AppError(`El talle "${duplicated}" está repetido en la lista`, 400);
  }

  const t = await sequelize.transaction();
  try {
    // Lock de las filas existentes: sin esto, un checkout concurrente podría
    // reservar sobre un talle que estamos por borrar entre el chequeo y el
    // DELETE, y la reserva se perdería igual.
    const existing = await CatalogProductSize.findAll({
      where: { product_id: productId },
      lock: Transaction.LOCK.UPDATE,
      transaction: t,
    });
    const byName = new Map(existing.map((s) => [s.size_name, s]));
    const incoming = new Set(names);

    const toDelete = existing.filter((s) => !incoming.has(s.size_name));
    const reserved = toDelete.filter((s) => Number(s.stock_reserved) > 0);
    if (reserved.length) {
      throw new AppError(
        `No se puede eliminar ${reserved.length === 1 ? 'el talle' : 'los talles'} ` +
          `${reserved.map((s) => `"${s.size_name}"`).join(', ')}: ` +
          `${reserved.length === 1 ? 'tiene' : 'tienen'} stock reservado por pedidos pendientes de pago. ` +
          `Esperá a que esos pedidos se paguen o se cancelen antes de quitar el talle.`,
        409
      );
    }

    for (const [i, s] of sizes.entries()) {
      const current = byName.get(s.size_name);
      if (current) {
        // `stock_reserved` NO se toca acá: sólo se mueve por el ledger.
        await current.update(
          { stock_quantity: s.stock_quantity, sort_order: s.sort_order ?? i },
          { transaction: t }
        );
      } else {
        await CatalogProductSize.create(
          {
            product_id: productId,
            size_name: s.size_name,
            stock_quantity: s.stock_quantity,
            sort_order: s.sort_order ?? i,
          },
          { transaction: t }
        );
      }
    }

    if (toDelete.length) {
      await CatalogProductSize.destroy({
        where: { id: toDelete.map((s) => s.id) },
        transaction: t,
      });
    }

    await t.commit();
    invalidateCache('store:filter-options');
    return CatalogProductSize.findAll({
      where: { product_id: productId },
      order: [['sort_order', 'ASC']],
    });
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

export async function adjustProductStock(id: number, quantity: number, userId: number | null): Promise<CatalogProduct> {
  const exists = await CatalogProduct.count({ where: { id } });
  if (!exists) throw new AppError('Producto no encontrado', 404);
  if (quantity < 0) throw new AppError('El stock no puede ser negativo', 400);

  await sequelize.transaction(async (t) => {
    await stockLedger.adjustStock({
      transaction: t,
      type: 'adjustment',
      source: 'manual',
      catalogProductId: id,
      setTo: quantity,
      userId,
      reason: 'Ajuste manual de stock (admin)',
    });
  });

  return (await CatalogProduct.findByPk(id))!;
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
    invalidateCache('store:filter-options');
    return { soft: true };
  }

  const images = (product as CatalogProduct & { images?: CatalogProductImage[] }).images ?? [];
  for (const img of images) {
    if (img.cloudinary_public_id) {
      await cloudinary.uploader.destroy(img.cloudinary_public_id).catch(() => null);
    }
  }
  await product.destroy();
  invalidateCache('store:filter-options');
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

  // Medida estándar única para TODO el catálogo: retrato 3:4 a 1200×1600, recortado
  // con gravedad automática (mantiene el sujeto) y entregado con formato/calidad
  // automáticos (f_auto/q_auto). Guardamos la URL ya transformada: el original queda
  // intacto en Cloudinary y la tienda (que renderiza `img.url` con object-cover 3:4)
  // recibe siempre la misma proporción, sin recortes desparejos entre productos.
  const url = cloudinary.url(result.public_id, {
    secure: true,
    transformation: [
      { aspect_ratio: '3:4', width: 1200, crop: 'fill', gravity: 'auto' },
      { fetch_format: 'auto', quality: 'auto' },
    ],
  });

  return CatalogProductImage.create({
    product_id: productId,
    url,
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

    // Descontar stock a través del ledger centralizado (stockLedger.service.ts),
    // único punto autorizado a tocar stock_quantity. Secuencial (no Promise.all):
    // el lock de fila que usa el ledger para leer/actualizar de forma segura no
    // debe mezclarse con otras sentencias concurrentes en la misma conexión de
    // la transacción. De paso cierra la ventana de sobreventa que tenía el
    // decrement() en paralelo anterior (sin guarda atómica de stock disponible).
    for (const item of resolvedItems) {
      const product = productMap.get(item.product_id)!;
      const sizes = (product as CatalogProduct & { sizes?: CatalogProductSize[] }).sizes ?? [];
      const sizeRecord = sizes.length > 0 && item.size_name
        ? sizes.find((s) => s.size_name === item.size_name)
        : undefined;
      const label = item.size_name ? `${product.title} — talle ${item.size_name}` : product.title;
      const qty = Math.trunc(Number(item.quantity));

      try {
        await stockLedger.adjustStock({
          transaction: t,
          type: 'sale',
          source: 'catalog',
          catalogProductId: product.id,
          catalogProductSizeId: sizeRecord ? sizeRecord.id : null,
          delta: -qty,
          requireAvailable: true,
          catalogOrderId: order.id,
          userId: input.seller_id,
          reason: `Pedido mayorista ${orderNumber}`,
        });
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 409) {
          throw new AppError(`Stock insuficiente para ${label}`, 409);
        }
        throw err;
      }
    }

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
          notificationUrl: buildCatalogNotificationUrl(),
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
          { model: Client, as: 'client', attributes: ['id', 'name', 'cuit', 'condicion_iva'] },
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

/**
 * Al anular una factura de catálogo con cobros ya asentados, revierte todos
 * sus ingresos de caja en la MISMA transacción del cambio de estado
 * (DEC-012 — mismo tratamiento que `updateInvoice` en `invoice.service.ts`
 * para facturas de fábrica). Best-effort por diseño de
 * `reverseAllForReference`: nunca bloquea la anulación por un problema de
 * caja, y es naturalmente idempotente (una segunda llamada con
 * status='cancelled' no encuentra nada activo que revertir).
 */
export async function updateCatalogInvoiceStatus(
  orderId: number,
  status: 'draft' | 'issued' | 'paid' | 'cancelled',
  changedBy: number,
  payment_amount?: number | null
) {
  const invoice = await CatalogInvoice.findOne({ where: { catalog_order_id: orderId } });
  if (!invoice) throw new AppError('Factura no encontrada', 404);
  const updates: Partial<{ status: typeof status; payment_amount: number }> = { status };
  if (payment_amount !== undefined && payment_amount !== null) {
    updates.payment_amount = payment_amount;
  }

  if (status === 'cancelled') {
    await sequelize.transaction(async (t) => {
      await invoice.update(updates, { transaction: t });
      await reverseAllForReference(
        'catalog_invoice', invoice.id,
        `Anulación de factura ${invoice.invoice_number} (catálogo)`,
        changedBy, t
      );
    });
  } else {
    await invoice.update(updates);
  }

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
    notificationUrl: buildCatalogNotificationUrl(),
  });

  await order.update({ mp_preference_id: mpResult.preference_id ?? undefined });
  return mpResult;
}

export interface AddCatalogInvoicePaymentInput {
  amount: number;
  payment_method: InvoicePaymentMethod;
  notes?: string;
  /** Reintento de red seguro: dos altas con la misma clave devuelven el mismo cobro. */
  idempotency_key?: string;
}

/**
 * Copia funcional de `addPaymentToInvoice` (`invoice.service.ts`) para el
 * circuito de catálogo — mismo defecto original (sin transacción, sin
 * medio de pago, sin idempotencia, sin asiento de caja) y misma corrección
 * (DEC-012, cierra CASH-INV-001/CASH-INV-002 también acá). Ver los
 * comentarios completos en `addPaymentToInvoice`.
 */
export async function addPaymentToCatalogInvoice(
  orderId: number,
  input: AddCatalogInvoicePaymentInput,
  changedBy: number
) {
  if (input.idempotency_key) {
    const existing = await CatalogInvoicePayment.findOne({ where: { idempotency_key: input.idempotency_key } });
    if (existing) return getCatalogInvoice(orderId);
  }

  try {
    await sequelize.transaction(async (t) => {
      const invoice = await CatalogInvoice.findOne({
        where: { catalog_order_id: orderId }, transaction: t, lock: Transaction.LOCK.UPDATE,
      });
      if (!invoice) throw new AppError('Factura no encontrada', 404);
      if (invoice.status === 'cancelled') throw new AppError('No se puede pagar una factura cancelada', 400);
      if (invoice.status === 'paid') throw new AppError('La factura ya está completamente pagada', 400);

      const payment = await CatalogInvoicePayment.create(
        {
          catalog_invoice_id: invoice.id,
          amount: input.amount,
          payment_method: input.payment_method,
          notes: input.notes ?? null,
          idempotency_key: input.idempotency_key ?? null,
        },
        { transaction: t }
      );

      const rows = await CatalogInvoicePayment.findAll({ where: { catalog_invoice_id: invoice.id }, transaction: t });
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
          referenceType: 'catalog_invoice',
          referenceId: invoice.id,
          amount: input.amount,
          paymentMethod: input.payment_method,
          description: `Cobro factura ${invoice.invoice_number} (catálogo)`,
          createdBy: changedBy,
        },
        t
      );
      if (recordedAt) await payment.update({ cash_recorded_at: recordedAt }, { transaction: t });
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError && input.idempotency_key) {
      const existing = await CatalogInvoicePayment.findOne({ where: { idempotency_key: input.idempotency_key } });
      if (existing) return getCatalogInvoice(orderId);
    }
    throw err;
  }

  return getCatalogInvoice(orderId);
}

// ─── Acreditación de pagos de MercadoPago (catálogo) ─────────────────────────
//
// Hasta 2026-08-19 el webhook de catálogo sólo estampaba `mp_payment_id` /
// `mp_payment_status` en el pedido: NO registraba el cobro en la factura, no
// lo asentaba en caja y no avisaba a nadie. Como además la preference se
// creaba sin `notification_url` (ver `buildCatalogNotificationUrl`), MP nunca
// llegaba a llamarlo, así que un pedido pagado por QR o por link quedaba
// indistinguible de uno impago: factura sin cobro, dashboard en $0 y cero
// notificación. Esta sección le da el mismo tratamiento que ya tenía la
// tienda online (`applyPaymentResult` en store.service.ts).

/** Moneda única del sistema: un pago en otra moneda no se acredita a ciegas. */
const MP_EXPECTED_CURRENCY = 'ARS';

/** Prefijo de `external_reference` de un pedido de catálogo (`CAT-2026-00001`). */
const CATALOG_REFERENCE_PREFIX = 'CAT-';

/**
 * Tolerancia al comparar montos de MP contra el total de la factura. MP
 * redondea a 2 decimales y el pedido puede pagarse en mitades, así que una
 * diferencia de centavos no es una anomalía; más de $1 sí.
 */
const AMOUNT_TOLERANCE = 1;

/**
 * URL que MP llama server-to-server al cambiar el estado del pago. Sin esto
 * MP no notifica nada y la única vía de acreditación queda siendo el job de
 * reconciliación. Misma variable que usa la tienda (`BACKEND_PUBLIC_URL`).
 */
function buildCatalogNotificationUrl(): string | undefined {
  const backendUrl = process.env.BACKEND_PUBLIC_URL;
  if (!backendUrl) return undefined;
  return `${backendUrl.replace(/\/+$/, '')}/api/v1/catalog/webhook/mp`;
}

function emitCatalogPaymentEvent(
  order: CatalogOrder,
  amount: number,
  fullyPaid: boolean,
  clientName: string | null
): void {
  try {
    getIO().emit('notification:catalog_payment', {
      orderId: order.id,
      orderNumber: order.order_number,
      sellerId: order.seller_id,
      clientName,
      amount,
      total: Number(order.total_amount),
      fullyPaid,
    });
  } catch { /* el socket puede no estar inicializado (tests, scripts) */ }
}

/**
 * Aviso por mail de que entró un cobro. Complementa el toast por socket, que
 * sólo lo ve quien tenga el panel abierto en ese momento — justo lo que no
 * pasa cuando el cliente escanea el QR y se va.
 *
 * Destino: `CATALOG_PAYMENT_NOTIFY_EMAIL`, o `ALERT_EMAIL_TO` como reserva.
 * Sin ninguna de las dos configuradas no se manda nada (y no es un error).
 * `mailer` se importa en diferido por el mismo motivo que en `alerts.ts`:
 * instancia Resend en el top level del módulo.
 */
function notifyCatalogPaymentByEmail(params: {
  order: CatalogOrder;
  invoiceNumber: string;
  amount: number;
  totalPaid: number;
  invoiceTotal: number;
  fullyPaid: boolean;
  paymentId: string | null;
  clientName: string | null;
}): void {
  const to = process.env.CATALOG_PAYMENT_NOTIFY_EMAIL || process.env.ALERT_EMAIL_TO;
  if (!to) return;

  const { order, invoiceNumber, amount, totalPaid, invoiceTotal, fullyPaid, paymentId, clientName } = params;
  const pending = Math.max(0, invoiceTotal - totalPaid);

  enqueueEmail(`catalogPayment:${order.order_number}`, async () => {
    const { sendMail, emailWrapper } = await import('../utils/mailer');
    const rows: [string, string][] = [
      ['Pedido', order.order_number],
      ['Factura', invoiceNumber],
      ['Cliente', clientName ?? '—'],
      ['Cobrado ahora', `$${formatPriceNumber(amount)}`],
      ['Total de la factura', `$${formatPriceNumber(invoiceTotal)}`],
      ['Saldo pendiente', pending > 0 ? `$${formatPriceNumber(pending)}` : 'Sin saldo'],
      ['Pago MercadoPago', paymentId ?? '—'],
    ];
    await sendMail({
      to,
      subject: `${fullyPaid ? 'Pago acreditado' : 'Pago parcial acreditado'} — ${order.order_number} ($${formatPriceNumber(amount)})`,
      html: emailWrapper(`
        <h2 style="margin:0 0 4px;font-size:18px;color:#111827;">
          ${fullyPaid ? 'Pago acreditado' : 'Pago parcial acreditado'}
        </h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">
          Se acreditó un cobro de MercadoPago en una venta del catálogo.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          ${rows.map(([label, value]) => `
            <tr>
              <td style="padding:6px 0;color:#6b7280;">${escapeHtml(label)}</td>
              <td style="padding:6px 0;text-align:right;color:#111827;font-weight:600;">${escapeHtml(value)}</td>
            </tr>`).join('')}
        </table>
      `),
    });
  });
}

export interface ApplyCatalogPaymentResult {
  applied: boolean;
  /** Motivo estable — sirve para logs, tests y el `result` del WebhookEvent. */
  reason: string;
}

/**
 * Aplica a un pedido de catálogo el resultado de un pago de MercadoPago.
 * Compartida por el webhook y por el job de reconciliación, igual que
 * `applyPaymentResult` en la tienda. Criterios:
 *
 *  - El estado de MP se estampa SIEMPRE en el pedido, se acredite o no: es la
 *    traza de que el pago existió y llegó hasta acá.
 *  - Sólo `approved` acredita. Cualquier otro estado (pending, rejected…)
 *    queda registrado sin tocar la factura ni la caja.
 *  - Idempotente por `idempotency_key = mp-<paymentId>`, que tiene índice
 *    único (migración 094): el webhook y el job pueden pisarse sin duplicar el
 *    cobro, y MP puede reenviar la notificación las veces que quiera.
 *  - Un pago aprobado que no se puede imputar (factura anulada o inexistente,
 *    moneda distinta) NO se acredita a ciegas: se loguea como error y se
 *    dispara una alerta, porque es plata real que entró sin destino.
 *  - Un pago parcial (pedido con `payment_type='half'` o monto personalizado)
 *    es un caso normal, no un error: se registra y la factura queda en
 *    `issued` con saldo.
 */
export async function applyCatalogPaymentResult(
  order: CatalogOrder,
  payment: mpService.PaymentInfo,
  paymentId: string | null
): Promise<ApplyCatalogPaymentResult> {
  const mpStatus = payment.status ?? 'unknown';
  const resolvedPaymentId = paymentId ?? (payment.id != null ? String(payment.id) : null);

  await order.update({
    mp_payment_status: mpStatus,
    ...(resolvedPaymentId ? { mp_payment_id: resolvedPaymentId } : {}),
  });

  if (mpStatus !== 'approved') {
    return { applied: false, reason: `not_approved:${mpStatus}` };
  }

  const amount = Number(payment.transaction_amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error(
      'catalog.payment.invalidAmount',
      new Error('Pago aprobado de MercadoPago sin monto utilizable'),
      { meta: { orderNumber: order.order_number, paymentId: resolvedPaymentId, amount: payment.transaction_amount } }
    );
    return { applied: false, reason: 'invalid_amount' };
  }

  if (payment.currency_id && payment.currency_id !== MP_EXPECTED_CURRENCY) {
    logger.error(
      'catalog.payment.currencyMismatch',
      new Error('Pago de MercadoPago en una moneda distinta a la del sistema'),
      { meta: { orderNumber: order.order_number, paymentId: resolvedPaymentId, currency: payment.currency_id } }
    );
    await sendAlert({
      key: `catalog-payment-currency-${order.order_number}`,
      severity: 'critical',
      title: `Pago en moneda inesperada — ${order.order_number}`,
      detail:
        `MercadoPago informó un pago aprobado de ${amount} ${payment.currency_id} para el pedido ` +
        `${order.order_number}, pero el sistema opera en ${MP_EXPECTED_CURRENCY}.\n\n` +
        `NO se acreditó automáticamente. Revisar el pago ${resolvedPaymentId ?? 's/id'} en MercadoPago ` +
        `y registrar el cobro a mano si corresponde.`,
    });
    return { applied: false, reason: 'currency_mismatch' };
  }

  const idempotencyKey = resolvedPaymentId ? `mp-${resolvedPaymentId}` : null;
  if (idempotencyKey) {
    const already = await CatalogInvoicePayment.findOne({ where: { idempotency_key: idempotencyKey } });
    if (already) return { applied: false, reason: 'already_applied' };
  }

  let outcome: ApplyCatalogPaymentResult = { applied: false, reason: 'invoice_not_found' };
  let invoiceNumber = '';
  let invoiceTotal = 0;
  let totalPaid = 0;
  let fullyPaid = false;

  try {
    await sequelize.transaction(async (t) => {
      const invoice = await CatalogInvoice.findOne({
        where: { catalog_order_id: order.id }, transaction: t, lock: Transaction.LOCK.UPDATE,
      });
      if (!invoice) return;
      if (invoice.status === 'cancelled') {
        outcome = { applied: false, reason: 'invoice_cancelled' };
        return;
      }

      invoiceNumber = invoice.invoice_number;
      invoiceTotal = Number(invoice.total_amount ?? 0);

      const paymentRow = await CatalogInvoicePayment.create(
        {
          catalog_invoice_id: invoice.id,
          amount,
          payment_method: 'mercadopago',
          notes: `MercadoPago · pago ${resolvedPaymentId ?? 's/id'}`,
          idempotency_key: idempotencyKey,
        },
        { transaction: t }
      );

      const rows = await CatalogInvoicePayment.findAll({ where: { catalog_invoice_id: invoice.id }, transaction: t });
      totalPaid = rows.reduce((sum, p) => sum + p.amount, 0);
      fullyPaid = invoiceTotal > 0 && totalPaid >= invoiceTotal - AMOUNT_TOLERANCE;

      await invoice.update(
        { payment_amount: totalPaid, status: fullyPaid ? 'paid' : invoice.status },
        { transaction: t }
      );

      const recordedAt = await recordInvoiceCollectionCashIncome(
        {
          referenceType: 'catalog_invoice',
          referenceId: invoice.id,
          amount,
          paymentMethod: 'mercadopago',
          description: `Cobro factura ${invoice.invoice_number} (catálogo, MercadoPago)`,
          createdBy: order.seller_id,
        },
        t
      );
      if (recordedAt) await paymentRow.update({ cash_recorded_at: recordedAt }, { transaction: t });

      outcome = { applied: true, reason: fullyPaid ? 'applied:paid' : 'applied:partial' };
    });
  } catch (err) {
    // Carrera entre el webhook y el job de reconciliación aplicando el mismo
    // pago: el índice único de `idempotency_key` la corta, y el cobro que ganó
    // ya quedó registrado. No es un error.
    if (err instanceof UniqueConstraintError && idempotencyKey) {
      return { applied: false, reason: 'already_applied' };
    }
    throw err;
  }

  if (!outcome.applied) {
    logger.error(
      'catalog.payment.unassignable',
      new Error(`Pago aprobado que no se pudo imputar (${outcome.reason})`),
      { meta: { orderNumber: order.order_number, paymentId: resolvedPaymentId, amount, reason: outcome.reason } }
    );
    await sendAlert({
      key: `catalog-payment-unassignable-${order.order_number}`,
      severity: 'critical',
      title: `Pago sin imputar — ${order.order_number}`,
      detail:
        `MercadoPago aprobó un pago de $${formatPriceNumber(amount)} para el pedido ${order.order_number}, ` +
        `pero no se pudo registrar el cobro (motivo: ${outcome.reason}).\n\n` +
        `Es plata que entró y quedó sin asentar. Revisar el pedido en el panel de catálogo ` +
        `y el pago ${resolvedPaymentId ?? 's/id'} en MercadoPago.`,
    });
    return outcome;
  }

  if (invoiceTotal > 0 && totalPaid > invoiceTotal + AMOUNT_TOLERANCE) {
    logger.warn('catalog.payment.overpaid', {
      meta: { orderNumber: order.order_number, paymentId: resolvedPaymentId, totalPaid, invoiceTotal },
    });
    await sendAlert({
      key: `catalog-payment-overpaid-${order.order_number}`,
      severity: 'warning',
      title: `Cobro mayor al total facturado — ${order.order_number}`,
      detail:
        `La factura ${invoiceNumber} tiene un total de $${formatPriceNumber(invoiceTotal)} y acumula ` +
        `$${formatPriceNumber(totalPaid)} cobrados. El cobro se registró igual (la plata entró), ` +
        `pero conviene revisar si corresponde una devolución o una nota de crédito.`,
    });
  }

  const clientName = (order as CatalogOrder & { client?: Client }).client?.name ?? null;

  logger.info('catalog.payment.applied', {
    meta: {
      orderNumber: order.order_number, paymentId: resolvedPaymentId,
      amount, totalPaid, invoiceTotal, fullyPaid,
    },
  });

  emitCatalogPaymentEvent(order, amount, fullyPaid, clientName);
  notifyCatalogPaymentByEmail({
    order, invoiceNumber, amount, totalPaid, invoiceTotal, fullyPaid,
    paymentId: resolvedPaymentId, clientName,
  });

  return outcome;
}

/**
 * Punto de entrada del webhook de MercadoPago para catálogo.
 *
 * Deduplica por `webhook_events` con el mismo criterio que la tienda (MP
 * reenvía la misma notificación varias veces), pero con `provider` propio para
 * que un pago de catálogo y uno de tienda con el mismo id no se pisen. Si el
 * procesamiento falla NO se marca `processed_at`: el evento queda disponible
 * para el reintento de MP o para el job de reconciliación.
 */
export async function handleMPWebhook(paymentId: string, rawPayload?: unknown): Promise<void> {
  const provider = 'mercadopago_catalog';
  const payloadHash = rawPayload
    ? createHash('sha256').update(JSON.stringify(rawPayload)).digest('hex')
    : null;

  let event = await WebhookEvent.findOne({ where: { provider, event_id: paymentId } });
  if (event?.processed_at) return;

  if (!event) {
    try {
      event = await WebhookEvent.create({ provider, event_id: paymentId, payload_hash: payloadHash });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        event = await WebhookEvent.findOne({ where: { provider, event_id: paymentId } });
        if (event?.processed_at) return;
      } else {
        throw err;
      }
    }
  }

  try {
    const info = await mpService.getPaymentInfo(paymentId);
    const ref = info.external_reference;
    if (!ref || !ref.startsWith(CATALOG_REFERENCE_PREFIX)) {
      await event?.update({ processed_at: new Date(), result: 'ignored_no_reference' });
      return;
    }

    const order = await CatalogOrder.findOne({
      where: { order_number: ref },
      include: [{ model: Client, as: 'client', attributes: ['id', 'name'] }],
    });
    if (!order) {
      await event?.update({ processed_at: new Date(), result: 'ignored_order_not_found' });
      return;
    }

    const result = await applyCatalogPaymentResult(order, info, paymentId);
    await event?.update({ processed_at: new Date(), result: result.reason.slice(0, 50) });
  } catch (err) {
    logger.error('catalog.webhook.processingFailed', err, { meta: { paymentId } });
    throw err;
  }
}

/**
 * Reconciliación de un pedido de catálogo contra MercadoPago, sin depender del
 * webhook. La usa el job periódico, y sirve también para recuperar a mano un
 * pago viejo: busca los pagos asociados al `external_reference` del pedido y
 * aplica los aprobados.
 *
 * Aplica TODOS los aprobados, no sólo el último: un pedido puede cobrarse en
 * dos partes (mitad al encargar, mitad al retirar) y cada pago es un cobro
 * distinto. `applyCatalogPaymentResult` es idempotente, así que reprocesar los
 * ya aplicados no duplica nada.
 */
export async function confirmCatalogPayment(orderNumber: string): Promise<ApplyCatalogPaymentResult[]> {
  const order = await CatalogOrder.findOne({
    where: { order_number: orderNumber },
    include: [{ model: Client, as: 'client', attributes: ['id', 'name'] }],
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const payments = await mpService.searchPaymentsByReference(order.order_number);
  const approved = payments.filter((p) => p.status === 'approved');

  // Sin ningún pago aprobado igual dejamos registrado el último estado
  // conocido de MP, que es lo que el panel muestra como referencia.
  if (approved.length === 0) {
    const latest = payments[0];
    if (latest) await applyCatalogPaymentResult(order, latest, latest.id != null ? String(latest.id) : null);
    return [];
  }

  const results: ApplyCatalogPaymentResult[] = [];
  for (const payment of approved) {
    results.push(await applyCatalogPaymentResult(order, payment, payment.id != null ? String(payment.id) : null));
  }
  return results;
}

// ─── Categorías de producto ───────────────────────────────────────────────────

export async function listProductCategories() {
  return ProductCategory.findAll({ order: [['sort_order', 'ASC'], ['name', 'ASC']] });
}

export async function createProductCategory(name: string): Promise<ProductCategory> {
  const count = await ProductCategory.count();
  return ProductCategory.create({ name: name.trim(), sort_order: count });
}

export async function updateProductCategory(id: number, data: { name?: string; sort_order?: number }): Promise<ProductCategory> {
  const cat = await ProductCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  await cat.update({ ...(data.name ? { name: data.name.trim() } : {}), ...(data.sort_order != null ? { sort_order: data.sort_order } : {}) });
  return cat;
}

export async function deleteProductCategory(id: number): Promise<void> {
  const cat = await ProductCategory.findByPk(id);
  if (!cat) throw new AppError('Categoría no encontrada', 404);
  await cat.destroy();
}
