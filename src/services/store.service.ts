import { randomBytes } from 'crypto';
import { Op, col, literal, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../config/db';
import {
  CatalogProduct,
  CatalogProductImage,
  CatalogProductSize,
  StoreOrder,
  StoreOrderItem,
  StoreOrderStatusHistory,
  StoreCoupon,
  StoreCustomer,
  Settings,
  User,
} from '../models';
import { Client } from '../models/Client';
import { GarmentType } from '../models/GarmentType';
import { AppError } from '../middlewares/errorHandler';
import { createPreference, getPaymentInfo, searchPaymentsByReference } from './mercadopago.service';
import {
  sendOrderConfirmationEmail,
  sendOrderInvoiceEmail,
  sendStoreOrderStatusEmail,
  statusNotifiesCustomer,
} from '../utils/email.service';
import { enqueueEmail } from '../utils/emailQueue';
import { generateInvoicePdf } from '../utils/store.pdf';
import { getAllSettings } from './settings.service';
import { StoreOrderStatus } from '../models/StoreOrder';
import {
  STORE_STATUS_LABELS,
  isValidStoreTransition,
  statusRequiresShipping,
} from '../config/storeOrderFlow';
import { getIO } from '../config/socket';
import { cached } from '../utils/cache';
import { cloudinary } from '../config/cloudinary';
import { roundPrice } from '../utils/money';

// ─── Comprobantes de pago: URLs firmadas ─────────────────────────────────────

function signedProofUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    type: 'authenticated',
    resource_type: 'image',
    secure: true,
    sign_url: true,
  });
}

/**
 * Reemplaza las URLs de comprobantes por URLs firmadas de Cloudinary
 * (assets `authenticated`) cuando hay `public_id` guardado. Los comprobantes
 * viejos (sin public_id) se subieron como públicos → se dejan tal cual.
 * Recibe/devuelve un objeto plano (toJSON) y elimina los public_id del payload.
 */
export function signPaymentProofs<T extends {
  payment_proof_url?: string | null;
  payment_proof_url_2?: string | null;
  payment_proof_public_id?: string | null;
  payment_proof_public_id_2?: string | null;
}>(order: T): T {
  if (order.payment_proof_public_id) {
    order.payment_proof_url = signedProofUrl(order.payment_proof_public_id);
  }
  if (order.payment_proof_public_id_2) {
    order.payment_proof_url_2 = signedProofUrl(order.payment_proof_public_id_2);
  }
  delete order.payment_proof_public_id;
  delete order.payment_proof_public_id_2;
  return order;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getStoreSetting(key: string): Promise<string> {
  const row = await Settings.findOne({ where: { key } });
  return row?.value ?? '';
}

// ─── Seguimiento: token opaco + link público ─────────────────────────────────

const STORE_URL = process.env.STORE_URL || 'http://localhost:5173/tienda';
const DEFAULT_TRACKING_EXPIRY_DAYS = 30;

/** Token opaco no adivinable para el link público de seguimiento. */
function generateTrackingToken(): string {
  return randomBytes(24).toString('hex'); // 48 chars, cabe en STRING(64)
}

export function buildTrackingUrl(token: string): string {
  return `${STORE_URL}/seguimiento/${token}`;
}

/** Días de vigencia del link tras "Entregado" (setting configurable, default 30). */
async function getTrackingExpiryDays(): Promise<number> {
  const raw = parseInt(await getStoreSetting('tracking_link_expiry_days'), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TRACKING_EXPIRY_DAYS;
}

async function generateStoreOrderNumber(): Promise<string> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const prefix = `ECOM-${yyyy}${mm}${dd}-`;

  const last = await StoreOrder.findOne({
    where: { order_number: { [Op.like]: `${prefix}%` } },
    order: [['id', 'DESC']],
    attributes: ['order_number'],
  });

  let seq = 1;
  if (last) {
    const parts = last.order_number.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── Productos públicos ──────────────────────────────────────────────────────

export type StoreProductSort = 'newest' | 'price_asc' | 'price_desc' | 'name_asc';

export interface StoreProductFilters {
  search?: string;
  category?: string;
  gender?: string;
  tag?: string;
  garment_type_id?: number;
  size?: string;
  price_min?: number;
  price_max?: number;
  sort?: StoreProductSort;
  client_id?: number;
  page?: number;
  limit?: number;
}

export async function listStoreProducts(filters: StoreProductFilters = {}) {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 24, 60);
  const offset = (page - 1) * limit;

  const conditions: unknown[] = [
    { show_in_store: true },
    { active: true },
  ];

  if (filters.search) {
    conditions.push({
      [Op.or]: [
        { title: { [Op.like]: `%${filters.search}%` } },
        { description: { [Op.like]: `%${filters.search}%` } },
      ],
    });
  }

  if (filters.category) {
    conditions.push({ category: filters.category });
  }

  if (filters.gender) {
    conditions.push({ gender: filters.gender });
  }

  if (filters.size) {
    conditions.push(
      sequelize.where(
        sequelize.literal(
          `(SELECT COUNT(*) FROM catalog_product_sizes WHERE product_id = CatalogProduct.id AND size_name = ${sequelize.escape(filters.size)})`
        ),
        { [Op.gt]: 0 }
      )
    );
  }

  if (filters.price_min !== undefined) {
    conditions.push(
      sequelize.where(sequelize.literal('COALESCE(public_price, price)'), { [Op.gte]: filters.price_min })
    );
  }

  if (filters.price_max !== undefined) {
    conditions.push(
      sequelize.where(sequelize.literal('COALESCE(public_price, price)'), { [Op.lte]: filters.price_max })
    );
  }

  if (filters.client_id !== undefined) {
    conditions.push({ client_id: filters.client_id });
  }

  if (filters.tag) {
    // JSON_CONTAINS necesita un valor JSON válido: '"tag_name"' (con comillas dobles dentro)
    conditions.push(
      sequelize.where(
        sequelize.fn('JSON_CONTAINS', sequelize.col('CatalogProduct.tags'), sequelize.literal(sequelize.escape(JSON.stringify(filters.tag)))),
        1
      )
    );
  }

  if (filters.garment_type_id) {
    conditions.push({ garment_type_id: filters.garment_type_id });
  }

  const where = { [Op.and]: conditions };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any[] = [[sequelize.col('CatalogProduct.id'), 'DESC']];
  switch (filters.sort) {
    case 'price_asc':
      order = [[sequelize.literal('COALESCE(public_price, price)'), 'ASC']];
      break;
    case 'price_desc':
      order = [[sequelize.literal('COALESCE(public_price, price)'), 'DESC']];
      break;
    case 'name_asc':
      order = [[sequelize.col('title'), 'ASC']];
      break;
  }

  // `separate: true` en los hasMany (imágenes, tallas): Sequelize los trae en
  // queries aparte (IN sobre los IDs de la página) en vez de un JOIN que multiplica
  // filas y obliga a un COUNT(DISTINCT) caro. El COUNT del padre queda simple.
  const { count, rows } = await CatalogProduct.findAndCountAll({
    where,
    include: [
      { model: CatalogProductImage, as: 'images', attributes: ['id', 'url', 'sort_order'], separate: true, order: [['sort_order', 'ASC']] },
      { model: CatalogProductSize,  as: 'sizes',  attributes: ['id', 'size_name', 'stock_quantity', 'sort_order'], separate: true, order: [['sort_order', 'ASC']] },
      { model: Client,              as: 'client', attributes: ['id', 'name'] },
    ],
    order,
    limit,
    offset,
  });

  return {
    data: rows,
    meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) },
  };
}

async function computeStoreFilterOptions() {
  const [categories] = await sequelize.query(`
    SELECT DISTINCT category
    FROM catalog_products
    WHERE show_in_store = 1 AND active = 1 AND category IS NOT NULL AND category != ''
    ORDER BY category
  `);

  const [genders] = await sequelize.query(`
    SELECT DISTINCT gender
    FROM catalog_products
    WHERE show_in_store = 1 AND active = 1 AND gender IS NOT NULL
    ORDER BY gender
  `);

  const [sizes] = await sequelize.query(`
    SELECT cps.size_name, MIN(cps.sort_order) AS min_order
    FROM catalog_product_sizes cps
    JOIN catalog_products cp ON cp.id = cps.product_id
    WHERE cp.show_in_store = 1 AND cp.active = 1 AND cps.stock_quantity > 0
    GROUP BY cps.size_name
    ORDER BY min_order, cps.size_name
  `);

  const [priceRange] = await sequelize.query(`
    SELECT
      FLOOR(MIN(COALESCE(public_price, price))) AS min_price,
      CEIL(MAX(COALESCE(public_price, price)))  AS max_price
    FROM catalog_products
    WHERE show_in_store = 1 AND active = 1
  `);

  const [clients] = await sequelize.query(`
    SELECT DISTINCT c.id, c.name, c.logo_url
    FROM clients c
    JOIN catalog_products cp ON cp.client_id = c.id
    WHERE cp.show_in_store = 1 AND cp.active = 1
    ORDER BY c.name
  `);

  const range = (priceRange as Array<{ min_price: number; max_price: number }>)[0] ?? { min_price: 0, max_price: 0 };

  // Extraer tags únicos de los arrays JSON de cada producto
  const tagRows = await CatalogProduct.findAll({
    attributes: ['tags'],
    where: { show_in_store: true, active: true },
    raw: true,
  });
  const allTags = new Set<string>();
  for (const row of tagRows) {
    const t = (row as any).tags;
    const parsed = typeof t === 'string' ? JSON.parse(t) : t;
    if (Array.isArray(parsed)) parsed.forEach((v: string) => allTags.add(v));
  }

  const [garmentTypeRows] = await sequelize.query(`
    SELECT DISTINCT gt.id, gt.name, gt.sort_order
    FROM garment_types gt
    JOIN catalog_products cp ON cp.garment_type_id = gt.id
    WHERE cp.show_in_store = 1 AND cp.active = 1 AND gt.active = 1
    ORDER BY gt.sort_order, gt.name
  `);

  return {
    categories:    (categories as Array<{ category: string }>).map((r) => r.category),
    genders:       (genders as Array<{ gender: string }>).map((r) => r.gender),
    sizes:         (sizes as Array<{ size_name: string }>).map((r) => r.size_name),
    tags:          [...allTags].sort(),
    clients:       (clients as Array<{ id: number; name: string; logo_url: string | null }>).map((r) => ({ id: r.id, name: r.name, logo_url: r.logo_url ?? null })),
    price_range:   { min: Number(range.min_price ?? 0), max: Number(range.max_price ?? 0) },
    garment_types: (garmentTypeRows as Array<{ id: number; name: string }>).map((r) => ({ id: r.id, name: r.name })),
  };
}

// Cacheado 60s: las opciones de filtro son una consulta pesada (varios DISTINCT)
// que cambia poco. Se invalida al crear/editar/borrar productos de catálogo.
export async function getStoreFilterOptions() {
  return cached('store:filter-options', 60_000, computeStoreFilterOptions);
}

export async function getPublicStoreSettings(): Promise<Record<string, string>> {
  // Cacheado 60s; se invalida cuando el admin guarda la configuración.
  return cached('store:settings', 60_000, async () => {
    const rows = await Settings.findAll();
    return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
  });
}

export async function getStoreProduct(id: number) {
  const product = await CatalogProduct.findOne({
    where: { id, show_in_store: true, active: true },
    include: [
      { model: CatalogProductImage, as: 'images', attributes: ['id', 'url', 'sort_order'] },
      { model: CatalogProductSize, as: 'sizes', attributes: ['id', 'size_name', 'stock_quantity', 'sort_order'] },
    ],
  });
  if (!product) throw new AppError('Producto no encontrado', 404);
  return product;
}

// ─── Cupones ────────────────────────────────────────────────────────────────

export async function validateCoupon(code: string, subtotal: number) {
  const coupon = await StoreCoupon.findOne({
    where: {
      code: code.toUpperCase().trim(),
      active: true,
      [Op.and]: [
        { [Op.or]: [{ starts_at: null }, { starts_at: { [Op.lte]: new Date() } }] },
        { [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gte]: new Date() } }] },
      ],
    },
  });

  if (!coupon) throw new AppError('Cupón inválido o expirado', 400);
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
    throw new AppError('El cupón ya fue utilizado el máximo de veces', 400);
  }
  if (coupon.min_purchase != null && subtotal < coupon.min_purchase) {
    throw new AppError(
      `El pedido mínimo para este cupón es $${Number(coupon.min_purchase).toFixed(2)}`,
      400
    );
  }

  // Descuento sin decimales (misma regla). El fixed ya viene entero, pero lo
  // redondeamos igual para blindar cualquier valor decimal cargado.
  const discount = roundPrice(
    coupon.type === 'percentage'
      ? (subtotal * Number(coupon.value)) / 100
      : Math.min(Number(coupon.value), subtotal)
  );

  return { coupon, discount };
}

// ─── Popup promocional (público) ──────────────────────────────────────────────

export async function getPromoPopupCoupon() {
  const now = new Date();
  const coupon = await StoreCoupon.findOne({
    where: {
      active: true,
      show_popup: true,
      [Op.and]: [
        { [Op.or]: [{ starts_at: null }, { starts_at: { [Op.lte]: now } }] },
        { [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gte]: now } }] },
      ],
    },
    order: [['updatedAt', 'DESC']],
  });

  if (!coupon) return null;
  // No promocionar cupones ya agotados
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return null;

  return {
    code: coupon.code,
    description: coupon.description,
    type: coupon.type,
    value: Number(coupon.value),
    min_purchase: coupon.min_purchase != null ? Number(coupon.min_purchase) : null,
    popup_image_url: coupon.popup_image_url,
    expires_at: coupon.expires_at,
  };
}

// ─── Admin: gestión de cupones ───────────────────────────────────────────────

export async function listCoupons() {
  return StoreCoupon.findAll({ order: [['createdAt', 'DESC']] });
}

export async function createCoupon(data: {
  code: string;
  description?: string;
  type: 'percentage' | 'fixed';
  value: number;
  min_purchase?: number;
  max_uses?: number;
  show_popup?: boolean;
  popup_image_url?: string | null;
  starts_at?: string;
  expires_at?: string;
}) {
  const existing = await StoreCoupon.findOne({ where: { code: data.code.toUpperCase() } });
  if (existing) throw new AppError('Ya existe un cupón con ese código', 409);

  return StoreCoupon.create({
    ...data,
    code: data.code.toUpperCase(),
    popup_image_url: data.popup_image_url ?? null,
    starts_at: data.starts_at ? new Date(data.starts_at) : null,
    expires_at: data.expires_at ? new Date(data.expires_at) : null,
  });
}

export async function updateCoupon(
  id: number,
  data: Partial<{
    code: string;
    description: string;
    type: 'percentage' | 'fixed';
    value: number;
    min_purchase: number;
    max_uses: number;
    active: boolean;
    show_popup: boolean;
    popup_image_url: string | null;
    starts_at: string;
    expires_at: string;
  }>
) {
  const coupon = await StoreCoupon.findByPk(id);
  if (!coupon) throw new AppError('Cupón no encontrado', 404);
  if (data.code) data.code = data.code.toUpperCase();
  await coupon.update({
    ...data,
    starts_at: data.starts_at ? new Date(data.starts_at) : coupon.starts_at,
    expires_at: data.expires_at ? new Date(data.expires_at) : coupon.expires_at,
  });
  return coupon;
}

export async function deleteCoupon(id: number) {
  const coupon = await StoreCoupon.findByPk(id);
  if (!coupon) throw new AppError('Cupón no encontrado', 404);
  await coupon.destroy();
}

// ─── Checkout / Pedidos ──────────────────────────────────────────────────────

export interface CartItem {
  catalog_product_id: number;
  size_name?: string;
  quantity: number;
}

export interface CheckoutInput {
  customerId?: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  items: CartItem[];
  shipping_type: 'pickup' | 'delivery';
  shipping_address?: {
    street: string;
    city: string;
    state?: string;
    zip_code?: string;
    country?: string;
  };
  coupon_code?: string;
  notes?: string;
  payment_method?: 'mercadopago' | 'cash' | 'bank_transfer';
  back_urls?: { success: string; failure: string; pending: string };
}

export async function createStoreOrder(input: CheckoutInput) {
  const STORE_URL = process.env.STORE_URL || 'http://localhost:5173/tienda';
  const BACKEND_URL = process.env.BACKEND_PUBLIC_URL || 'http://localhost:3000';

  if (!input.items || input.items.length === 0) {
    throw new AppError('El carrito está vacío', 400);
  }

  // 1. Resolver productos y verificar stock
  const productIds = [...new Set(input.items.map((i) => i.catalog_product_id))];
  const products = await CatalogProduct.findAll({
    where: { id: productIds, show_in_store: true, active: true },
    include: [{ model: CatalogProductSize, as: 'sizes' }],
  });

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Validar y construir items del pedido
  interface ResolvedItem {
    catalog_product_id: number;
    product_title: string;
    size_name: string | null;
    quantity: number;
    unit_price: number;
    subtotal: number;
    sizeRecord?: CatalogProductSize;
    productRecord: CatalogProduct;
  }

  const resolvedItems: ResolvedItem[] = [];
  let subtotal = 0;

  for (const cartItem of input.items) {
    const product = productMap.get(cartItem.catalog_product_id);
    if (!product) throw new AppError(`Producto ${cartItem.catalog_product_id} no disponible`, 400);

    const basePrice = Number(product.public_price ?? product.price);
    const disc = Number((product as any).discount_percentage ?? 0);
    // Precio a cobrar SIN decimales (regla ≤0,50 abajo / ≥0,51 arriba). Debe
    // coincidir con effectivePrice del frontend.
    const price = roundPrice(disc > 0 ? (basePrice * (100 - disc)) / 100 : basePrice);
    const sizes = (product as any).sizes as CatalogProductSize[];
    let sizeRecord: CatalogProductSize | undefined;

    if (sizes && sizes.length > 0) {
      if (!cartItem.size_name) throw new AppError(`Seleccioná un talle para ${product.title}`, 400);
      sizeRecord = sizes.find((s) => s.size_name === cartItem.size_name);
      if (!sizeRecord) throw new AppError(`Talle ${cartItem.size_name} no encontrado en ${product.title}`, 400);
      if (sizeRecord.stock_quantity < cartItem.quantity) {
        throw new AppError(`Stock insuficiente para ${product.title} — talle ${cartItem.size_name}`, 400);
      }
    } else {
      if (product.stock_quantity < cartItem.quantity) {
        throw new AppError(`Stock insuficiente para ${product.title}`, 400);
      }
    }

    const itemSubtotal = roundPrice(price * cartItem.quantity);
    subtotal += itemSubtotal;

    resolvedItems.push({
      catalog_product_id: cartItem.catalog_product_id,
      product_title: product.title,
      size_name: cartItem.size_name ?? null,
      quantity: cartItem.quantity,
      unit_price: price,
      subtotal: itemSubtotal,
      sizeRecord,
      productRecord: product,
    });
  }

  // 2. Cupón
  let discountAmount = 0;
  let couponId: number | null = null;
  let couponCode: string | null = null;
  let couponRecord: StoreCoupon | null = null;

  if (input.coupon_code) {
    const { coupon, discount } = await validateCoupon(input.coupon_code, subtotal);
    discountAmount = discount;
    couponId = coupon.id;
    couponCode = coupon.code;
    couponRecord = coupon;
  }

  // 3. Envío
  let shippingCost = 0;
  if (input.shipping_type === 'delivery') {
    const freeMin = parseFloat(await getStoreSetting('free_shipping_min')) || 0;
    const cost = roundPrice(parseFloat(await getStoreSetting('shipping_cost')) || 0);
    shippingCost = subtotal - discountAmount >= freeMin && freeMin > 0 ? 0 : cost;
  }

  const totalAmount = roundPrice(subtotal - discountAmount + shippingCost);

  // 4. Crear pedido en transacción.
  // Reintentamos si el número de pedido colisiona (dos checkouts simultáneos
  // pueden calcular el mismo ECOM-...-NNNN → viola el índice único). Solo se
  // reintenta ante UniqueConstraintError; cualquier otro error (ej. stock)
  // aborta de inmediato.
  const MAX_ORDER_ATTEMPTS = 3;
  let order: StoreOrder | undefined;

  for (let attempt = 1; attempt <= MAX_ORDER_ATTEMPTS; attempt++) {
    try {
      order = await sequelize.transaction(async (t) => {
        const orderNumber = await generateStoreOrderNumber();

        const storeOrder = await StoreOrder.create(
          {
            order_number: orderNumber,
            customer_id: input.customerId ?? null,
            customer_name: input.customerName,
            customer_email: input.customerEmail,
            customer_phone: input.customerPhone ?? null,
            status: 'pending_payment',
            tracking_token: generateTrackingToken(),
            subtotal,
            discount_amount: discountAmount,
            shipping_cost: shippingCost,
            total_amount: totalAmount,
            shipping_type: input.shipping_type,
            shipping_address: input.shipping_address ?? null,
            coupon_id: couponId,
            coupon_code: couponCode,
            payment_method: input.payment_method ?? 'mercadopago',
            notes: input.notes ?? null,
          },
          { transaction: t }
        );

        await StoreOrderItem.bulkCreate(
          resolvedItems.map((item) => ({
            store_order_id: storeOrder.id,
            catalog_product_id: item.catalog_product_id,
            product_title: item.product_title,
            size_name: item.size_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.subtotal,
          })),
          { transaction: t }
        );

        // Descontar stock de forma ATÓMICA para evitar sobreventa: el UPDATE
        // condicional (stock_quantity >= qty) solo afecta filas con stock
        // suficiente. Si afecta 0 filas, otro pedido concurrente ya lo agotó y
        // abortamos la transacción. Secuencial (no Promise.all) para no mezclar
        // sentencias en la misma conexión de la transacción.
        for (const item of resolvedItems) {
          const qty = Math.trunc(Number(item.quantity));
          const label = item.size_name
            ? `${item.product_title} — talle ${item.size_name}`
            : item.product_title;

          if (item.sizeRecord) {
            const [affected] = await CatalogProductSize.update(
              { stock_quantity: literal(`stock_quantity - ${qty}`) },
              { where: { id: item.sizeRecord.id, stock_quantity: { [Op.gte]: qty } }, transaction: t }
            );
            if (affected === 0) throw new AppError(`Stock insuficiente para ${label}`, 409);
          } else {
            const [affected] = await CatalogProduct.update(
              { stock_quantity: literal(`stock_quantity - ${qty}`) },
              { where: { id: item.productRecord.id, stock_quantity: { [Op.gte]: qty } }, transaction: t }
            );
            if (affected === 0) throw new AppError(`Stock insuficiente para ${label}`, 409);
          }
        }

        // Incrementar uso del cupón de forma ATÓMICA: solo si aún no alcanzó
        // max_uses (o es ilimitado). Si afecta 0 filas, otro pedido concurrente
        // lo agotó → abortamos para no exceder el límite.
        if (couponRecord) {
          const [affected] = await StoreCoupon.update(
            { used_count: literal('used_count + 1') },
            {
              where: {
                id: couponRecord.id,
                [Op.or]: [
                  { max_uses: null },
                  { used_count: { [Op.lt]: col('max_uses') } },
                ],
              },
              transaction: t,
            }
          );
          if (affected === 0) throw new AppError('El cupón ya no está disponible', 409);
        }

        return storeOrder;
      });
      break; // éxito
    } catch (err) {
      if (err instanceof UniqueConstraintError && attempt < MAX_ORDER_ATTEMPTS) {
        continue; // colisión de order_number → regenerar y reintentar
      }
      throw err;
    }
  }

  if (!order) throw new AppError('No se pudo generar el pedido. Intentá nuevamente.', 500);

  // Notificar al sistema (admin/billing) que entró un pedido nuevo desde la
  // tienda, para cualquier método de pago. Fire-and-forget: nunca corta el
  // checkout ni el pago del cliente.
  emitStoreOrderCreatedEvent(order);

  // 5. Generar preference de MercadoPago solo si el método es MP
  let mpInitPoint: string | null = null;
  let mpSandboxInitPoint: string | null = null;

  const paymentMethod = input.payment_method ?? 'mercadopago';

  if (paymentMethod === 'mercadopago') {
    // Incluimos el order_number en las back_urls para reconciliar el pago al volver
    const ref = encodeURIComponent(order.order_number);
    const backUrls = input.back_urls ?? {
      success: `${STORE_URL}/checkout/exito?order=${ref}`,
      failure: `${STORE_URL}/checkout/fallo?order=${ref}`,
      pending: `${STORE_URL}/checkout/pendiente?order=${ref}`,
    };

    const mpResult = await createPreference({
      externalReference: order.order_number,
      items: resolvedItems.map((i) => ({
        id: String(i.catalog_product_id),
        title: i.size_name ? `${i.product_title} — Talle ${i.size_name}` : i.product_title,
        quantity: i.quantity,
        unit_price: i.unit_price,
        currency_id: 'ARS',
      })),
      totalAmount,
      paymentType: 'full',
      overrideAmount: totalAmount,
      backUrls,
      notificationUrl: `${BACKEND_URL}/api/v1/store/webhook/mp`,
      // MP rechaza auto_return con back_urls http (localhost). Solo en producción (https).
      autoReturn: backUrls.success.startsWith('https://'),
    });

    await order.update({ mp_preference_id: mpResult.preference_id });
    mpInitPoint = mpResult.init_point ?? null;
    mpSandboxInitPoint = mpResult.sandbox_init_point ?? null;
  }

  // 6. Email de confirmación
  try {
    await sendOrderConfirmationEmail(
      input.customerEmail,
      input.customerName,
      order.order_number,
      resolvedItems.map((i) => ({
        title: i.size_name ? `${i.product_title} (${i.size_name})` : i.product_title,
        qty: i.quantity,
        price: i.subtotal,
      })),
      totalAmount
    );
  } catch {
    // El email falla silenciosamente — el pedido ya fue creado
  }

  return {
    order,
    payment_method: paymentMethod,
    mp_init_point: mpInitPoint,
    mp_sandbox_init_point: mpSandboxInitPoint,
  };
}

// ─── Comprobante de pago (transferencia bancaria) ────────────────────────────

export async function savePaymentProof(
  orderNumber: string,
  customerEmail: string,
  proofUrl: string,
  publicId?: string | null
) {
  const order = await StoreOrder.findOne({ where: { order_number: orderNumber } });
  if (!order) throw new AppError('Pedido no encontrado', 404);

  if (order.customer_email.toLowerCase() !== customerEmail.toLowerCase()) {
    throw new AppError('Sin autorización para este pedido', 403);
  }
  if (order.payment_method !== 'bank_transfer') {
    throw new AppError('Este pedido no usa transferencia bancaria', 400);
  }
  if (order.payment_proof_url && order.payment_proof_url_2) {
    throw new AppError('Ya se subieron los dos comprobantes permitidos para este pedido', 400);
  }

  if (!order.payment_proof_url) {
    await order.update({ payment_proof_url: proofUrl, payment_proof_public_id: publicId ?? null });
  } else {
    await order.update({ payment_proof_url_2: proofUrl, payment_proof_public_id_2: publicId ?? null });
  }
  return order;
}

// ─── Reconciliación de pago (compartida por webhook y retorno del cliente) ────

function mapMpStatusToOrderStatus(mpStatus: string, current: StoreOrderStatus): StoreOrderStatus {
  if (mpStatus === 'approved') return 'paid';
  if (mpStatus === 'pending' || mpStatus === 'in_process' || mpStatus === 'authorized') return 'pending_payment';
  if (mpStatus === 'rejected' || mpStatus === 'cancelled' || mpStatus === 'refunded' || mpStatus === 'charged_back') return 'cancelled';
  return current;
}

function emitStorePaymentEvent(order: StoreOrder): void {
  try {
    getIO().emit('notification:store_payment', {
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.customer_name,
      status: order.status,
      mp_status: order.mp_status,
      total: Number(order.total_amount),
    });
  } catch { /* socket puede no estar inicializado en tests */ }
}

function emitStoreOrderCreatedEvent(order: StoreOrder): void {
  try {
    getIO().emit('notification:store_order_created', {
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.customer_name,
      paymentMethod: order.payment_method,
      total: Number(order.total_amount),
    });
  } catch { /* socket puede no estar inicializado en tests */ }
}

// ─── Cambio de estado (transición + historial + mail) ────────────────────────

export interface StatusChangeOptions {
  /** Admin/billing que hizo el cambio. null = cambio automático del sistema. */
  changedBy?: number | null;
  note?: string | null;
  tracking?: { tracking_number?: string | null; courier_name?: string | null };
  /** false = no valida la transición (flujo de pago automático del webhook). */
  enforceTransition?: boolean;
}

/**
 * Punto único para cambiar el estado de un pedido de la tienda. Valida la
 * transición, actualiza datos de despacho, escribe el historial (traza inmutable)
 * y encola el mail al comprador — todo de forma idempotente:
 *
 *  - Si el estado NO cambia realmente, no escribe historial ni envía mail
 *    (evita duplicados entre webhook y retorno del cliente).
 *  - El mail se ENCOLA (desacoplado): si falla, el cambio ya quedó persistido y
 *    el envío se reintenta/loguea sin cortar la operación.
 */
export async function recordStoreOrderStatusChange(
  order: StoreOrder,
  newStatus: StoreOrderStatus,
  options: StatusChangeOptions = {}
): Promise<{ changed: boolean; emailQueued: boolean }> {
  const prevStatus = order.status as StoreOrderStatus;
  const tracking = options.tracking ?? {};
  const statusChanged = newStatus !== prevStatus;

  // Validar transición (salvo el flujo de pago automático)
  if (statusChanged && options.enforceTransition !== false) {
    if (!isValidStoreTransition(prevStatus, newStatus)) {
      throw new AppError(
        `No se puede pasar el pedido de "${STORE_STATUS_LABELS[prevStatus]}" a "${STORE_STATUS_LABELS[newStatus]}"`,
        409
      );
    }
  }

  // Datos de despacho (mergeados con lo ya cargado)
  const mergedCourier = tracking.courier_name !== undefined ? tracking.courier_name : order.courier_name;
  const mergedTracking = tracking.tracking_number !== undefined ? tracking.tracking_number : order.tracking_number;
  if (statusChanged && statusRequiresShipping(newStatus) && (!mergedCourier || !mergedTracking)) {
    throw new AppError('Para marcar "En camino" cargá el transportista y el N° de seguimiento', 400);
  }

  // Vencimiento del token al entregar (se calcula fuera de la transacción)
  let deliveredExpiry: Date | null | undefined;
  if (statusChanged && newStatus === 'delivered') {
    const days = await getTrackingExpiryDays();
    deliveredExpiry = new Date(Date.now() + days * 86_400_000);
  }

  const token = order.tracking_token ?? generateTrackingToken();

  await sequelize.transaction(async (t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {
      courier_name: mergedCourier ?? null,
      tracking_number: mergedTracking ?? null,
      tracking_token: token,
    };
    if (statusChanged) {
      updates.status = newStatus;
      if (deliveredExpiry !== undefined) updates.tracking_token_expires_at = deliveredExpiry;
    }
    await order.update(updates, { transaction: t });

    if (statusChanged) {
      await StoreOrderStatusHistory.create(
        {
          store_order_id: order.id,
          previous_status: prevStatus,
          new_status: newStatus,
          note: options.note ?? null,
          changed_by: options.changedBy ?? null,
        },
        { transaction: t }
      );
    }
  });

  // Encolar mail (desacoplado del guardado) solo si el estado notifica
  const emailQueued = statusChanged && statusNotifiesCustomer(newStatus);
  if (emailQueued) {
    const payload = {
      email: order.customer_email,
      name: order.customer_name,
      orderNumber: order.order_number,
      status: newStatus,
      courierName: order.courier_name,
      trackingNumber: order.tracking_number,
      trackingUrl: buildTrackingUrl(token),
    };
    enqueueEmail(
      `store_order_status:${order.order_number}:${newStatus}`,
      () => sendStoreOrderStatusEmail(payload)
    );
  }

  return { changed: statusChanged, emailQueued };
}

// ─── Vista de seguimiento (solo lectura, sin datos internos) ──────────────────

export interface TrackingTimelineEntry {
  status: StoreOrderStatus;
  status_label: string;
  at: Date;
}

export interface TrackingView {
  order_number: string;
  status: StoreOrderStatus;
  status_label: string;
  shipping_type: 'pickup' | 'delivery';
  courier_name: string | null;
  tracking_number: string | null;
  created_at: Date;
  timeline: TrackingTimelineEntry[];
  items: { product_title: string; size_name: string | null; quantity: number }[];
}

/**
 * Serializa un pedido a la vista pública de seguimiento. Expone SOLO lo necesario
 * para que el comprador siga su pedido: nunca montos, notas internas, email/teléfono,
 * comprobantes de pago ni el token.
 */
function buildTrackingView(order: StoreOrder): TrackingView {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = ((order as any).status_history as StoreOrderStatusHistory[] | undefined) ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = ((order as any).items as StoreOrderItem[] | undefined) ?? [];

  const sorted = [...history].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // La línea de tiempo arranca en la creación (pending_payment) y suma cada cambio.
  // NO se incluye `note`: son notas internas de administración, no deben filtrarse
  // al comprador (vista pública y logueada comparten este serializer).
  const timeline: TrackingTimelineEntry[] = [
    {
      status: 'pending_payment',
      status_label: STORE_STATUS_LABELS.pending_payment,
      at: order.createdAt,
    },
    ...sorted.map((h) => ({
      status: h.new_status,
      status_label: STORE_STATUS_LABELS[h.new_status],
      at: h.createdAt,
    })),
  ];

  const status = order.status as StoreOrderStatus;
  return {
    order_number: order.order_number,
    status,
    status_label: STORE_STATUS_LABELS[status],
    shipping_type: order.shipping_type,
    courier_name: order.courier_name ?? null,
    tracking_number: order.tracking_number ?? null,
    created_at: order.createdAt,
    timeline,
    items: items.map((i) => ({
      product_title: i.product_title,
      size_name: i.size_name ?? null,
      quantity: Number(i.quantity),
    })),
  };
}

const TRACKING_INCLUDES = [
  { model: StoreOrderItem, as: 'items', attributes: ['product_title', 'size_name', 'quantity'] },
  // `note` NO se trae: es interna de administración (no debe filtrarse al comprador).
  { model: StoreOrderStatusHistory, as: 'status_history', attributes: ['previous_status', 'new_status', 'createdAt'] },
];

/** Seguimiento público por token opaco. 404 si no existe, 410 si venció. */
export async function getStoreOrderTrackingByToken(token: string): Promise<TrackingView> {
  const order = await StoreOrder.findOne({ where: { tracking_token: token }, include: TRACKING_INCLUDES });
  if (!order) throw new AppError('Seguimiento no encontrado', 404);

  if (order.tracking_token_expires_at && order.tracking_token_expires_at.getTime() < Date.now()) {
    throw new AppError('El enlace de seguimiento expiró', 410, undefined, { type: 'TrackingLinkExpired' });
  }
  return buildTrackingView(order);
}

/** Seguimiento para el dueño logueado (no afectado por el vencimiento del token). */
export async function getStoreOrderTrackingForCustomer(orderNumber: string, customerId: number): Promise<TrackingView> {
  const customer = await StoreCustomer.findByPk(customerId);
  if (!customer) throw new AppError('Cliente no encontrado', 404);

  const order = await StoreOrder.findOne({
    where: {
      order_number: orderNumber,
      [Op.or]: [
        { customer_id: customerId },
        { customer_id: null, customer_email: customer.email },
      ],
    },
    include: TRACKING_INCLUDES,
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  return buildTrackingView(order);
}

/** Regenera el token de seguimiento (admin). Renueva el vencimiento si ya fue entregado. */
export async function regenerateTrackingToken(id: number): Promise<StoreOrder> {
  const order = await StoreOrder.findByPk(id);
  if (!order) throw new AppError('Pedido no encontrado', 404);
  const token = generateTrackingToken();
  const expires = order.status === 'delivered'
    ? new Date(Date.now() + (await getTrackingExpiryDays()) * 86_400_000)
    : order.tracking_token_expires_at;
  await order.update({ tracking_token: token, tracking_token_expires_at: expires });
  return order;
}

/**
 * Aplica el resultado de un pago a un pedido. Idempotente: la transición de estado
 * (y su mail/historial) solo ocurre cuando el estado realmente cambia.
 */
async function applyPaymentResult(
  order: StoreOrder,
  mpStatus: string,
  paymentId: string | null
): Promise<StoreOrder> {
  const newStatus = mapMpStatusToOrderStatus(mpStatus, order.status);

  // Actualizar los campos de MercadoPago siempre (aunque el estado no cambie)
  await order.update({
    mp_payment_id: paymentId ? String(paymentId) : order.mp_payment_id,
    mp_status: mpStatus,
  });

  // Transición de estado (sistema): historial + mail por estado, sin validar
  // transición porque el flujo de pago puede saltar estados.
  const { changed } = await recordStoreOrderStatusChange(order, newStatus, {
    enforceTransition: false,
    note: `Pago MercadoPago: ${mpStatus}`,
  });

  if (changed) emitStorePaymentEvent(order);

  return order;
}

// ─── Webhook MercadoPago (server-to-server) ──────────────────────────────────

export async function handleStoreWebhook(paymentId: string) {
  const info = await getPaymentInfo(paymentId);
  const ref = info.external_reference;
  if (!ref || !ref.startsWith('ECOM-')) return;

  const order = await StoreOrder.findOne({ where: { order_number: ref } });
  if (!order) return;

  await applyPaymentResult(order, info.status ?? 'unknown', paymentId);
}

// ─── Confirmación al volver el cliente desde MercadoPago ──────────────────────
// Necesario en desarrollo/local donde MP no puede alcanzar el webhook (localhost).

export async function confirmStorePayment(params: {
  paymentId?: string | null;
  orderNumber?: string | null;
}): Promise<{ order_number: string; status: StoreOrderStatus; mp_status: string | null }> {
  let order: StoreOrder | null = null;
  let mpStatus: string | null = null;
  let paymentId: string | null = params.paymentId ?? null;

  if (paymentId) {
    // La consulta a MP puede fallar (id inválido, desfase test/prod, error transitorio).
    try {
      const info = await getPaymentInfo(paymentId);
      mpStatus = info.status ?? null;
      const ref = info.external_reference;
      if (ref) order = await StoreOrder.findOne({ where: { order_number: ref } });
    } catch {
      mpStatus = null;
    }
  }

  // Fallback: ubicar el pedido por número aunque no tengamos payment_id válido
  if (!order && params.orderNumber) {
    order = await StoreOrder.findOne({ where: { order_number: params.orderNumber } });
  }

  if (!order) throw new AppError('Pedido no encontrado', 404);

  // Si aún no tenemos mpStatus, buscar el pago en MP por external_reference.
  // Necesario en dev/local donde el webhook no llega y la back_url http no
  // hace auto_return, por lo que el frontend llama con solo el número de pedido.
  if (!mpStatus) {
    try {
      const payments = await searchPaymentsByReference(order.order_number);
      const latest = payments[0];
      if (latest) {
        mpStatus = latest.status ?? null;
        if (!paymentId && latest.id) paymentId = String(latest.id);
      }
    } catch { /* no crítico */ }
  }

  if (mpStatus) {
    await applyPaymentResult(order, mpStatus, paymentId);
    // Recargar para devolver el estado actualizado
    await order.reload();
  }

  return { order_number: order.order_number, status: order.status, mp_status: order.mp_status };
}

export async function getStoreOrderStatusByNumber(orderNumber: string) {
  const order = await StoreOrder.findOne({
    where: { order_number: orderNumber },
    attributes: ['order_number', 'status', 'mp_status'],
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  // Endpoint público y los N° de pedido son secuenciales/adivinables: NO
  // devolver montos ni PII. Solo lo mínimo para el polling de pago y el chatbot.
  return {
    order_number: order.order_number,
    status: order.status,
    mp_status: order.mp_status,
  };
}

// ─── Admin: listado y detalle de pedidos tienda ──────────────────────────────

export async function listStoreOrders(filters: {
  status?: string;
  customer_id?: number;
  /** Incluye también pedidos de invitado (customer_id IS NULL) con este email */
  customer_email?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;

  if (filters.date_from || filters.date_to) {
    const dateRange: Record<string, Date> = {};
    if (filters.date_from) dateRange[Op.gte as unknown as string] = new Date(filters.date_from);
    if (filters.date_to) {
      const end = new Date(filters.date_to);
      end.setHours(23, 59, 59, 999);
      dateRange[Op.lte as unknown as string] = end;
    }
    where.createdAt = dateRange;
  }

  // Filtro de cliente: por ID propio O por email como invitado
  if (filters.customer_id && filters.customer_email) {
    where[Op.or as unknown as string] = [
      { customer_id: filters.customer_id },
      { customer_id: null, customer_email: filters.customer_email },
    ];
  } else if (filters.customer_id) {
    where.customer_id = filters.customer_id;
  } else if (filters.customer_email) {
    where.customer_id = null;
    where.customer_email = filters.customer_email;
  }

  if (filters.search) {
    where[Op.or as unknown as string] = [
      { order_number: { [Op.like]: `%${filters.search}%` } },
      { customer_name: { [Op.like]: `%${filters.search}%` } },
      { customer_email: { [Op.like]: `%${filters.search}%` } },
    ];
  }

  const { count, rows } = await StoreOrder.findAndCountAll({
    where,
    include: [
      {
        model: StoreOrderItem,
        as: 'items',
        include: [
          { model: CatalogProduct, as: 'product', attributes: ['id', 'title', 'public_price', 'price'] },
        ],
      },
      { model: StoreCustomer, as: 'customer', attributes: ['id', 'name', 'email', 'phone'] },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  const data = rows.map((r) => signPaymentProofs(r.toJSON()));
  return { data, meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) } };
}

export async function getStoreOrderById(id: number) {
  const order = await StoreOrder.findByPk(id, {
    include: [
      {
        model: StoreOrderItem,
        as: 'items',
        include: [
          {
            model: CatalogProduct,
            as: 'product',
            attributes: ['id', 'title'],
            include: [{ model: CatalogProductImage, as: 'images', attributes: ['url', 'sort_order'], limit: 1 }],
          },
        ],
      },
      { model: StoreCustomer, as: 'customer', attributes: ['id', 'name', 'email', 'phone'] },
      {
        model: StoreOrderStatusHistory,
        as: 'status_history',
        attributes: ['id', 'previous_status', 'new_status', 'note', 'changed_by', 'createdAt'],
        include: [{ model: User, as: 'changer', attributes: ['id', 'name'] }],
      },
    ],
    order: [[{ model: StoreOrderStatusHistory, as: 'status_history' }, 'createdAt', 'ASC']],
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  return order;
}

/**
 * Cambia el estado de un pedido desde administración: valida la transición, escribe
 * el historial (con el admin que lo hizo) y encola el mail al comprador. Devuelve
 * el pedido recargado (con historial) y si se encoló un mail (para el feedback UX).
 */
export async function updateStoreOrderStatus(
  id: number,
  status: StoreOrderStatus,
  tracking?: { tracking_number?: string | null; courier_name?: string | null },
  changedBy?: number | null,
  note?: string | null
): Promise<{ order: StoreOrder; emailQueued: boolean }> {
  const order = await StoreOrder.findByPk(id);
  if (!order) throw new AppError('Pedido no encontrado', 404);

  const { emailQueued } = await recordStoreOrderStatusChange(order, status, {
    changedBy: changedBy ?? null,
    note: note ?? null,
    tracking,
  });

  const fresh = await getStoreOrderById(id);
  return { order: fresh, emailQueued };
}

/** Corrección de datos de despacho sin cambiar el estado (no dispara mail). */
export async function updateStoreOrderTracking(
  id: number,
  data: { tracking_number?: string | null; courier_name?: string | null }
) {
  const order = await StoreOrder.findByPk(id);
  if (!order) throw new AppError('Pedido no encontrado', 404);
  await order.update(data);
  return order;
}

// ─── Comprobante de compra (PDF) ────────────────────────────────────────────────

async function buildInvoiceData(orderId: number) {
  const order = await getStoreOrderById(orderId);
  const items = (order as any).items as StoreOrderItem[];
  const settings = await getAllSettings();
  return {
    order,
    invoiceData: {
      settings,
      orderId: order.id,
      orderNumber: order.order_number,
      createdAt: order.createdAt as Date,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      customerPhone: order.customer_phone,
      shippingType: order.shipping_type ?? 'pickup',
      shippingAddress: order.shipping_address,
      couponCode: order.coupon_code,
      items: items.map((i) => ({
        product_title: i.product_title,
        size_name: i.size_name,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        subtotal: Number(i.subtotal),
      })),
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discount_amount),
      shippingCost: Number(order.shipping_cost),
      totalAmount: Number(order.total_amount),
      trackingNumber: order.tracking_number,
      courierName: order.courier_name,
    },
  };
}

export async function getStoreOrderInvoicePdfBuffer(orderId: number): Promise<{ buffer: Buffer; orderNumber: string }> {
  const { order, invoiceData } = await buildInvoiceData(orderId);
  const buffer = await generateInvoicePdf(invoiceData);
  return { buffer, orderNumber: order.order_number };
}

/** Verifica que el pedido pertenezca al cliente (por customer_id o email invitado). */
export async function getStoreOrderByNumberForCustomer(orderNumber: string, customerId: number): Promise<StoreOrder> {
  const customer = await StoreCustomer.findByPk(customerId);
  if (!customer) throw new AppError('Cliente no encontrado', 404);

  const order = await StoreOrder.findOne({
    where: {
      order_number: orderNumber,
      [Op.or]: [
        { customer_id: customerId },
        { customer_id: null, customer_email: customer.email },
      ],
    },
    include: [{ model: StoreOrderItem, as: 'items' }],
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  return order;
}

export async function sendStoreOrderInvoiceEmail(orderId: number): Promise<void> {
  const { invoiceData } = await buildInvoiceData(orderId);
  await sendOrderInvoiceEmail(invoiceData);
}

// ─── Métricas del ecommerce ──────────────────────────────────────────────────

export async function getStoreMetrics(period?: string) {
  const now = new Date();
  let from: Date;
  let to: Date = now;

  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 0, 23, 59, 59, 999);
  } else if (period && /^\d{4}$/.test(period)) {
    const y = Number(period);
    from = new Date(y, 0, 1);
    to = new Date(y, 11, 31, 23, 59, 59, 999);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const paidOrders = await StoreOrder.findAll({
    where: { status: ['paid', 'processing', 'shipped', 'delivered'], createdAt: { [Op.between]: [from, to] } },
    include: [{ model: StoreOrderItem, as: 'items' }],
  });

  const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
  const totalOrders = paidOrders.length;
  const totalShipping = paidOrders.reduce((sum, o) => sum + Number(o.shipping_cost), 0);
  const totalDiscounts = paidOrders.reduce((sum, o) => sum + Number(o.discount_amount), 0);

  const statusCounts = await StoreOrder.findAll({
    where: { createdAt: { [Op.between]: [from, to] } },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });

  const topProducts: Record<string, { title: string; qty: number; revenue: number }> = {};
  for (const order of paidOrders) {
    for (const item of (order as any).items as StoreOrderItem[]) {
      const k = String(item.catalog_product_id);
      if (!topProducts[k]) topProducts[k] = { title: item.product_title, qty: 0, revenue: 0 };
      topProducts[k].qty += item.quantity;
      topProducts[k].revenue += Number(item.subtotal);
    }
  }

  const top = Object.entries(topProducts)
    .map(([id, v]) => ({ product_id: Number(id), ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    period_from: from.toISOString().slice(0, 10),
    period_to: to.toISOString().slice(0, 10),
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    total_shipping: totalShipping,
    total_discounts: totalDiscounts,
    avg_order: totalOrders > 0 ? parseFloat((totalRevenue / totalOrders).toFixed(2)) : 0,
    by_status: statusCounts,
    top_products: top,
  };
}
