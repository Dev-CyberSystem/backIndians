import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

/**
 * Sembrado de datos de VOLUMEN para el test de estrés (backIndians/stress/).
 * No reemplaza a los seeders normales (`seeders/`) — esos crean datos de ejemplo
 * chicos y fijos; este script crea cientos de filas para poder medir capacidad
 * real bajo carga.
 *
 *   npx ts-node --project ../tsconfig.seed.json stress/seed-load-data.ts
 *   npx ts-node --project ../tsconfig.seed.json stress/seed-load-data.ts --reset-race-stock
 *   npx ts-node --project ../tsconfig.seed.json stress/seed-load-data.ts --cleanup
 *
 * Seguridad: igual que scripts/reset-dev-db.js, aborta si la base no es local —
 * este script escribe cientos de filas y nunca debe poder correr contra prod.
 */
// sequelize.authenticate() en vez de connectDB(): este script solo lee/escribe
// filas, no necesita sincronizar esquema, y disparar sync() mientras el
// servidor de stress ya está corriendo puede pisarse con un índice recién
// creado (ER_DUP_KEYNAME, bug de entorno de dev ya documentado en el proyecto).
import { sequelize } from '../src/config/db';
import '../src/models/index';
import { Client } from '../src/models/Client';
import { Settings } from '../src/models/Settings';
import { CatalogProduct } from '../src/models/CatalogProduct';
import { CatalogProductSize } from '../src/models/CatalogProductSize';
import { CatalogStockMovement } from '../src/models/CatalogStockMovement';
import { StoreCustomer } from '../src/models/StoreCustomer';
import bcrypt from 'bcrypt';
import { Op } from 'sequelize';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function assertLocalDb(): void {
  const host = process.env.DB_HOST || 'localhost';
  if (process.env.MYSQL_URL || !LOCAL_HOSTS.includes(host.toLowerCase())) {
    console.error(
      `\n🛑 ABORTADO: este script solo puede correr contra una base local (host: ${host}).\n`
    );
    process.exit(1);
  }
}

export const STRESS_CLIENT_NAME = 'Stress Test';
export const STRESS_PRODUCT_COUNT = 300;
export const STRESS_PRODUCT_PREFIX = 'STRESS-';
export const STRESS_RACE_TITLE = 'STRESS-RACE';
export const STRESS_RACE_SIZE = 'U';
export const STRESS_RACE_STOCK = 5;
export const STRESS_CUSTOMER_COUNT = 200;
export const STRESS_CUSTOMER_PASSWORD = 'StressTest123!';
export const STRESS_CUSTOMER_EMAIL = (i: number) => `stress-customer-${i}@example.com`;

const BULK_STOCK = 100_000;
const SIZES = ['S', 'M', 'L'];

async function ensureClient(): Promise<Client> {
  const [client] = await Client.findOrCreate({
    where: { name: STRESS_CLIENT_NAME },
    defaults: { name: STRESS_CLIENT_NAME, notes: 'Cliente dummy para datos de test de carga (backIndians/stress).' },
  });
  return client;
}

async function ensureBankSettings(): Promise<void> {
  // Mismos valores que src/__tests__/setup.ts, para que el checkout por
  // transferencia no rechace por BR-STORE-010 (falta CBU/alias).
  const rows: Array<[string, string]> = [
    ['bank_transfer_cbu', '0000003100010000000001'],
    ['bank_transfer_alias', 'INDIANS.QA.TEST'],
    ['bank_transfer_holder', 'Indians Textil (entorno de pruebas)'],
  ];
  const now = new Date();
  for (const [key, value] of rows) {
    const existing = await Settings.findByPk(key);
    if (!existing) {
      await Settings.upsert({ key, value, createdAt: now, updatedAt: now });
    }
  }
}

async function ensureBulkProducts(client: Client): Promise<void> {
  let created = 0;
  for (let i = 1; i <= STRESS_PRODUCT_COUNT; i++) {
    const title = `${STRESS_PRODUCT_PREFIX}${i}`;
    const [product, wasCreated] = await CatalogProduct.findOrCreate({
      where: { title },
      defaults: {
        client_id: client.id,
        title,
        price: 10000 + i,
        active: true,
        show_in_store: true,
        category: 'Stress',
        gender: 'unisex',
      },
    });
    if (wasCreated) created++;

    for (const size of SIZES) {
      await CatalogProductSize.findOrCreate({
        where: { product_id: product.id, size_name: size },
        defaults: {
          product_id: product.id,
          size_name: size,
          stock_quantity: BULK_STOCK,
          stock_reserved: 0,
        },
      });
    }
  }
  console.log(`  ✅ Productos STRESS-*: ${created} creados, ${STRESS_PRODUCT_COUNT - created} ya existían (${STRESS_PRODUCT_COUNT} total, ${SIZES.length} talles c/u, stock ${BULK_STOCK})`);
}

async function ensureRaceProduct(client: Client): Promise<void> {
  const [product] = await CatalogProduct.findOrCreate({
    where: { title: STRESS_RACE_TITLE },
    defaults: {
      client_id: client.id,
      title: STRESS_RACE_TITLE,
      price: 5000,
      active: true,
      show_in_store: true,
      category: 'Stress',
    },
  });

  await CatalogProductSize.findOrCreate({
    where: { product_id: product.id, size_name: STRESS_RACE_SIZE },
    defaults: {
      product_id: product.id,
      size_name: STRESS_RACE_SIZE,
      stock_quantity: STRESS_RACE_STOCK,
      stock_reserved: 0,
    },
  });

  console.log(`  ✅ Producto de condición de carrera: "${STRESS_RACE_TITLE}" (id=${product.id}, stock=${STRESS_RACE_STOCK})`);
}

async function resetRaceStock(): Promise<void> {
  const product = await CatalogProduct.findOne({ where: { title: STRESS_RACE_TITLE } });
  if (!product) {
    console.error('🛑 No existe STRESS-RACE todavía — corré el seed normal primero.');
    process.exit(1);
  }
  const size = await CatalogProductSize.findOne({ where: { product_id: product.id, size_name: STRESS_RACE_SIZE } });
  if (!size) {
    console.error('🛑 No existe el talle de STRESS-RACE todavía.');
    process.exit(1);
  }
  await size.update({ stock_quantity: STRESS_RACE_STOCK, stock_reserved: 0 });
  await product.update({ stock_quantity: product.stock_quantity, stock_reserved: 0 });
  console.log(`  ✅ Stock de "${STRESS_RACE_TITLE}" repuesto a ${STRESS_RACE_STOCK} (reservado en 0).`);
}

async function ensureCustomers(): Promise<void> {
  const hash = await bcrypt.hash(STRESS_CUSTOMER_PASSWORD, 12);
  let created = 0;
  for (let i = 1; i <= STRESS_CUSTOMER_COUNT; i++) {
    const email = STRESS_CUSTOMER_EMAIL(i);
    const [, wasCreated] = await StoreCustomer.findOrCreate({
      where: { email },
      defaults: {
        email,
        name: `Comprador Stress ${i}`,
        password_hash: hash,
        active: true,
        email_verified: true,
      },
    });
    if (wasCreated) created++;
  }
  console.log(`  ✅ Compradores stress-customer-*: ${created} creados, ${STRESS_CUSTOMER_COUNT - created} ya existían (password: ${STRESS_CUSTOMER_PASSWORD})`);
}

async function cleanup(): Promise<void> {
  const products = await CatalogProduct.findAll({
    where: { title: { [Op.like]: `${STRESS_PRODUCT_PREFIX}%` } },
  });
  const productIds = products.map((p) => p.id);

  if (productIds.length > 0) {
    await CatalogStockMovement.destroy({ where: { catalog_product_id: { [Op.in]: productIds } } });
  }

  let deletedProducts = 0;
  let skippedProducts = 0;
  for (const product of products) {
    try {
      await CatalogProductSize.destroy({ where: { product_id: product.id } });
      await product.destroy();
      deletedProducts++;
    } catch (err) {
      skippedProducts++;
      console.warn(`  ⚠️  No se pudo borrar "${product.title}" (probablemente tiene pedidos asociados): ${(err as Error).message}`);
    }
  }

  const [deletedCustomers] = await StoreCustomer.destroy({
    where: { email: { [Op.like]: 'stress-customer-%@example.com' } },
  }).then((n) => [n]);

  console.log(`\n🧹 Cleanup: ${deletedProducts} productos borrados, ${skippedProducts} con pedidos asociados (no se tocaron), ${deletedCustomers} compradores borrados.`);
  if (skippedProducts > 0) {
    console.log('   Para limpiar del todo (incluidos los pedidos de prueba), corré `npm run db:reset`.');
  }
}

async function main() {
  assertLocalDb();
  await sequelize.authenticate();

  const args = process.argv.slice(2);

  if (args.includes('--cleanup')) {
    await cleanup();
    process.exit(0);
  }

  if (args.includes('--reset-race-stock')) {
    await resetRaceStock();
    process.exit(0);
  }

  console.log('\n📦 Sembrando datos de volumen para el test de estrés...\n');
  const client = await ensureClient();
  await ensureBankSettings();
  await ensureBulkProducts(client);
  await ensureRaceProduct(client);
  await ensureCustomers();
  console.log('\n🎉 Listo. Datos de estrés disponibles.\n');
  process.exit(0);
}

// Guard: otros scripts (verify-race-integrity.ts) importan las constantes de
// este archivo sin querer ejecutar el seed — sin este guard, cada import
// disparaba todo main() de nuevo como efecto secundario.
if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Error sembrando datos de estrés:', err);
    process.exit(1);
  });
}
