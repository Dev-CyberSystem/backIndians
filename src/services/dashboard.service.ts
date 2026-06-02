import { Op, fn, col, literal, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { Order, Client, Invoice, StockItem, User } from '../models';

function monthRange(year: number, month: number) {
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
}

interface Recommendation {
  type: 'danger' | 'warning' | 'info' | 'success';
  title: string;
  description: string;
}

function buildRecommendations(opts: {
  revenueThisMonth: number;
  revenueLastMonth: number;
  ordersThisMonth: number;
  overdueCount: number;
  emptyStockCount: number;
  lowStockCount: number;
  emptyStockNames: string[];
  lowStockNames: string[];
  pendingOrders: number;
}): Recommendation[] {
  const recs: Recommendation[] = [];

  if (opts.revenueLastMonth > 0) {
    const pct = ((opts.revenueThisMonth - opts.revenueLastMonth) / opts.revenueLastMonth) * 100;
    if (pct < -20) {
      recs.push({
        type: 'danger',
        title: `Facturación cayó ${Math.abs(pct).toFixed(0)}%`,
        description: 'La facturación bajó significativamente respecto al mes anterior. Revisá el pipeline de pedidos y el equipo de ventas.',
      });
    } else if (pct > 15) {
      recs.push({
        type: 'success',
        title: `Facturación creció ${pct.toFixed(0)}%`,
        description: '¡Excelente mes! La facturación superó al período anterior. Es un buen momento para planificar la capacidad productiva.',
      });
    }
  } else if (opts.revenueThisMonth > 0) {
    recs.push({
      type: 'info',
      title: 'Primer mes con facturación',
      description: 'No hay datos del mes anterior para comparar, pero el mes arrancó con actividad.',
    });
  }

  if (opts.overdueCount > 0) {
    recs.push({
      type: 'warning',
      title: `${opts.overdueCount} factura${opts.overdueCount > 1 ? 's' : ''} vencida${opts.overdueCount > 1 ? 's' : ''}`,
      description: 'Hay facturas sin cobrar con vencimiento superado. Gestioná el cobro para mejorar el flujo de caja.',
    });
  }

  if (opts.emptyStockCount > 0) {
    const names = opts.emptyStockNames.slice(0, 3).join(', ') + (opts.emptyStockNames.length > 3 ? '…' : '');
    recs.push({
      type: 'danger',
      title: `${opts.emptyStockCount} material${opts.emptyStockCount > 1 ? 'es' : ''} sin stock`,
      description: `${names} ${opts.emptyStockCount > 1 ? 'están' : 'está'} en 0. Realizá una compra urgente para no frenar la producción.`,
    });
  }

  if (opts.lowStockCount > 0) {
    const names = opts.lowStockNames.slice(0, 3).join(', ') + (opts.lowStockNames.length > 3 ? '…' : '');
    recs.push({
      type: 'warning',
      title: `${opts.lowStockCount} material${opts.lowStockCount > 1 ? 'es' : ''} con stock bajo`,
      description: `${names} ${opts.lowStockCount > 1 ? 'están' : 'está'} por debajo del mínimo. Planificá la compra antes de que impacte en producción.`,
    });
  }

  if (opts.pendingOrders > 15) {
    recs.push({
      type: 'info',
      title: 'Alta carga en producción',
      description: `Hay ${opts.pendingOrders} pedidos activos. Evaluá si el equipo puede absorber la demanda o si es necesario escalar.`,
    });
  }

  if (opts.ordersThisMonth === 0) {
    recs.push({
      type: 'info',
      title: 'Sin nuevos pedidos este mes',
      description: 'Todavía no ingresaron pedidos en el mes actual. Considerá contactar a los clientes recurrentes.',
    });
  }

  if (recs.length === 0) {
    recs.push({
      type: 'success',
      title: 'Todo en orden',
      description: 'No hay alertas activas. El negocio está operando con normalidad. ¡Seguí adelante!',
    });
  }

  return recs;
}

// ── Resolución de período ──────────────────────────────────────────────────

interface PeriodRange {
  periodStart: Date; periodEnd: Date;
  prevStart: Date; prevEnd: Date;
  chartFrom: Date; chartTo: Date;
}

function resolvePeriod(period?: string): PeriodRange {
  const now = new Date();

  // Año calendario: "2026", "2025", …
  if (period && /^\d{4}$/.test(period)) {
    const y = Number(period);
    return {
      periodStart: new Date(y, 0, 1),
      periodEnd:   new Date(y, 11, 31, 23, 59, 59, 999),
      prevStart:   new Date(y - 1, 0, 1),
      prevEnd:     new Date(y - 1, 11, 31, 23, 59, 59, 999),
      chartFrom:   new Date(y, 0, 1),
      chartTo:     new Date(y, 11, 31, 23, 59, 59, 999),
    };
  }

  // Últimos 6 meses cerrados (excluye el mes en curso)
  if (period === 'last6') {
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const periodEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const prevStart   = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const prevEnd     = new Date(periodStart.getTime() - 1);
    return { periodStart, periodEnd, prevStart, prevEnd, chartFrom: periodStart, chartTo: periodEnd };
  }

  // Mes específico: "YYYY-MM" o mes actual por defecto
  let y: number, m: number;
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    [y, m] = period.split('-').map(Number);
  } else {
    y = now.getFullYear(); m = now.getMonth() + 1;
  }
  const curr = monthRange(y, m - 1);
  const prev = monthRange(y, m - 2);
  return {
    periodStart: curr.start, periodEnd: curr.end,
    prevStart:   prev.start, prevEnd:   prev.end,
    chartFrom:   new Date(y, m - 6, 1), chartTo: curr.end,
  };
}

export async function getDashboardSummary(period?: string) {
  const now = new Date();
  const { periodStart, periodEnd, prevStart, prevEnd, chartFrom, chartTo } = resolvePeriod(period);

  // ── KPIs principales ───────────────────────────────────────────────────────
  const [
    ordersThisMonth,
    ordersLastMonth,
    pendingOrders,
    readyOrders,
    cancelledOrders,
    revenueThisMonthRaw,
    revenueLastMonthRaw,
    pendingRevenueRaw,
    overdueInvoiceRows,
    criticalStockRows,
  ] = await Promise.all([
    // Todos los pedidos del período
    Order.count({
      where: { createdAt: { [Op.between]: [periodStart, periodEnd] } },
    }),

    // Pedidos del período anterior (para tendencia)
    Order.count({
      where: { createdAt: { [Op.between]: [prevStart, prevEnd] } },
    }),

    // Pedidos activos del período (en proceso, sin cancelados ni listos)
    Order.count({
      where: {
        createdAt: { [Op.between]: [periodStart, periodEnd] },
        status: { [Op.notIn]: ['cancelled', 'ready'] },
      },
    }),

    // Pedidos listos del período
    Order.count({
      where: {
        createdAt: { [Op.between]: [periodStart, periodEnd] },
        status: 'ready',
      },
    }),

    // Pedidos cancelados del período
    Order.count({
      where: {
        createdAt: { [Op.between]: [periodStart, periodEnd] },
        status: 'cancelled',
      },
    }),

    // Facturación del período (facturas emitidas/pagadas)
    Invoice.sum('total_amount', {
      where: {
        status: { [Op.in]: ['issued', 'paid'] },
        issue_date: { [Op.between]: [periodStart, periodEnd] },
      },
    }),

    Invoice.sum('total_amount', {
      where: {
        status: { [Op.in]: ['issued', 'paid'] },
        issue_date: { [Op.between]: [prevStart, prevEnd] },
      },
    }),

    // Por cobrar del período: facturas emitidas aún sin pagar
    Invoice.sum('total_amount', {
      where: {
        status: 'issued',
        issue_date: { [Op.between]: [periodStart, periodEnd] },
      },
    }),

    // Facturas vencidas
    Invoice.findAll({
      where: {
        status: 'issued',
        due_date: { [Op.lt]: now, [Op.not]: null },
      },
      include: [{
        model: Order,
        as: 'order',
        attributes: ['id'],
        include: [{ model: Client, as: 'client', attributes: ['id', 'name'] }],
      }],
      order: [['due_date', 'ASC']],
      limit: 10,
    }),

    // Stock crítico (empty + low) — query directa para evitar literal() en Op.or
    sequelize.query<{
      id: number; name: string; unit: string;
      current_quantity: string; min_quantity: string;
    }>(
      `SELECT id, name, unit, current_quantity, min_quantity
       FROM stock_items
       WHERE active = 1
         AND (
           current_quantity <= 0
           OR (min_quantity > 0 AND current_quantity > 0 AND current_quantity <= min_quantity)
         )
       ORDER BY current_quantity ASC
       LIMIT 10`,
      { type: QueryTypes.SELECT }
    ),
  ]);

  const revenueThisMonth = Number(revenueThisMonthRaw ?? 0);
  const revenueLastMonth = Number(revenueLastMonthRaw ?? 0);
  const pendingRevenue   = Number(pendingRevenueRaw ?? 0);

  // ── Facturación últimos 6 meses ────────────────────────────────────────────
  const ordersByMonth = await sequelize.query<{
    month: string; count: number; revenue: number;
  }>(
    `SELECT
       DATE_FORMAT(o.createdAt, '%Y-%m') AS month,
       COUNT(DISTINCT o.id)              AS count,
       COALESCE(SUM(i.total_amount), 0)  AS revenue
     FROM orders o
     LEFT JOIN invoices i
       ON i.order_id = o.id AND i.status IN ('issued','paid')
     WHERE o.createdAt BETWEEN :from AND :to
     GROUP BY month
     ORDER BY month ASC`,
    { replacements: { from: chartFrom, to: chartTo }, type: QueryTypes.SELECT }
  );

  // ── Distribución por estado ────────────────────────────────────────────────
  const ordersByStatus = await Order.findAll({
    attributes: ['status', [fn('COUNT', col('id')), 'count']],
    group: ['status'],
    raw: true,
  }) as unknown as Array<{ status: string; count: string }>;

  // ── Top 5 clientes por revenue ─────────────────────────────────────────────
  const topClients = await sequelize.query<{
    client_id: number; client_name: string; total_orders: number; total_revenue: number;
  }>(
    `SELECT
       c.id                             AS client_id,
       c.name                           AS client_name,
       COUNT(DISTINCT o.id)             AS total_orders,
       COALESCE(SUM(i.total_amount), 0) AS total_revenue
     FROM orders o
     JOIN clients c ON c.id = o.client_id
     LEFT JOIN invoices i
       ON i.order_id = o.id AND i.status IN ('issued','paid')
     WHERE o.createdAt BETWEEN :periodStart AND :periodEnd
     GROUP BY c.id, c.name
     ORDER BY total_revenue DESC
     LIMIT 5`,
    { replacements: { periodStart, periodEnd }, type: QueryTypes.SELECT }
  );

  // ── Formatear facturas vencidas ────────────────────────────────────────────
  const overdueInvoices = overdueInvoiceRows.map((inv: any) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    total_amount: Number(inv.total_amount ?? 0),
    due_date: inv.due_date,
    days_overdue: Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86_400_000),
    client_name: inv.order?.client?.name ?? '—',
    order_id: inv.order_id,
  }));

  const overdueAmount = overdueInvoices.reduce((s, i) => s + i.total_amount, 0);

  // ── Stock crítico formateado ───────────────────────────────────────────────
  const criticalStock = criticalStockRows.map((item: any) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    current_quantity: Number(item.current_quantity),
    min_quantity: Number(item.min_quantity),
    status: Number(item.current_quantity) <= 0 ? 'empty' : 'low',
  }));

  // ── Recomendaciones ────────────────────────────────────────────────────────
  const emptyItems = criticalStock.filter(i => i.status === 'empty');
  const lowItems   = criticalStock.filter(i => i.status === 'low');

  const recommendations = buildRecommendations({
    revenueThisMonth,
    revenueLastMonth,
    ordersThisMonth,
    overdueCount: overdueInvoices.length,
    emptyStockCount: emptyItems.length,
    lowStockCount: lowItems.length,
    emptyStockNames: emptyItems.map(i => i.name),
    lowStockNames: lowItems.map(i => i.name),
    pendingOrders,
  });

  return {
    // KPIs
    total_orders: ordersThisMonth,
    orders_this_month: ordersThisMonth,
    orders_last_month: ordersLastMonth,
    pending_orders: pendingOrders,
    ready_orders: readyOrders,
    cancelled_orders: cancelledOrders,
    revenue_this_month: revenueThisMonth,
    revenue_last_month: revenueLastMonth,
    pending_revenue: pendingRevenue,
    overdue_count: overdueInvoices.length,
    overdue_amount: overdueAmount,
    // Gráficos
    orders_by_month: ordersByMonth.map(r => ({
      month: r.month,
      count: Number(r.count),
      revenue: Number(r.revenue),
    })),
    orders_by_status: ordersByStatus.map(r => ({
      status: r.status,
      count: Number(r.count),
    })),
    // Listas
    top_clients: topClients.map(r => ({
      client_id: Number(r.client_id),
      client_name: r.client_name,
      total_orders: Number(r.total_orders),
      total_revenue: Number(r.total_revenue),
    })),
    overdue_invoices: overdueInvoices,
    critical_stock: criticalStock,
    // Inteligencia
    recommendations,
  };
}

// ── Estadísticas de vendedores ─────────────────────────────────────────────

function sumSizes(sizes: unknown): number {
  if (!sizes || typeof sizes !== 'object') return 0;
  return Object.values(sizes as Record<string, unknown>)
    .reduce((s, q) => s + (Number(q) || 0), 0);
}

export async function getSellerStats(filters: {
  seller_id?: number;
  month?: string;   // 'YYYY-MM'
  sort_by?: string; // 'revenue' | 'orders' | 'units'
}) {
  const now = new Date();
  let currentStart: Date, currentEnd: Date, prevStart: Date, prevEnd: Date;
  let periodLabel: string, prevPeriodLabel: string;

  if (filters.month) {
    const [y, m] = filters.month.split('-').map(Number);
    const curr = monthRange(y, m - 1);
    const prev = monthRange(y, m - 2);
    currentStart = curr.start; currentEnd = curr.end;
    prevStart = prev.start; prevEnd = prev.end;
    periodLabel = filters.month;
    const prevDate = new Date(y, m - 2, 1);
    prevPeriodLabel = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  } else {
    const curr = monthRange(now.getFullYear(), now.getMonth());
    const prev = monthRange(now.getFullYear(), now.getMonth() - 1);
    currentStart = curr.start; currentEnd = curr.end;
    prevStart = prev.start; prevEnd = prev.end;
    periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevPeriodLabel = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  }

  const sellerFilter = filters.seller_id ? 'AND u.id = :sellerId' : '';

  // Stats del período actual
  const currentRows = await sequelize.query<{
    seller_id: number; seller_name: string;
    total_orders: string; pending_orders: string;
    ready_orders: string; cancelled_orders: string;
    total_revenue: string;
  }>(
    `SELECT
       u.id                AS seller_id,
       u.name              AS seller_name,
       COUNT(DISTINCT o.id)                                                               AS total_orders,
       COUNT(DISTINCT CASE WHEN o.status NOT IN ('ready','cancelled') THEN o.id END)     AS pending_orders,
       COUNT(DISTINCT CASE WHEN o.status = 'ready' THEN o.id END)                       AS ready_orders,
       COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN o.id END)                   AS cancelled_orders,
       COALESCE(SUM(i.total_amount), 0)                                                   AS total_revenue
     FROM users u
     LEFT JOIN orders o
       ON o.seller_id = u.id
       AND o.createdAt BETWEEN :currentStart AND :currentEnd
     LEFT JOIN invoices i
       ON i.order_id = o.id AND i.status IN ('issued','paid')
     WHERE u.role = 'seller' AND u.active = 1 ${sellerFilter}
     GROUP BY u.id, u.name`,
    {
      replacements: { currentStart, currentEnd, sellerId: filters.seller_id ?? null },
      type: QueryTypes.SELECT,
    }
  );

  // Revenue período anterior (para comparación)
  const prevRows = await sequelize.query<{ seller_id: number; prev_revenue: string }>(
    `SELECT
       u.id AS seller_id,
       COALESCE(SUM(i.total_amount), 0) AS prev_revenue
     FROM users u
     LEFT JOIN orders o
       ON o.seller_id = u.id
       AND o.createdAt BETWEEN :prevStart AND :prevEnd
     LEFT JOIN invoices i
       ON i.order_id = o.id AND i.status IN ('issued','paid')
     WHERE u.role = 'seller' AND u.active = 1 ${sellerFilter}
     GROUP BY u.id`,
    {
      replacements: { prevStart, prevEnd, sellerId: filters.seller_id ?? null },
      type: QueryTypes.SELECT,
    }
  );

  // Unidades del período actual (procesadas en Node.js para compatibilidad con JSON)
  const itemRows = await sequelize.query<{ seller_id: number; sizes: unknown }>(
    `SELECT o.seller_id, oi.sizes
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
       AND o.createdAt BETWEEN :currentStart AND :currentEnd
     JOIN users u ON u.id = o.seller_id AND u.role = 'seller' AND u.active = 1 ${sellerFilter}`,
    {
      replacements: { currentStart, currentEnd, sellerId: filters.seller_id ?? null },
      type: QueryTypes.SELECT,
    }
  );

  // Unidades por vendedor
  const unitsBySeller: Record<number, number> = {};
  for (const row of itemRows) {
    unitsBySeller[row.seller_id] = (unitsBySeller[row.seller_id] ?? 0) + sumSizes(row.sizes);
  }

  // Mapa de revenue anterior
  const prevRevMap: Record<number, number> = {};
  for (const r of prevRows) prevRevMap[Number(r.seller_id)] = Number(r.prev_revenue);

  // Combinar resultados
  let sellers = currentRows.map((r) => {
    const sid = Number(r.seller_id);
    return {
      seller_id: sid,
      seller_name: r.seller_name,
      total_orders: Number(r.total_orders),
      pending_orders: Number(r.pending_orders),
      ready_orders: Number(r.ready_orders),
      cancelled_orders: Number(r.cancelled_orders),
      total_revenue: Number(r.total_revenue),
      prev_revenue: prevRevMap[sid] ?? 0,
      total_units: unitsBySeller[sid] ?? 0,
    };
  });

  // Ordenar
  const sortBy = filters.sort_by ?? 'revenue';
  sellers.sort((a, b) => {
    if (sortBy === 'orders') return b.total_orders - a.total_orders;
    if (sortBy === 'units')  return b.total_units - a.total_units;
    return b.total_revenue - a.total_revenue;
  });

  // Resumen global del período
  const global = sellers.reduce(
    (acc, s) => ({
      total_orders: acc.total_orders + s.total_orders,
      total_revenue: acc.total_revenue + s.total_revenue,
      prev_revenue: acc.prev_revenue + s.prev_revenue,
      total_units: acc.total_units + s.total_units,
      ready_orders: acc.ready_orders + s.ready_orders,
      cancelled_orders: acc.cancelled_orders + s.cancelled_orders,
      pending_orders: acc.pending_orders + s.pending_orders,
    }),
    { total_orders: 0, total_revenue: 0, prev_revenue: 0, total_units: 0, ready_orders: 0, cancelled_orders: 0, pending_orders: 0 }
  );

  return {
    period: periodLabel,
    prev_period: prevPeriodLabel,
    sellers,
    global,
  };
}
