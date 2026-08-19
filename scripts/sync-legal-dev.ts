/**
 * Crea en la DB de desarrollo las tablas y columnas que agregan las migraciones
 * 096-098 (legales), sin correr todo el juego de migraciones ni un `sync()`
 * completo del esquema.
 *
 * En dev la base se sincroniza al levantar el server (`sequelize.sync()`), pero
 * los tests corren contra la app sin levantarlo: este script deja la DB de test
 * al día en un solo paso.
 */
import { sequelize } from '../src/config/db';
import { LegalAcceptance } from '../src/models/LegalAcceptance';
import { StoreWithdrawalRequest } from '../src/models/StoreWithdrawalRequest';
import { ensureLegalSchema } from '../src/config/ensureSchema';

async function main() {
  await sequelize.authenticate();
  await LegalAcceptance.sync();
  await StoreWithdrawalRequest.sync();
  await ensureLegalSchema();
  console.log('Tablas legales sincronizadas.');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
