/**
 * Amplía el ENUM de `users.role` con el valor `designer` en la DB de desarrollo
 * / test, sin correr todo el juego de migraciones ni un `sync()` completo.
 *
 * En dev la base se sincroniza al levantar el server (`sequelize.sync()`), pero
 * `sync()` no altera ENUMs existentes y los tests corren contra la app sin
 * levantarla. Espeja la migración 107 y el bloque de `ensureSchema.ts`.
 */
import { sequelize } from '../src/config/db';

async function main() {
  await sequelize.authenticate();
  const qi = sequelize.getQueryInterface();
  const users = await qi.describeTable('users');
  if (JSON.stringify(users.role ?? {}).includes('designer')) {
    console.log('users.role ya incluye "designer" — nada que hacer.');
  } else {
    await sequelize.query(
      "ALTER TABLE users MODIFY COLUMN role " +
      "ENUM('admin','billing','workshop','seller','designer') NOT NULL DEFAULT 'workshop'"
    );
    console.log('users.role ampliado con "designer".');
  }
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
