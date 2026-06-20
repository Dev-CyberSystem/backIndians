import { Op } from 'sequelize';
import { sequelize } from '../config/db';
import {
  CatalogProduct,
  CatalogProductImage,
  CatalogProductSize,
  StoreOrder,
  StoreOrderItem,
  StoreCoupon,
  StoreCustomer,
  Settings,
} from '../models';
import { Client } from '../models/Client';
import { AppError } from '../middlewares/errorHandler';
import { createPreference, getPaymentInfo } from './mercadopago.service';
import { sendOrderConfirmationEmail } from '../utils/email.service';
import { StoreOrderStatus } from '../models/StoreOrder';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getStoreSetting(key: string): Promise<string> {
  const row = await Settings.findOne({ where: { key } });
  return row?.value ?? '';
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

  const { count, rows } = await CatalogProduct.findAndCountAll({
    where,
    include: [
      { model: CatalogProductImage, as: 'images', attributes: ['id', 'url', 'sort_order'] },
      { model: CatalogProductSize,  as: 'sizes',  attributes: ['id', 'size_name', 'stock_quantity', 'sort_order'] },
      { model: Client,              as: 'client', attributes: ['id', 'name'] },
    ],
    order,
    limit,
    offset,
    distinct: true,
  });

  return {
    data: rows,
    meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) },
  };
}

export async function getStoreFilterOptions() {
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
    SELECT DISTINCT cps.size_name
    FROM catalog_product_sizes cps
    JOIN catalog_products cp ON cp.id = cps.product_id
    WHERE cp.show_in_store = 1 AND cp.active = 1 AND cps.stock_quantity > 0
    ORDER BY cps.sort_order, cps.size_name
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

  return {
    categories: (categories as Array<{ category: string }>).map((r) => r.category),
    genders:    (genders as Array<{ gender: string }>).map((r) => r.gender),
    sizes:      (sizes as Array<{ size_name: string }>).map((r) => r.size_name),
    clients:    (clients as Array<{ id: number; name: string; logo_url: string | null }>).map((r) => ({ id: r.id, name: r.name, logo_url: r.logo_url ?? null })),
    price_range: { min: Number(range.min_price ?? 0), max: Number(range.max_price ?? 0) },
  };
}

export async function getPublicStoreSettings(): Promise<Record<string, string>> {
  const rows = await Settings.findAll();
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
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

  const discount =
    coupon.type === 'percentage'
      ? parseFloat(((subtotal * Number(coupon.value)) / 100).toFixed(2))
      : Math.min(Number(coupon.value), subtotal);

  return { coupon, discount };
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
  starts_at?: string;
  expires_at?: string;
}) {
  const existing = await StoreCoupon.findOne({ where: { code: data.code.toUpperCase() } });
  if (existing) throw new AppError('Ya existe un cupón con ese código', 409);

  return StoreCoupon.create({
    ...data,
    code: data.code.toUpperCase(),
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
  back_urls?: { success: string; failure: string; pending: string };
}

export async function createStoreOrder(input: CheckoutInput) {
  const STORE_URL = process.env.STORE_URL || 'http://localhost:5173/tienda';

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

    const price = Number(product.public_price ?? product.price);
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

    const itemSubtotal = parseFloat((price * cartItem.quantity).toFixed(2));
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
    const cost = parseFloat(await getStoreSetting('shipping_cost')) || 0;
    shippingCost = subtotal - discountAmount >= freeMin && freeMin > 0 ? 0 : cost;
  }

  const totalAmount = parseFloat((subtotal - discountAmount + shippingCost).toFixed(2));

  // 4. Crear pedido en transacción
  const order = await sequelize.transaction(async (t) => {
    const orderNumber = await generateStoreOrderNumber();

    const storeOrder = await StoreOrder.create(
      {
        order_number: orderNumber,
        customer_id: input.customerId ?? null,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone ?? null,
        status: 'pending_payment',
        subtotal,
        discount_amount: discountAmount,
        shipping_cost: shippingCost,
        total_amount: totalAmount,
        shipping_type: input.shipping_type,
        shipping_address: input.shipping_address ?? null,
        coupon_id: couponId,
        coupon_code: couponCode,
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

    // Descontar stock
    await Promise.all(
      resolvedItems.map(async (item) => {
        if (item.sizeRecord) {
          await item.sizeRecord.decrement('stock_quantity', {
            by: item.quantity,
            transaction: t,
          });
        } else {
          await item.productRecord.decrement('stock_quantity', {
            by: item.quantity,
            transaction: t,
          });
        }
      })
    );

    // Incrementar uso del cupón
    if (couponRecord) {
      await couponRecord.increment('used_count', { transaction: t });
    }

    return storeOrder;
  });

  // 5. Generar preference de MercadoPago
  const backUrls = input.back_urls ?? {
    success: `${STORE_URL}/checkout/exito`,
    failure: `${STORE_URL}/checkout/fallo`,
    pending: `${STORE_URL}/checkout/pendiente`,
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
  });

  await order.update({
    mp_preference_id: mpResult.preference_id,
  });

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
    mp_init_point: mpResult.init_point,
    mp_sandbox_init_point: mpResult.sandbox_init_point,
  };
}

// ─── Webhook MercadoPago (tienda) ────────────────────────────────────────────

export async function handleStoreWebhook(paymentId: string) {
  const info = await getPaymentInfo(paymentId);
  const ref = info.external_reference;
  if (!ref || !ref.startsWith('ECOM-')) return;

  const order = await StoreOrder.findOne({ where: { order_number: ref } });
  if (!order) return;

  const mpStatus = info.status ?? 'unknown';
  let newStatus = order.status;

  if (mpStatus === 'approved') newStatus = 'paid';
  else if (mpStatus === 'pending' || mpStatus === 'in_process') newStatus = 'pending_payment';
  else if (mpStatus === 'rejected' || mpStatus === 'cancelled') newStatus = 'cancelled';

  await order.update({ mp_payment_id: String(paymentId), mp_status: mpStatus, status: newStatus });
}

// ─── Admin: listado y detalle de pedidos tienda ──────────────────────────────

export async function listStoreOrders(filters: {
  status?: string;
  customer_id?: number;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.customer_id) where.customer_id = filters.customer_id;
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

  return { data: rows, meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) } };
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
    ],
  });
  if (!order) throw new AppError('Pedido no encontrado', 404);
  return order;
}

export async function updateStoreOrderStatus(id: number, status: StoreOrderStatus) {
  const order = await StoreOrder.findByPk(id);
  if (!order) throw new AppError('Pedido no encontrado', 404);
  await order.update({ status });
  return order;
}

// ─── Métricas del ecommerce ──────────────────────────────────────────────────

export async function getStoreMetrics(period?: string) {
  const now = new Date();
  let from: Date;
  let to: Date = now;

  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 0, 23, 59, 59);
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
