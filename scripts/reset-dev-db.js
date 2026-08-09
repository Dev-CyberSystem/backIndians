#!/usr/bin/env node
/**
 * Resetea la base de DESARROLLO desde cero y la deja lista para probar.
 *
 *   npm run db:reset
 *
 * Hace: DROP + CREATE → migraciones → seeders → compradores de prueba.
 *
 * ─── Por qué recrear en vez de sólo vaciar ──────────────────────────────────
 *
 * Vaciar las tablas (TRUNCATE) NO alcanza. Varias filas que la aplicación
 * necesita las siembran MIGRACIONES DE DATOS, no los seeders: las categorías de
 * caja "Ventas tienda online" (085) y "Cobranzas de facturas" (095), el maestro
 * de ítems de costo (060), los settings de la tienda (034/036/038)… En
 * desarrollo el esquema lo arma `sequelize.sync()` y las migraciones no se
 * re-ejecutan, así que una base vaciada queda sin esas filas y la aplicación se
 * rompe de formas nada obvias: un pedido pagado no puede generar su asiento en
 * caja, la hoja de costos aparece vacía.
 *
 * Se descubrió el 2026-08-09 vaciando la base con TRUNCATE: 22 tests pasaron a
 * fallar. Recrear desde las migraciones deja el entorno igual al de alguien que
 * clona el repo por primera vez, que es justamente lo que se quiere poder
 * reproducir.
 *
 * ─── Seguridad ──────────────────────────────────────────────────────────────
 *
 * Aborta si la base no es local. Nunca debe correr contra producción.
 */
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const mysql = require('mysql2/promise');

const HOST = process.env.DB_HOST || 'localhost';
const NAME = process.env.DB_NAME || 'textil_db';
const LOCAL = ['localhost', '127.0.0.1', '::1'];

function run(label, cmd) {
  console.log(`\n── ${label} ─────────────────────────────────`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

(async () => {
  if (!LOCAL.includes(HOST.toLowerCase()) || process.env.MYSQL_URL) {
    console.error(
      `\n🛑 ABORTADO: la base configurada no es local (host: ${HOST}).\n` +
        `   Este script BORRA la base entera y sólo puede correr contra localhost.\n`
    );
    process.exit(1);
  }

  console.log(`\n⚠️  Se va a BORRAR y recrear la base "${NAME}" en ${HOST}.`);

  const conn = await mysql.createConnection({
    host: HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  await conn.query(`DROP DATABASE IF EXISTS \`${NAME}\``);
  await conn.query(`CREATE DATABASE \`${NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  console.log(`✅ Base "${NAME}" recreada vacía.`);

  run('Migraciones', 'npx sequelize-cli db:migrate');
  run('Seeders (datos de ejemplo + sistema)', 'npm run seed');
  run('Admin', 'npm run seed:admin');
  run('Compradores de prueba', 'npm run seed:store-customers');

  console.log('\n🎉 Base de desarrollo lista.\n');
  console.log('   Panel:      admin@indians.com  / Admin123!');
  console.log('   Compradores: Cliente123!\n');
})().catch((err) => {
  console.error('\n❌ Falló el reset:', err.message);
  process.exit(1);
});
