// Backup de la base de PRODUCCIÓN antes de un release.
//
// Por qué existe: Railway puede volver a un deploy anterior en un click, pero
// eso revierte el CÓDIGO, no la BASE. El `startCommand` de producción corre
// `npm run migrate` en cada deploy, así que para cuando se detecta un problema
// las migraciones nuevas ya se aplicaron y no siempre son reversibles (varias no
// tienen `down` útil, y ninguna puede devolver datos que ya se borraron).
// Este dump es la única red de seguridad real del rollback.
//
// Uso:
//   node scripts/release/db-backup.mjs [--tag=v1.4.0] [--schema-only]
//
// Credenciales: `MYSQL_PUBLIC_URL` (la misma variable que usa el entorno de
// producción de config/sequelize.js; la pública funciona desde afuera de
// Railway). Ponela en `backIndians/.env.release` — ese archivo NO se commitea.

import { createWriteStream, existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BACKUP_DIR,
  abort,
  c,
  ensureDir,
  loadReleaseEnv,
  log,
  parseArgs,
  stamp,
} from './lib.mjs';

/**
 * Piso de tamaño para considerar creíble un dump comprimido. El esquema solo de
 * este proyecto ya son decenas de KB; cualquier cosa por debajo de esto es un
 * dump vacío o truncado, no una base chica.
 */
const MIN_VALID_BACKUP_BYTES = 1024;

/** Ubicaciones habituales de mysqldump en Windows, además del PATH. */
const MYSQLDUMP_CANDIDATES = [
  process.env.MYSQLDUMP_PATH,
  'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe',
  'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe',
  'C:/xampp/mysql/bin/mysqldump.exe',
  'C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysqldump.exe',
].filter(Boolean);

export function resolveMysqldump() {
  for (const candidate of MYSQLDUMP_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  // Último recurso: confiar en el PATH (Linux/Mac, o Windows con MySQL en PATH).
  return 'mysqldump';
}

/**
 * Parsea `mysql://usuario:clave@host:puerto/base`.
 *
 * La clave puede traer caracteres especiales percent-encoded — Railway genera
 * claves con símbolos, y decodificarlas mal produce un "Access denied" que
 * parece un problema de permisos y no lo es.
 */
export function parseMysqlUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    abort('MYSQL_PUBLIC_URL no es una URL válida', 'Formato esperado: mysql://usuario:clave@host:puerto/base');
  }
  const database = url.pathname.replace(/^\//, '');
  if (!database) abort('MYSQL_PUBLIC_URL no incluye el nombre de la base', 'Falta la parte /nombre_de_base al final.');
  return {
    host: url.hostname,
    port: url.port || '3306',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/**
 * Escribe un archivo de credenciales temporal para mysqldump.
 *
 * Pasar `--password=` por línea de comandos deja la clave de producción visible
 * en la lista de procesos de la máquina; `--defaults-extra-file` no.
 */
function writeDefaultsFile(conn) {
  const file = path.join(os.tmpdir(), `indians-dump-${process.pid}-${Date.now()}.cnf`);
  writeFileSync(
    file,
    ['[client]', `host=${conn.host}`, `port=${conn.port}`, `user=${conn.user}`, `password="${conn.password}"`, ''].join('\n'),
    { mode: 0o600 }
  );
  return file;
}

export async function backupDatabase({ tag, schemaOnly = false } = {}) {
  loadReleaseEnv();

  const raw = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
  if (!raw) {
    abort(
      'Falta MYSQL_PUBLIC_URL para conectarse a la base de producción',
      'Creá backIndians/.env.release con MYSQL_PUBLIC_URL=mysql://... (copiala de las variables del proyecto en Railway).'
    );
  }

  const conn = parseMysqlUrl(raw);
  const dumpBin = resolveMysqldump();
  ensureDir(BACKUP_DIR);

  const label = tag ? tag.replace(/^v/, 'v') : 'manual';
  const suffix = schemaOnly ? '-schema' : '';
  const outFile = path.join(BACKUP_DIR, `${label}-${stamp()}${suffix}.sql.gz`);

  log.step(`Backup de producción -> ${path.basename(outFile)}`);
  log.info(`base: ${conn.database} @ ${conn.host}:${conn.port}`);
  log.info(`mysqldump: ${dumpBin}`);

  const defaultsFile = writeDefaultsFile(conn);
  const baseArgs = [
    `--defaults-extra-file=${defaultsFile}`,
    '--single-transaction', // consistencia sin bloquear escrituras en InnoDB
    '--quick',
    '--routines',
    '--triggers',
    '--events',
    '--default-character-set=utf8mb4',
    '--set-gtid-purged=OFF', // el dump se restaura en otra instancia; los GTID de origen molestan
  ];
  if (schemaOnly) baseArgs.push('--no-data');

  const started = Date.now();

  /** Una corrida de mysqldump volcando gzip directo al archivo destino. */
  async function attempt(args) {
    const child = spawn(dumpBin, [...args, conn.database], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const exited = new Promise((resolve, reject) => {
      child.on('error', (err) =>
        reject(
          new Error(
            err.code === 'ENOENT'
              ? `No se encontró mysqldump (${dumpBin}). Definí MYSQLDUMP_PATH apuntando al ejecutable.`
              : err.message
          )
        )
      );
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`mysqldump terminó con código ${code}\n${stderr.trim()}`))
      );
    });

    // `exited` puede rechazar mientras la pipeline todavía corre. Sin un handler
    // adjunto desde el arranque, ese rechazo es "no manejado" y Node mata el
    // proceso ahí mismo: nunca se llega al catch/finally y quedan colgados el
    // .sql.gz truncado y el archivo de credenciales temporal.
    exited.catch(() => {});

    // Si mysqldump muere temprano su stdout se cierra y la pipeline resuelve
    // limpiamente; por eso el veredicto real lo da `exited`, que se espera después.
    await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(outFile));
    await exited;
    return stderr;
  }

  let stderr = '';
  let failure = null;
  try {
    // `--column-statistics=0` hace falta contra servidores viejos, pero el
    // mysqldump de MariaDB ni siquiera conoce la opción: se intenta con ella y
    // se reintenta sin ella si el binario la rechaza.
    try {
      stderr = await attempt([...baseArgs, '--column-statistics=0']);
    } catch (err) {
      if (!/column-statistics|unknown (variable|option)/i.test(err.message)) throw err;
      log.info('mysqldump no soporta --column-statistics, reintentando sin esa opción');
      stderr = await attempt(baseArgs);
    }
  } catch (err) {
    failure = err;
    if (existsSync(outFile)) unlinkSync(outFile); // no dejar un backup truncado que parezca válido
  } finally {
    if (existsSync(defaultsFile)) unlinkSync(defaultsFile);
  }

  // El abort va DESPUÉS del finally, no adentro del catch: `abort` llama a
  // process.exit y eso saltea el finally, dejando en %TEMP% un archivo con la
  // contraseña de producción en texto plano.
  if (failure) abort(`Falló el backup: ${failure.message}`);

  // mysqldump puede salir con código 0 y aun así no haber volcado nada útil.
  // Un archivo así se borra en vez de conservarse: si quedara en la carpeta,
  // `db:restore` y `rollback` lo listarían como un backup válido y alguien
  // podría confiar en él justo cuando más importa.
  const size = statSync(outFile).size;
  if (size < MIN_VALID_BACKUP_BYTES) {
    unlinkSync(outFile);
    abort(
      `El backup quedó sospechosamente chico (${size} bytes) — se descartó`,
      'Casi seguro el dump falló silenciosamente. Revisá credenciales y permisos antes de deployar.'
    );
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log.ok(`Backup listo: ${(size / 1024 / 1024).toFixed(2)} MB en ${seconds}s`);
  log.info(outFile);
  if (stderr.trim()) log.info(`avisos de mysqldump: ${stderr.trim().split('\n')[0]}`);

  return { file: outFile, size };
}

// Ejecutable directo: `node scripts/release/db-backup.mjs`.
// `pathToFileURL` es lo único que compara bien en Windows: `import.meta.url` es
// `file:///C:/...` con tres barras y armarlo a mano da `file://C:/...`, así que
// la comparación ingenua nunca coincide y el script no hace nada.
// `process.argv[1]` no existe en todos los contextos (REPL, `node -e`), y
// pathToFileURL(undefined) lanza: sin la guarda, importar este modulo desde
// uno de esos contextos revienta antes de exportar nada.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  const { flags } = parseArgs(process.argv.slice(2));
  backupDatabase({
    tag: typeof flags.tag === 'string' ? flags.tag : undefined,
    schemaOnly: Boolean(flags['schema-only']),
  }).then(() => {
    console.log(`\n${c.dim('Restaurar este backup: npm run db:restore')}`);
  });
}
