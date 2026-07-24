import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../src/config/db';
import { connectDB } from '../src/config/db';
import { ensureSchema } from '../src/config/ensureSchema';
import '../src/models/index';
import { GarmentType } from '../src/models/GarmentType';
import { CatalogProduct } from '../src/models/CatalogProduct';
import { Order } from '../src/models/Order';
import { OrderItem } from '../src/models/OrderItem';
import { GarmentCost } from '../src/models/GarmentCost';
import { Client } from '../src/models/Client';

/**
 * Migra los tipos de prenda GLOBALES/legado (client_id NULL) al modelo por
 * cliente: por cada tipo global detecta qué clientes lo usan (productos de
 * catálogo, ítems de pedidos y hojas de costo) y:
 *   - 1 cliente  → le asigna el client_id a la fila existente (reutiliza).
 *   - N clientes → conserva la fila para el 1º cliente y para el resto crea una
 *                  copia por cliente, repuntando sus referencias a la copia.
 *   - si un cliente ya tiene un tipo con el mismo nombre, repunta a ese (no dup).
 * El detalle de costos congelado de pedidos (order_cost_details) NO se toca:
 * guarda el nombre denormalizado y es histórico.
 *
 * Uso:
 *   # Simulación (no toca la base, solo reporta):
 *   npx ts-node --project tsconfig.seed.json seeders/assign-garment-clients.ts
 *   # Aplicar de verdad (en transacción):
 *   npx ts-node --project tsconfig.seed.json seeders/assign-garment-clients.ts --apply
 */

const APPLY = process.argv.includes('--apply');

// Clientes que usan un tipo de prenda, por cada fuente.
async function usingClientIds(garmentTypeId: number): Promise<number[]> {
  const rows = await sequelize.query<{ client_id: number }>(
    `SELECT client_id FROM catalog_products WHERE garment_type_id = :g AND client_id IS NOT NULL
     UNION
     SELECT o.client_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.garment_type_id = :g
     UNION
     SELECT client_id FROM garment_costs WHERE garment_type_id = :g`,
    { replacements: { g: garmentTypeId }, type: QueryTypes.SELECT }
  );
  return [...new Set(rows.map((r) => Number(r.client_id)).filter(Boolean))];
}

async function orderIdsOfClient(clientId: number): Promise<number[]> {
  const orders = await Order.findAll({ where: { client_id: clientId }, attributes: ['id'] });
  return orders.map((o) => o.id);
}

// Repunta las referencias de un cliente desde el tipo `from` al tipo `to`.
async function repoint(
  clientId: number,
  fromG: number,
  toG: number,
  t: Transaction | undefined
): Promise<{ products: number; items: number; costs: number }> {
  const orderIds = await orderIdsOfClient(clientId);

  const [products] = await CatalogProduct.update(
    { garment_type_id: toG },
    { where: { client_id: clientId, garment_type_id: fromG }, transaction: t }
  );

  let items = 0;
  if (orderIds.length > 0) {
    [items] = await OrderItem.update(
      { garment_type_id: toG },
      { where: { order_id: orderIds, garment_type_id: fromG }, transaction: t }
    );
  }

  // Hojas de costo: si el destino ya tiene hoja para ese cliente, se descarta la
  // legacy (conflicto de unicidad); si no, se repunta.
  let costs = 0;
  const fromSheet = await GarmentCost.findOne({
    where: { client_id: clientId, garment_type_id: fromG }, transaction: t,
  });
  if (fromSheet) {
    const toSheet = await GarmentCost.findOne({
      where: { client_id: clientId, garment_type_id: toG }, transaction: t,
    });
    if (toSheet) {
      await fromSheet.destroy({ transaction: t });
    } else {
      await fromSheet.update({ garment_type_id: toG }, { transaction: t });
    }
    costs = 1;
  }

  return { products, items, costs };
}

async function run() {
  await connectDB();
  await ensureSchema(); // asegura garment_types.client_id aunque no se haya migrado
  console.log(`\n🔧 Migración de tipos de prenda globales → por cliente  ${APPLY ? '(APLICAR)' : '(SIMULACIÓN — usá --apply para ejecutar)'}\n`);

  const legacy = await GarmentType.findAll({ where: { client_id: null } });
  if (legacy.length === 0) {
    console.log('✅ No hay tipos de prenda globales/legado. Nada para migrar.\n');
    process.exit(0);
  }

  const clientNames = new Map<number, string>(
    (await Client.findAll({ attributes: ['id', 'name'] })).map((c) => [c.id, c.name])
  );

  const t = APPLY ? await sequelize.transaction() : undefined;
  let assigned = 0, copied = 0, repointed = 0, deactivated = 0, unused = 0;

  try {
    for (const g of legacy) {
      const clients = await usingClientIds(g.id);
      if (clients.length === 0) {
        console.log(`· "${g.name}" (#${g.id}) — sin uso, se deja como está.`);
        unused++;
        continue;
      }

      console.log(`\n▸ "${g.name}" (#${g.id}) usado por ${clients.length} cliente(s):`);
      let keptForClient = false;

      for (const clientId of clients) {
        const cname = clientNames.get(clientId) ?? `#${clientId}`;
        const existing = await GarmentType.findOne({ where: { client_id: clientId, name: g.name } });

        if (existing) {
          const r = APPLY
            ? await repoint(clientId, g.id, existing.id, t)
            : await previewRepoint(clientId, g.id);
          console.log(`   → ${cname}: ya tenía "${g.name}" (#${existing.id}); repunta productos:${r.products} ítems:${r.items} costos:${r.costs}`);
          repointed++;
        } else if (!keptForClient) {
          // El primer cliente sin tipo propio se queda con la fila legacy.
          if (APPLY) await g.update({ client_id: clientId }, { transaction: t });
          console.log(`   → ${cname}: se le asigna esta prenda (reutiliza #${g.id}).`);
          keptForClient = true;
          assigned++;
        } else {
          if (APPLY) {
            const copy = await GarmentType.create({
              name: g.name,
              client_id: clientId,
              cost_category: g.cost_category,
              sort_order: g.sort_order,
              active: g.active,
            }, { transaction: t });
            const r = await repoint(clientId, g.id, copy.id, t);
            console.log(`   → ${cname}: copia nueva #${copy.id}; repunta productos:${r.products} ítems:${r.items} costos:${r.costs}`);
          } else {
            const r = await previewRepoint(clientId, g.id);
            console.log(`   → ${cname}: copia nueva; repunta productos:${r.products} ítems:${r.items} costos:${r.costs}`);
          }
          copied++;
        }
      }

      // Si la fila legacy no quedó para ningún cliente, se desactiva (fuera de listas).
      if (!keptForClient) {
        if (APPLY) await g.update({ active: false }, { transaction: t });
        console.log(`   ⚑ "${g.name}" (#${g.id}) queda inactivo (legado sin dueño).`);
        deactivated++;
      }
    }

    if (t) await t.commit();
  } catch (err) {
    if (t) await t.rollback();
    throw err;
  }

  console.log(`\n${APPLY ? '✅ Aplicado' : '🔎 Simulación'}: ${assigned} asignados, ${copied} copiados, ${repointed} repuntados a existente, ${deactivated} desactivados, ${unused} sin uso.`);
  if (!APPLY) console.log('   Volvé a correr con --apply para ejecutar los cambios.\n');
  else console.log('   Migración completada.\n');
  process.exit(0);
}

// Conteo de referencias para la simulación (sin mutar).
async function previewRepoint(clientId: number, fromG: number) {
  const orderIds = await orderIdsOfClient(clientId);
  const products = await CatalogProduct.count({ where: { client_id: clientId, garment_type_id: fromG } });
  const items = orderIds.length > 0
    ? await OrderItem.count({ where: { order_id: orderIds, garment_type_id: fromG } })
    : 0;
  const costs = await GarmentCost.count({ where: { client_id: clientId, garment_type_id: fromG } });
  return { products, items, costs };
}

run().catch((err) => {
  console.error('❌ Error:', err?.message ?? err);
  process.exit(1);
});
