/**
 * Agrega `clients.active` / `clients.archived_at` (migración 111) a la DB de
 * desarrollo / test sin levantar el server: `sync()` no altera tablas existentes
 * y los tests corren contra la app sin pasar por `ensureSchema()`.
 *
 * Aborta si la base configurada no es local.
 */
import 'dotenv/config';
import { sequelize } from '../src/config/db';
import { ensureSchema } from '../src/config/ensureSchema';

async function main() {
  const host = process.env.MYSQL_URL ? new URL(process.env.MYSQL_URL).hostname : (process.env.DB_HOST || 'localhost');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('Abortado: la base configurada no es local');
  }
  await sequelize.authenticate();
  await ensureSchema();
  const cols = await sequelize.getQueryInterface().describeTable('clients');
  console.log('clients.active:', !!cols.active, '| clients.archived_at:', !!cols.archived_at);
  await sequelize.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
