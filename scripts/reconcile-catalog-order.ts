/**
 * Reconciliación manual de una venta de catálogo contra MercadoPago.
 *
 * Le pregunta a MP por los pagos asociados al `external_reference` del pedido
 * (su `order_number`) y aplica los aprobados con la misma lógica que el
 * webhook y el job periódico: registra el cobro en la factura, la salda si
 * corresponde y genera el asiento de caja. Es idempotente — correrlo dos
 * veces no duplica nada.
 *
 * Para qué sirve: recuperar pagos que quedaron sin acreditar por el bug del
 * 2026-08-19 (la preference se creaba sin `notification_url`, así que MP nunca
 * notificaba nada). El job automático deja afuera a propósito las facturas ya
 * marcadas como "Pagada" a mano — y esas son justamente las que hay que
 * arreglar acá, porque figuran pagadas con $0 cobrado.
 *
 *   npx ts-node --project tsconfig.seed.json scripts/reconcile-catalog-order.ts CAT-2026-00002
 *   npx ts-node --project tsconfig.seed.json scripts/reconcile-catalog-order.ts --all-unpaid
 *
 * Requiere MP_ACCESS_TOKEN apuntando a la MISMA cuenta que cobró (si se corre
 * contra producción, las credenciales de producción).
 */

import { Op } from 'sequelize';
import { sequelize } from '../src/config/db';
import { CatalogOrder } from '../src/models/CatalogOrder';
import { CatalogInvoice } from '../src/models/CatalogInvoice';
import { confirmCatalogPayment } from '../src/services/catalog.service';

async function orderNumbersToProcess(args: string[]): Promise<string[]> {
  const explicit = args.filter((a) => !a.startsWith('--'));
  if (explicit.length > 0) return explicit;

  if (!args.includes('--all-unpaid')) {
    console.error('Uso: reconcile-catalog-order.ts <CAT-XXXX-XXXXX> [...] | --all-unpaid');
    process.exit(1);
  }

  // Todo pedido con link/QR de pago generado cuya factura no está anulada y
  // tiene saldo o figura pagada sin cobros registrados.
  const orders = await CatalogOrder.findAll({
    where: { mp_preference_id: { [Op.ne]: null } },
    include: [{
      model: CatalogInvoice,
      as: 'invoice',
      required: true,
      where: {
        status: { [Op.ne]: 'cancelled' },
        payment_amount: { [Op.lt]: sequelize.col('invoice.total_amount') },
      },
      attributes: ['id'],
    }],
    attributes: ['order_number'],
    order: [['id', 'ASC']],
  });
  return orders.map((o) => o.order_number);
}

async function main(): Promise<void> {
  const numbers = await orderNumbersToProcess(process.argv.slice(2));
  if (numbers.length === 0) {
    console.log('No hay pedidos para reconciliar.');
    return;
  }

  console.log(`Reconciliando ${numbers.length} pedido(s) contra MercadoPago…\n`);

  for (const orderNumber of numbers) {
    try {
      const results = await confirmCatalogPayment(orderNumber);
      if (results.length === 0) {
        console.log(`  ${orderNumber}  —  sin pagos aprobados en MP`);
        continue;
      }
      for (const r of results) {
        console.log(`  ${orderNumber}  —  ${r.applied ? 'ACREDITADO' : 'sin cambios'} (${r.reason})`);
      }
    } catch (err) {
      console.error(`  ${orderNumber}  —  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await sequelize.close().catch(() => null);
    process.exit(1);
  });
