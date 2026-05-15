import { Op, fn, col, literal } from 'sequelize';
import { Order, Client, Invoice } from '../models';

export async function getDashboardSummary() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Conteo de pedidos por estado
  const ordersByStatus = await Order.findAll({
    attributes: ['status', [fn('COUNT', col('id')), 'count']],
    group: ['status'],
    raw: true,
  }) as unknown as Array<{ status: string; count: string }>;

  // Ventas del mes (facturas emitidas o pagadas)
  const monthlySales = await Invoice.findAll({
    attributes: [[fn('SUM', col('Invoice.id')), 'total_invoices']],
    where: {
      status: { [Op.in]: ['issued', 'paid'] },
      issue_date: { [Op.between]: [startOfMonth, endOfMonth] },
    },
    raw: true,
  });

  // Total de pedidos entregados vs pendientes en el mes
  const deliveredThisMonth = await Order.count({
    where: {
      status: 'delivered',
      updatedAt: { [Op.between]: [startOfMonth, endOfMonth] },
    },
  });

  const pendingTotal = await Order.count({
    where: { status: { [Op.in]: ['pending', 'in_progress', 'quality_check', 'ready'] } },
  });

  // Top 5 clientes por cantidad de pedidos
  const topClients = await Order.findAll({
    attributes: [
      'client_id',
      [fn('COUNT', col('Order.id')), 'total_orders'],
    ],
    include: [{ model: Client, as: 'client', attributes: ['id', 'name'] }],
    group: ['client_id', 'client.id', 'client.name'],
    order: [[literal('total_orders'), 'DESC']],
    limit: 5,
    raw: false,
  });

  return {
    orders_by_status: ordersByStatus,
    monthly_sales: monthlySales[0],
    delivered_this_month: deliveredThisMonth,
    pending_total: pendingTotal,
    top_clients: topClients.map((o) => ({
      client: (o as any).client,
      total_orders: (o as any).dataValues.total_orders,
    })),
  };
}
