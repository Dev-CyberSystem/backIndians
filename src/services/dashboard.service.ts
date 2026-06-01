import { Op, fn, col, literal, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { Order, Client, Invoice, StockItem } from '../models';

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

export async function getDashboardSummary() {
  const now = new Date();
  const thisMonth = monthRange(now.getFullYear(), now.getMonth());
  const lastMonth = monthRange(now.getFullYear(), now.getMonth() - 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // ── KPIs principales ───────────────────────────────────────────────────────
  const [
    totalOrders,
    ordersThisMonth,
    ordersLastMonth,
    pendingOrders,
    revenueThisMonthRaw,
    revenueLastMonthRaw,
    pendingRevenueRaw,
    overdueInvoiceRows,
    criticalStockRows,
  ] = await Promise.all([
    Order.count(),

    Order.count({
      where: { createdAt: { [Op.between]: [thisMonth.start, thisMonth.end] } },
    }),

    Order.count({
      where: { createdAt: { [Op.between]: [lastMonth.start, lastMonth.end] } },
    }),

    Order.count({
      where: { status: { [Op.in]: ['pending', 'in_progress', 'quality_check', 'ready'] } },
    }),

    // Facturación del mes (facturas emitidas/pagadas)
    Invoice.sum('total_amount', {
      where: {
        status: { [Op.in]: ['issued', 'paid'] },
        issue_date: { [Op.between]: [thisMonth.start, thisMonth.end] },
      },
    }),

    Invoice.sum('total_amount', {
      where: {
        status: { [Op.in]: ['issued', 'paid'] },
        issue_date: { [Op.between]: [lastMonth.start, lastMonth.end] },
      },
    }),

    // Por cobrar (issued, no vencidas ni pagadas)
    Invoice.sum('total_amount', {
      where: { status: 'issued' },
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
     WHERE o.createdAt >= :from
     GROUP BY month
     ORDER BY month ASC`,
    { replacements: { from: sixMonthsAgo }, type: QueryTypes.SELECT }
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
     GROUP BY c.id, c.name
     ORDER BY total_revenue DESC
     LIMIT 5`,
    { type: QueryTypes.SELECT }
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
    total_orders: totalOrders,
    orders_this_month: ordersThisMonth,
    orders_last_month: ordersLastMonth,
    pending_orders: pendingOrders,
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
