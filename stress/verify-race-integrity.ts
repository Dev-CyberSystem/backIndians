import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

/**
 * Verifica la integridad de stock después de correr stress/k6/04-stock-race.js.
 * No es un test de rendimiento: es un chequeo de CORRECCIÓN. Si algo de esto
 * falla, hay una condición de carrera real vendiendo más stock del que existe
 * — un bug de negocio serio, no cosmético.
 *
 *   npx ts-node --project ../tsconfig.seed.json stress/verify-race-integrity.ts
 */
// Nota: usamos sequelize.authenticate() en vez de connectDB() a propósito —
// connectDB() corre dedupeIndexes()+sync() en cada llamada, y disparar eso
// mientras el servidor de stress ya está corriendo (con su propio sync hecho
// al arrancar) puede pisarse con un índice recién creado (ER_DUP_KEYNAME,
// bug de entorno de dev ya documentado, no relacionado con este test). Este
// script solo lee — no necesita sincronizar esquema.
import { sequelize } from '../src/config/db';
import '../src/models/index';
import { CatalogProduct } from '../src/models/CatalogProduct';
import { CatalogProductSize } from '../src/models/CatalogProductSize';
import { CatalogStockMovement } from '../src/models/CatalogStockMovement';
import { StoreOrderItem } from '../src/models/StoreOrderItem';
import { STRESS_RACE_TITLE, STRESS_RACE_SIZE, STRESS_RACE_STOCK } from './seed-load-data';

async function main() {
  await sequelize.authenticate();

  const product = await CatalogProduct.findOne({ where: { title: STRESS_RACE_TITLE } });
  if (!product) {
    console.error(`🛑 No existe "${STRESS_RACE_TITLE}" — corré primero seed-load-data.ts y 04-stock-race.js`);
    process.exit(1);
  }
  const size = await CatalogProductSize.findOne({ where: { product_id: product.id, size_name: STRESS_RACE_SIZE } });
  if (!size) {
    console.error('🛑 No existe el talle del producto de carrera.');
    process.exit(1);
  }

  const orderItems = await StoreOrderItem.findAll({ where: { catalog_product_id: product.id } });

  const movements = await CatalogStockMovement.findAll({
    where: { catalog_product_id: product.id, catalog_product_size_id: size.id },
    order: [['id', 'ASC']],
  });

  const successfulOrders = orderItems.reduce((acc, i) => acc + i.quantity, 0);
  const reserveMovements = movements.filter((m) => m.type === 'reserve');

  let failures = 0;
  const report: string[] = [];

  report.push(`Stock físico (stock_quantity): ${size.stock_quantity} (esperado: ${STRESS_RACE_STOCK})`);
  if (size.stock_quantity !== STRESS_RACE_STOCK) {
    failures++;
    report.push('  ❌ El stock físico cambió — el checkout NO debería tocar stock_quantity, solo stock_reserved.');
  } else {
    report.push('  ✅ Sin cambios (correcto).');
  }

  report.push(`Stock reservado (stock_reserved): ${size.stock_reserved}`);
  if (size.stock_reserved > STRESS_RACE_STOCK) {
    failures++;
    report.push(`  ❌ OVERSELL: se reservaron ${size.stock_reserved} unidades sobre un stock de ${STRESS_RACE_STOCK}.`);
  } else {
    report.push('  ✅ Nunca superó el stock disponible.');
  }

  report.push(`Pedidos creados sobre este producto: ${successfulOrders}`);
  if (successfulOrders > STRESS_RACE_STOCK) {
    failures++;
    report.push(`  ❌ Se crearon más pedidos (${successfulOrders}) que stock disponible (${STRESS_RACE_STOCK}).`);
  } else {
    report.push('  ✅ No más pedidos que stock.');
  }

  report.push(`Movimientos de reserva en el ledger: ${reserveMovements.length}`);
  const sumReserved = reserveMovements.reduce((acc, m) => acc + m.quantity, 0);
  if (sumReserved !== size.stock_reserved) {
    failures++;
    report.push(`  ❌ El ledger (suma=${sumReserved}) no coincide con stock_reserved (${size.stock_reserved}) — el ledger no está siendo la única fuente de verdad.`);
  } else {
    report.push('  ✅ El ledger reconcilia con stock_reserved.');
  }

  console.log('\n═══ Verificación de integridad — condición de carrera (STRESS-RACE) ═══\n');
  console.log(report.join('\n'));
  console.log(`\n${failures === 0 ? '🎉 PASA' : `🛑 FALLA (${failures} problema/s)`} — ${successfulOrders} pedidos, ${size.stock_reserved} reservado de ${size.stock_quantity} físico.\n`);

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Error verificando integridad:', err);
  process.exit(1);
});
