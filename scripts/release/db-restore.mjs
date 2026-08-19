// Restaurar un backup de base generado por db-backup.mjs.
//
// Es la operación más destructiva del repo: pisa el contenido de una base
// entera. Por eso pide confirmación escribiendo el nombre de la base, y antes
// de tocar producción saca un backup de seguridad de lo que está por reemplazar
// (si el restore es el error, ese dump es la única vuelta atrás).
//
// Uso:
//   node scripts/release/db-restore.mjs                      # lista los backups disponibles
//   node scripts/release/db-restore.mjs <archivo.sql.gz>     # restaura a la base LOCAL (default)
//   node scripts/release/db-restore.mjs <archivo> --target=prod
//
// El destino por defecto es LOCAL a propósito: probar el restore contra la base
// de desarrollo verifica que el backup sirve sin arriesgar producción.

import { createReadStream, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_DIR,
  BACK_DIR,
  abort,
  c,
  confirm,
  loadReleaseEnv,
  log,
  parseArgs,
} from './lib.mjs';
import { backupDatabase, parseMysqlUrl, resolveMysqldump } from './db-backup.mjs';

/** El cliente `mysql` vive junto a `mysqldump`: se reusa esa resolución. */
function resolveMysqlClient() {
  if (process.env.MYSQL_CLIENT_PATH) return process.env.MYSQL_CLIENT_PATH;
  const dump = resolveMysqldump();
  if (dump === 'mysqldump') return 'mysql';
  return dump.replace(/mysqldump(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'mysql.exe' : 'mysql'));
}

function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql.gz'))
    .map((f) => {
      const full = path.join(BACKUP_DIR, f);
      return { name: f, path: full, ...statSync(full) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function printBackups() {
  const backups = listBackups();
  if (!backups.length) {
    log.warn('No hay backups en .releases/db/');
    log.info('Generá uno con: npm run db:backup');
    return;
  }
  log.step(`Backups disponibles (${BACKUP_DIR})`);
  for (const b of backups) {
    const mb = (b.size / 1024 / 1024).toFixed(2).padStart(8);
    log.plain(`  ${mb} MB  ${b.mtime.toLocaleString('es-AR')}  ${c.bold(b.name)}`);
  }
  log.plain(`\n${c.dim('Restaurar: npm run db:restore -- <archivo> [--target=prod]')}`);
}

/** Config de conexión del destino elegido. */
function resolveTarget(target) {
  loadReleaseEnv();
  if (target === 'prod') {
    const raw = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
    if (!raw) abort('Falta MYSQL_PUBLIC_URL', 'Definila en backIndians/.env.release para poder tocar producción.');
    return { ...parseMysqlUrl(raw), label: 'PRODUCCIÓN' };
  }
  // Desarrollo: mismas variables que config/sequelize.js
  const dotenvPath = path.join(BACK_DIR, '.env');
  if (existsSync(dotenvPath)) {
    for (const line of readFileSync(dotenvPath, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || '3306',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'textil_db',
    label: 'desarrollo (local)',
  };
}

function writeDefaultsFile(conn) {
  const file = path.join(os.tmpdir(), `indians-restore-${process.pid}-${Date.now()}.cnf`);
  writeFileSync(
    file,
    ['[client]', `host=${conn.host}`, `port=${conn.port}`, `user=${conn.user}`, `password="${conn.password}"`, ''].join('\n'),
    { mode: 0o600 }
  );
  return file;
}

async function restore(file, conn) {
  const bin = resolveMysqlClient();
  const defaultsFile = writeDefaultsFile(conn);
  const started = Date.now();

  try {
    const child = spawn(bin, [`--defaults-extra-file=${defaultsFile}`, '--default-character-set=utf8mb4', conn.database], {
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const exited = new Promise((resolve, reject) => {
      child.on('error', (err) =>
        reject(
          new Error(
            err.code === 'ENOENT'
              ? `No se encontró el cliente mysql (${bin}). Definí MYSQL_CLIENT_PATH.`
              : err.message
          )
        )
      );
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`mysql terminó con código ${code}\n${stderr.trim()}`))
      );
    });

    await pipeline(createReadStream(file), createGunzip(), child.stdin);
    await exited;
  } finally {
    if (existsSync(defaultsFile)) unlinkSync(defaultsFile);
  }

  log.ok(`Restore completo en ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const target = flags.target === 'prod' ? 'prod' : 'local';

  if (!positional.length) {
    printBackups();
    return;
  }

  // Acepta ruta completa o sólo el nombre del archivo dentro de .releases/db/
  const candidate = positional[0];
  const file = existsSync(candidate) ? candidate : path.join(BACKUP_DIR, candidate);
  if (!existsSync(file)) {
    abort(`No existe el backup: ${candidate}`, 'Corré `npm run db:restore` sin argumentos para ver la lista.');
  }

  const conn = resolveTarget(target);
  const sizeMb = (statSync(file).size / 1024 / 1024).toFixed(2);

  log.step('Restore de base de datos');
  log.info(`archivo : ${path.basename(file)} (${sizeMb} MB)`);
  log.info(`destino : ${conn.database} @ ${conn.host}:${conn.port}`);
  log.plain(`\n  ${c.red(c.bold(`Esto REEMPLAZA el contenido actual de ${conn.label}.`))}`);

  if (target === 'prod') {
    log.warn('Antes de restaurar se saca un backup de seguridad del estado actual.');
  }

  const ok = await confirm(`Confirmá escribiendo el nombre de la base a sobrescribir:`, { expect: conn.database });
  if (!ok) {
    log.fail('Cancelado: el nombre no coincide.');
    process.exit(1);
  }

  if (target === 'prod') {
    log.step('Backup de seguridad del estado actual (antes de pisarlo)');
    await backupDatabase({ tag: 'pre-restore' });
  }

  log.step('Restaurando');
  await restore(file, conn);

  if (target === 'prod') {
    log.plain(`\n${c.yellow('Verificá el sistema en producción ahora:')}`);
    log.plain('  - https://sistema.indians.com.ar/login responde y permite entrar');
    log.plain('  - la tienda lista productos');
    log.plain('  - el estado de las migraciones: npx sequelize-cli db:migrate:status --env production');
  }
}

main().catch((err) => abort(err.message));
