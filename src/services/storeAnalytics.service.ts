import http from 'http';
import { Op } from 'sequelize';
import { sequelize } from '../config/db';
import { StoreEvent } from '../models/StoreEvent';
import { CatalogProduct } from '../models/CatalogProduct';
import { CatalogProductImage } from '../models/CatalogProductImage';
import { CatalogProductSize } from '../models/CatalogProductSize';
import { Client } from '../models/Client';

// ─── Geolocalización con cache en memoria ────────────────────────────────────

interface GeoResult {
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

interface GeoCache {
  data: GeoResult;
  expiresAt: number;
}

const geoCache = new Map<string, GeoCache>();
const GEO_TTL_MS = 60 * 60 * 1000; // 1 hora

const PRIVATE_IP_PATTERNS = [
  '127.0.0.1',
  '::1',
];

function isPrivateIp(ip: string): boolean {
  if (PRIVATE_IP_PATTERNS.includes(ip)) return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('::ffff:127.')) return true;
  if (ip.startsWith('::ffff:10.')) return true;
  if (ip.startsWith('::ffff:192.168.')) return true;
  // 172.16.0.0/12 → 172.16.x.x a 172.31.x.x
  const match = ip.match(/^172\.(\d+)\./);
  if (match) {
    const second = parseInt(match[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function resolveGeo(ip: string): Promise<GeoResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ countryCode: null, region: null, city: null });
    }, 3000);

    const req = http.get(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city&lang=es`,
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(raw);
            if (json.status === 'success') {
              resolve({
                countryCode: json.countryCode ?? null,
                region: json.regionName ?? null,
                city: json.city ?? null,
              });
            } else {
              resolve({ countryCode: null, region: null, city: null });
            }
          } catch {
            resolve({ countryCode: null, region: null, city: null });
          }
        });
      }
    );

    req.on('error', () => {
      clearTimeout(timeout);
      resolve({ countryCode: null, region: null, city: null });
    });
  });
}

async function getGeo(ip: string): Promise<GeoResult> {
  if (isPrivateIp(ip)) return { countryCode: null, region: null, city: null };

  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const data = await resolveGeo(ip);
  geoCache.set(ip, { data, expiresAt: Date.now() + GEO_TTL_MS });
  return data;
}

// ─── Includes comunes para productos ─────────────────────────────────────────

const productIncludes = [
  {
    model: CatalogProductImage,
    as: 'images',
    attributes: ['id', 'url', 'sort_order'],
  },
  {
    model: CatalogProductSize,
    as: 'sizes',
    attributes: ['id', 'size_name', 'stock_quantity', 'sort_order'],
  },
  {
    model: Client,
    as: 'client',
    attributes: ['id', 'name'],
  },
];

// ─── trackStoreEvent ─────────────────────────────────────────────────────────

export interface TrackEventInput {
  session_id: string;
  customer_id?: number | null;
  event_type: 'product_view' | 'cart_add' | 'cart_remove' | 'search' | 'purchase' | 'checkout_start';
  product_id?: number | null;
  search_query?: string | null;
  device_type?: 'mobile' | 'tablet' | 'desktop';
  ip?: string;
}

export async function trackStoreEvent(input: TrackEventInput): Promise<void> {
  const { ip, ...rest } = input;
  let geo: GeoResult = { countryCode: null, region: null, city: null };
  if (ip) {
    geo = await getGeo(ip);
  }

  await StoreEvent.create({
    session_id: rest.session_id,
    customer_id: rest.customer_id ?? null,
    event_type: rest.event_type,
    product_id: rest.product_id ?? null,
    search_query: rest.search_query ?? null,
    device_type: rest.device_type ?? 'desktop',
    country_code: geo.countryCode,
    region: geo.region,
    city: geo.city,
  });
}

// ─── getTrendingProducts ──────────────────────────────────────────────────────

export async function getTrendingProducts(options: {
  city?: string;
  days?: number;
  limit?: number;
}): Promise<CatalogProduct[]> {
  const { city, days = 7, limit = 10 } = options;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const whereEvent: Record<string, unknown> = {
    event_type: { [Op.in]: ['product_view', 'purchase'] },
    product_id: { [Op.not]: null },
    createdAt: { [Op.gte]: since },
  };
  if (city) whereEvent['city'] = city;

  // Contar eventos por product_id
  const rows = await StoreEvent.findAll({
    attributes: [
      'product_id',
      [sequelize.fn('COUNT', sequelize.col('id')), 'event_count'],
    ],
    where: whereEvent,
    group: ['product_id'],
    order: [[sequelize.literal('event_count'), 'DESC']],
    limit,
    raw: true,
  }) as unknown as Array<{ product_id: number; event_count: string }>;

  if (rows.length === 0) {
    // Sin datos: devuelve los más recientes
    return CatalogProduct.findAll({
      where: { show_in_store: true, active: true },
      include: productIncludes,
      order: [['createdAt', 'DESC']],
      limit,
    });
  }

  const ids = rows.map((r) => r.product_id);
  const products = await getProductsByIds(ids);
  return products;
}

// ─── getAlsoViewed ────────────────────────────────────────────────────────────

export async function getAlsoViewed(productId: number, limit = 6): Promise<CatalogProduct[]> {
  // Buscar sesiones donde se vio este producto
  const sessions = await StoreEvent.findAll({
    attributes: ['session_id'],
    where: {
      event_type: 'product_view',
      product_id: productId,
    },
    group: ['session_id'],
    limit: 200,
    raw: true,
  }) as unknown as Array<{ session_id: string }>;

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.session_id);

  // Productos vistos en esas mismas sesiones (excluyendo el producto actual)
  const coViewed = await StoreEvent.findAll({
    attributes: [
      'product_id',
      [sequelize.fn('COUNT', sequelize.col('id')), 'view_count'],
    ],
    where: {
      event_type: 'product_view',
      session_id: { [Op.in]: sessionIds },
      product_id: { [Op.not]: null, [Op.ne]: productId },
    },
    group: ['product_id'],
    order: [[sequelize.literal('view_count'), 'DESC']],
    limit,
    raw: true,
  }) as unknown as Array<{ product_id: number; view_count: string }>;

  if (coViewed.length === 0) return [];

  const ids = coViewed.map((r) => r.product_id);
  return getProductsByIds(ids);
}

// ─── getProductsByIds ─────────────────────────────────────────────────────────

export async function getProductsByIds(ids: number[]): Promise<CatalogProduct[]> {
  if (ids.length === 0) return [];

  const products = await CatalogProduct.findAll({
    where: {
      id: { [Op.in]: ids },
      show_in_store: true,
      active: true,
    },
    include: productIncludes,
  });

  // Preservar el orden del array de IDs
  const map = new Map(products.map((p) => [p.id, p]));
  return ids.map((id) => map.get(id)).filter((p): p is CatalogProduct => p !== undefined);
}

// ─── getEventAnalytics ────────────────────────────────────────────────────────

export interface EventAnalytics {
  top_products: Array<{
    product_id: number;
    views: number;
    cart_adds: number;
    purchases: number;
    product?: CatalogProduct | null;
  }>;
  top_cities: Array<{ city: string; count: number }>;
  device_breakdown: Array<{ device_type: string; count: number }>;
  top_searches: Array<{ search_query: string; count: number }>;
  funnel: {
    product_views: number;
    cart_adds: number;
    checkout_starts: number;
    purchases: number;
  };
  daily_activity: Array<{ date: string; count: number }>;
}

export async function getEventAnalytics(period?: string): Promise<EventAnalytics> {
  const now = new Date();
  let from: Date;
  let to: Date;

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
    to = now;
  }

  // ── Top products ──────────────────────────────────────────────────────────
  const productEvents = await StoreEvent.findAll({
    attributes: [
      'product_id',
      'event_type',
      [sequelize.fn('COUNT', sequelize.col('id')), 'cnt'],
    ],
    where: {
      event_type: { [Op.in]: ['product_view', 'cart_add', 'purchase'] },
      product_id: { [Op.not]: null },
      createdAt: { [Op.between]: [from, to] },
    },
    group: ['product_id', 'event_type'],
    raw: true,
  }) as unknown as Array<{ product_id: number; event_type: string; cnt: string }>;

  // Agrupar por producto
  const productMap = new Map<number, { views: number; cart_adds: number; purchases: number }>();
  for (const row of productEvents) {
    const entry = productMap.get(row.product_id) ?? { views: 0, cart_adds: 0, purchases: 0 };
    const count = parseInt(row.cnt, 10);
    if (row.event_type === 'product_view') entry.views += count;
    else if (row.event_type === 'cart_add') entry.cart_adds += count;
    else if (row.event_type === 'purchase') entry.purchases += count;
    productMap.set(row.product_id, entry);
  }

  // Ordenar por views + purchases desc, tomar top 20
  const sortedProducts = [...productMap.entries()]
    .sort((a, b) => (b[1].views + b[1].purchases * 3) - (a[1].views + a[1].purchases * 3))
    .slice(0, 20);

  const topProductIds = sortedProducts.map(([id]) => id);
  const topProductRecords = topProductIds.length > 0
    ? await CatalogProduct.findAll({
        where: { id: { [Op.in]: topProductIds } },
        include: productIncludes,
      })
    : [];
  const productRecordMap = new Map(topProductRecords.map((p) => [p.id, p]));

  const top_products = sortedProducts.map(([product_id, stats]) => ({
    product_id,
    views: stats.views,
    cart_adds: stats.cart_adds,
    purchases: stats.purchases,
    product: productRecordMap.get(product_id) ?? null,
  }));

  // ── Top cities ────────────────────────────────────────────────────────────
  const cityRows = await StoreEvent.findAll({
    attributes: [
      'city',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: {
      city: { [Op.not]: null },
      createdAt: { [Op.between]: [from, to] },
    },
    group: ['city'],
    order: [[sequelize.literal('count'), 'DESC']],
    limit: 10,
    raw: true,
  }) as unknown as Array<{ city: string; count: string }>;

  const top_cities = cityRows.map((r) => ({ city: r.city, count: parseInt(r.count, 10) }));

  // ── Device breakdown ──────────────────────────────────────────────────────
  const deviceRows = await StoreEvent.findAll({
    attributes: [
      'device_type',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: { createdAt: { [Op.between]: [from, to] } },
    group: ['device_type'],
    raw: true,
  }) as unknown as Array<{ device_type: string; count: string }>;

  const device_breakdown = deviceRows.map((r) => ({
    device_type: r.device_type,
    count: parseInt(r.count, 10),
  }));

  // ── Top searches ──────────────────────────────────────────────────────────
  const searchRows = await StoreEvent.findAll({
    attributes: [
      'search_query',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: {
      event_type: 'search',
      search_query: { [Op.not]: null },
      createdAt: { [Op.between]: [from, to] },
    },
    group: ['search_query'],
    order: [[sequelize.literal('count'), 'DESC']],
    limit: 20,
    raw: true,
  }) as unknown as Array<{ search_query: string; count: string }>;

  const top_searches = searchRows.map((r) => ({
    search_query: r.search_query,
    count: parseInt(r.count, 10),
  }));

  // ── Funnel (únicos por session) ───────────────────────────────────────────
  const funnelTypes = ['product_view', 'cart_add', 'checkout_start', 'purchase'] as const;
  const funnelRows = await StoreEvent.findAll({
    attributes: [
      'event_type',
      [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('session_id'))), 'sessions'],
    ],
    where: {
      event_type: { [Op.in]: [...funnelTypes] },
      createdAt: { [Op.between]: [from, to] },
    },
    group: ['event_type'],
    raw: true,
  }) as unknown as Array<{ event_type: string; sessions: string }>;

  const funnelMap = new Map(funnelRows.map((r) => [r.event_type, parseInt(r.sessions, 10)]));
  const funnel = {
    product_views: funnelMap.get('product_view') ?? 0,
    cart_adds: funnelMap.get('cart_add') ?? 0,
    checkout_starts: funnelMap.get('checkout_start') ?? 0,
    purchases: funnelMap.get('purchase') ?? 0,
  };

  // ── Daily activity (últimos 30 días) ──────────────────────────────────────
  const dailyRows = await StoreEvent.findAll({
    attributes: [
      [sequelize.fn('DATE', sequelize.col('createdAt')), 'date'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: { createdAt: { [Op.between]: [from, to] } },
    group: [sequelize.fn('DATE', sequelize.col('createdAt'))],
    order: [[sequelize.fn('DATE', sequelize.col('createdAt')), 'ASC']],
    raw: true,
  }) as unknown as Array<{ date: string; count: string }>;

  const daily_activity = dailyRows.map((r) => ({
    date: r.date,
    count: parseInt(r.count, 10),
  }));

  return {
    top_products,
    top_cities,
    device_breakdown,
    top_searches,
    funnel,
    daily_activity,
  };
}
