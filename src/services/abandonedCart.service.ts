import { Op, fn, col } from 'sequelize';
import { StoreEvent } from '../models/StoreEvent';
import { StoreCartReminder } from '../models/StoreCartReminder';
import { StoreCustomer } from '../models/StoreCustomer';
import { CatalogProduct } from '../models/CatalogProduct';
import { CatalogProductImage } from '../models/CatalogProductImage';
import { AppError } from '../middlewares/errorHandler';
import { sendAbandonedCartEmail } from '../utils/email.service';

// Ventana de análisis y "edad mínima" para considerar un carrito abandonado
// (no queremos mailear a alguien que está comprando ahora mismo).
const LOOKBACK_DAYS = 30;
const MIN_AGE_MINUTES = 180; // 3 horas

export interface AbandonedCartProduct {
  id: number;
  title: string;
  price: number;
  image: string | null;
}

export interface AbandonedCart {
  customer: { id: number; name: string; email: string };
  last_activity: string;
  products: AbandonedCartProduct[];
  reminded_before: boolean;
}

// Precio efectivo (mismo criterio que la tienda: público con descuento aplicado).
function effectivePrice(p: CatalogProduct): number {
  const base = Number((p as any).public_price ?? p.price);
  const disc = Number((p as any).discount_percentage ?? 0);
  return disc > 0 ? parseFloat((base * (100 - disc) / 100).toFixed(2)) : base;
}

interface CustomerCart {
  productIds: Set<number>;
  lastAdd: Date;
}

/**
 * Reconstruye, por cliente logueado, los productos que agregó al carrito y NO
 * compró (en la ventana), con la última fecha de actividad. Núcleo compartido
 * por el listado y el envío de emails.
 */
async function computeCustomerCarts(customerId?: number): Promise<Map<number, CustomerCart>> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const baseWhere: Record<string, unknown> = {
    customer_id: customerId != null ? customerId : { [Op.not]: null },
    product_id: { [Op.not]: null },
    createdAt: { [Op.gte]: since },
  };

  // Último cart_add por (cliente, producto)
  const adds = (await StoreEvent.findAll({
    attributes: ['customer_id', 'product_id', [fn('MAX', col('createdAt')), 'last_add']],
    where: { ...baseWhere, event_type: 'cart_add' },
    group: ['customer_id', 'product_id'],
    raw: true,
  })) as unknown as Array<{ customer_id: number; product_id: number; last_add: string }>;

  if (adds.length === 0) return new Map();

  // Última compra por (cliente, producto) para excluir lo ya comprado
  const purchases = (await StoreEvent.findAll({
    attributes: ['customer_id', 'product_id', [fn('MAX', col('createdAt')), 'last_purchase']],
    where: { ...baseWhere, event_type: 'purchase' },
    group: ['customer_id', 'product_id'],
    raw: true,
  })) as unknown as Array<{ customer_id: number; product_id: number; last_purchase: string }>;

  const purchasedAt = new Map<string, Date>();
  for (const p of purchases) purchasedAt.set(`${p.customer_id}:${p.product_id}`, new Date(p.last_purchase));

  const byCustomer = new Map<number, CustomerCart>();
  for (const a of adds) {
    const lastAdd = new Date(a.last_add);
    const purchased = purchasedAt.get(`${a.customer_id}:${a.product_id}`);
    if (purchased && purchased >= lastAdd) continue; // ya lo compró después de agregarlo
    const entry = byCustomer.get(a.customer_id) ?? { productIds: new Set<number>(), lastAdd: new Date(0) };
    entry.productIds.add(a.product_id);
    if (lastAdd > entry.lastAdd) entry.lastAdd = lastAdd;
    byCustomer.set(a.customer_id, entry);
  }
  return byCustomer;
}

async function resolveProducts(productIds: number[]): Promise<Map<number, AbandonedCartProduct>> {
  if (productIds.length === 0) return new Map();
  const products = await CatalogProduct.findAll({
    where: { id: { [Op.in]: productIds } },
    attributes: ['id', 'title', 'price', 'public_price', 'discount_percentage'],
    include: [{ model: CatalogProductImage, as: 'images', attributes: ['url', 'sort_order'], limit: 1 }],
  });
  return new Map(
    products.map((p) => [
      p.id,
      { id: p.id, title: p.title, price: effectivePrice(p), image: (p as any).images?.[0]?.url ?? null },
    ])
  );
}

/** Listado de carritos abandonados accionables (excluye los ya recordados). */
export async function getAbandonedCarts(): Promise<AbandonedCart[]> {
  const maxLastAdd = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000);
  const carts = await computeCustomerCarts();

  const candidates = [...carts.entries()].filter(
    ([, v]) => v.productIds.size > 0 && v.lastAdd <= maxLastAdd
  );
  if (candidates.length === 0) return [];

  const customerIds = candidates.map(([id]) => id);

  // Último recordatorio por cliente (para el dedup y el flag informativo)
  const reminders = (await StoreCartReminder.findAll({
    attributes: ['customer_id', [fn('MAX', col('sent_at')), 'last_sent']],
    where: { customer_id: { [Op.in]: customerIds } },
    group: ['customer_id'],
    raw: true,
  })) as unknown as Array<{ customer_id: number; last_sent: string }>;
  const lastReminder = new Map<number, Date>();
  for (const r of reminders) lastReminder.set(r.customer_id, new Date(r.last_sent));

  const customers = await StoreCustomer.findAll({
    where: { id: { [Op.in]: customerIds }, active: true },
    attributes: ['id', 'name', 'email'],
  });
  const customerMap = new Map(customers.map((c) => [c.id, c]));

  const productMap = await resolveProducts([
    ...new Set(candidates.flatMap(([, v]) => [...v.productIds])),
  ]);

  const result: AbandonedCart[] = [];
  for (const [customerId, v] of candidates) {
    const customer = customerMap.get(customerId);
    if (!customer) continue; // cuenta inactiva o borrada

    const reminded = lastReminder.get(customerId);
    if (reminded && reminded >= v.lastAdd) continue; // este carrito ya fue recordado

    const products = [...v.productIds]
      .map((pid) => productMap.get(pid))
      .filter((p): p is AbandonedCartProduct => !!p);
    if (products.length === 0) continue; // productos ya no disponibles

    result.push({
      customer: { id: customer.id, name: customer.name, email: customer.email },
      last_activity: v.lastAdd.toISOString(),
      products,
      reminded_before: !!reminded,
    });
  }

  result.sort((a, b) => b.last_activity.localeCompare(a.last_activity));
  return result;
}

/**
 * Envía el email de recupero a un cliente y registra el recordatorio (dedup).
 * `sentBy` = id del admin que lo dispara.
 */
export async function sendAbandonedCartReminder(customerId: number, sentBy: number): Promise<void> {
  const carts = await computeCustomerCarts(customerId);
  const cart = carts.get(customerId);
  if (!cart || cart.productIds.size === 0) {
    throw new AppError('Este cliente no tiene un carrito abandonado', 400);
  }

  // Idempotente por carrito: si ya se recordó este mismo carrito (reminder con
  // sent_at >= último cart_add), no reenviar — evita spam por doble click o
  // por una lista desactualizada. Vuelve a ser elegible si el cliente agrega
  // productos nuevos (nuevo lastAdd).
  const lastReminder = await StoreCartReminder.findOne({
    where: { customer_id: customerId },
    order: [['sent_at', 'DESC']],
    attributes: ['sent_at'],
  });
  if (lastReminder && lastReminder.sent_at >= cart.lastAdd) {
    throw new AppError('Ya se le envió un recordatorio por este carrito', 400);
  }

  const customer = await StoreCustomer.findByPk(customerId, { attributes: ['id', 'name', 'email', 'active'] });
  if (!customer || !customer.active) throw new AppError('Cliente no disponible', 404);

  const productMap = await resolveProducts([...cart.productIds]);
  const products = [...cart.productIds]
    .map((pid) => productMap.get(pid))
    .filter((p): p is AbandonedCartProduct => !!p);
  if (products.length === 0) throw new AppError('Los productos del carrito ya no están disponibles', 400);

  await sendAbandonedCartEmail(customer.email, customer.name, products);

  await StoreCartReminder.create({
    customer_id: customerId,
    sent_by: sentBy,
    product_ids: products.map((p) => p.id),
    last_cart_add_at: cart.lastAdd,
    sent_at: new Date(),
  });
}
