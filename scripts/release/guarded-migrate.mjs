// Envoltura de `sequelize-cli db:migrate` (y sus variantes de undo) que saca un
// backup ANTES de tocar una base que no sea local.
//
// Por qué existe: `npm run migrate` era `sequelize-cli db:migrate` a secas. El
// backup de producción sólo pasaba dentro de `npm run release`; un `npm run
// migrate` corrido a mano contra Railway (con NODE_ENV=production y la URL
// pública en el entorno) aplicaba migraciones potencialmente destructivas sin
// red de seguridad. Varias migraciones no tienen `down` útil y ninguna puede
// devolver datos borrados: el dump previo es la única vuelta atrás real.
//
// Comportamiento según entorno:
//
//   - Base LOCAL (localhost / 127.0.0.1, sin MYSQL_URL): passthrough directo,
//     sin fricción. Es el caso de todos los días en desarrollo.
//
//   - Base REMOTA + consola NO interactiva: es el deploy de Railway
//     (`startCommand = "npm run migrate && npm start"`). Passthrough tal cual,
//     SIN intentar backup: en el contenedor no hay mysqldump y el disco es
//     efímero. Se comporta exactamente igual que antes de este wrapper.
//
//   - Base REMOTA + consola interactiva: es una persona apuntando a producción
//     desde su máquina. Saca un backup verificado (reusa db-backup.mjs), muestra
//     contra qué host va a migrar y pide confirmar escribiendo el nombre de la
//     base. Si el backup falla, NO migra.
//
// Escape hatch: `npm run migrate:raw` corre sequelize-cli sin ninguna guarda.

import { pathToFileURL } from 'node:url';
import { abort, c, confirm, loadReleaseEnv, log, runLive } from './lib.mjs';
import { backupDatabase } from './db-backup.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

/** Hosts locales conocidos → no es producción, no hace falta backup. */
function hostIsLocal(host) {
  return LOCAL_HOSTS.has((host || '').toLowerCase());
}

/** Saca el host de una URL mysql:// sin reventar si viene mal formada. */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Resuelve a qué base va a pegar sequelize-cli, replicando la lógica de
 * config/sequelize.js (env `production` usa MYSQL_PUBLIC_URL || MYSQL_URL; en
 * otro caso, las DB_* individuales). Devuelve { isRemote, host, dbLabel }.
 */
function resolveTarget() {
  loadReleaseEnv(); // completa MYSQL_PUBLIC_URL desde .env.release si no está en el entorno

  const env = process.env.NODE_ENV || 'development';
  const url = env === 'production' ? process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL : process.env.MYSQL_URL;

  if (url) {
    const host = hostOf(url);
    let db = null;
    try {
      db = new URL(url).pathname.replace(/^\//, '') || null;
    } catch {
      /* ignore */
    }
    return { isRemote: !hostIsLocal(host), host: host || '(desconocido)', dbLabel: db || '(desconocida)' };
  }

  const host = process.env.DB_HOST || 'localhost';
  return { isRemote: !hostIsLocal(host), host, dbLabel: process.env.DB_NAME || 'textil_db' };
}

async function main() {
  // argv: subcomando de sequelize-cli + flags que se pasan tal cual.
  // `npm run migrate` -> [] -> db:migrate. `migrate:undo` pasa 'db:migrate:undo'.
  const passthru = process.argv.slice(2);
  const sub = passthru[0]?.startsWith('db:') ? passthru.shift() : 'db:migrate';

  const { isRemote, host, dbLabel } = resolveTarget();

  const runMigrate = () => {
    // `--no-install`: usa el sequelize-cli que ya está en node_modules (lo hay,
    // es dependencia del proyecto y así lo corría el script viejo). Sin esto,
    // si por lo que sea no lo encuentra, npx intentaría descargarlo de la red
    // —justo en el arranque del deploy de Railway—; mejor que falle fuerte.
    const ok = runLive('npx', ['--no-install', 'sequelize-cli', sub, ...passthru], { cwd: process.cwd() });
    if (!ok) process.exit(1);
  };

  if (!isRemote) {
    // Desarrollo: sin ceremonia.
    runMigrate();
    return;
  }

  if (!process.stdin.isTTY) {
    // Deploy de Railway: mismo comportamiento de siempre, sin backup.
    log.info(`entorno no interactivo + base remota (${host}): ${sub} sin backup previo (deploy).`);
    runMigrate();
    return;
  }

  // Persona apuntando a una base remota desde su máquina.
  log.step('Migración contra una base REMOTA');
  log.plain(`  ${c.yellow('destino')}  ${sub}  ->  ${c.bold(dbLabel)} @ ${c.bold(host)}`);
  log.plain(`  ${c.dim('Se va a sacar un backup verificado antes de aplicar nada.')}`);

  try {
    const { file, tables } = await backupDatabase({ tag: 'pre-migrate' });
    log.ok(`Backup previo listo (${tables} tablas): ${file}`);
  } catch (err) {
    abort(
      `El backup previo falló, no se aplica la migración: ${err instanceof Error ? err.message : String(err)}`,
      'Migrar sin backup contra una base remota es justo lo que este wrapper evita. Revisá la conexión y reintentá.'
    );
  }

  const confirmed = await confirm(
    `Confirmá que querés correr ${c.bold(sub)} contra ${c.bold(dbLabel)} @ ${host}`,
    { expect: dbLabel }
  );
  if (!confirmed) abort('Cancelado. No se aplicó ninguna migración.');

  runMigrate();
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((err) => {
    abort(err instanceof Error ? err.message : String(err));
  });
}
