// Corre un archivo .sql contra la base de PRODUCCIÓN y muestra el resultado por
// consola. Ejecuta lo que le pasen: consultas de lectura y también DDL/DML.
//
// Se llamaba db-query.mjs y su primera línea decía "SOLO LECTURA" — no había
// nada que lo restringiera, y de hecho fue la herramienta con la que se ejecutó
// el TRUNCATE de ~40 tablas productivas del 2026-08-19 (R-05 de la auditoría de
// ese día). Se renombró para que el nombre diga la verdad, y desde entonces
// exige confirmación explícita cuando el archivo contiene sentencias que
// modifican datos o estructura: muestra cuáles son y contra qué base, y pide
// escribir el nombre de la base para seguir.
//
// Uso:
//   node scripts/release/db-exec.mjs ruta/al/archivo.sql [--yes]
//
// --yes salta la confirmación (invocación no interactiva deliberada, mismo
// criterio que release.mjs). No lo uses "para no tener que escribir el nombre":
// esa confirmación es el único momento en que alguien mira la lista de lo que
// está por correr.
//
// Reusa las mismas credenciales que db-backup.mjs (MYSQL_PUBLIC_URL en
// .env.release) y el mismo truco de --defaults-extra-file para no dejar la
// clave de producción visible en la lista de procesos ni en el historial de
// la shell.

import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { abort, c, confirm, loadReleaseEnv, log, parseArgs } from './lib.mjs';
import { parseMysqlUrl } from './db-backup.mjs';
import { findDestructiveStatements } from './sql-safety.cjs';

/** Ubicaciones habituales del cliente `mysql` en Windows, además del PATH. */
const MYSQL_CANDIDATES = [
  process.env.MYSQL_CLI_PATH,
  'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe',
  'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  'C:/xampp/mysql/bin/mysql.exe',
  'C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysql.exe',
].filter(Boolean);

function resolveMysql() {
  for (const candidate of MYSQL_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return 'mysql';
}

function writeDefaultsFile(conn) {
  const file = path.join(os.tmpdir(), `indians-exec-${process.pid}-${Date.now()}.cnf`);
  writeFileSync(
    file,
    ['[client]', `host=${conn.host}`, `port=${conn.port}`, `user=${conn.user}`, `password="${conn.password}"`, ''].join('\n'),
    { mode: 0o600 }
  );
  return file;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const sqlFile = positional[0];
  if (!sqlFile || !existsSync(sqlFile)) {
    abort('Falta el archivo .sql o no existe', 'Uso: node scripts/release/db-exec.mjs ruta/al/archivo.sql [--yes]');
  }

  loadReleaseEnv();
  const raw = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;
  if (!raw) {
    abort(
      'Falta MYSQL_PUBLIC_URL para conectarse a la base de producción',
      'Necesitás backIndians/.env.release con MYSQL_PUBLIC_URL=mysql://... (el mismo archivo que usa db:backup).'
    );
  }

  const conn = parseMysqlUrl(raw);
  const sql = readFileSync(sqlFile, 'utf8');

  // La confirmación va ANTES de escribir el archivo de credenciales: si el
  // usuario dice que no, no queda un .cnf con la clave de producción dando
  // vueltas en %TEMP%.
  const destructive = findDestructiveStatements(sql);
  if (destructive.length > 0) {
    log.warn(
      `${path.basename(sqlFile)} contiene ${destructive.length} sentencia(s) que MODIFICAN la base ` +
        `${c.bold(conn.database)} @ ${conn.host}:${conn.port}`
    );
    const preview = destructive.slice(0, 20);
    for (const statement of preview) console.log(`     ${c.yellow(statement)};`);
    if (destructive.length > preview.length) {
      console.log(`     ${c.dim(`… y ${destructive.length - preview.length} más`)}`);
    }

    if (flags.yes) {
      log.info('Confirmado por --yes (invocación no interactiva).');
    } else {
      const ok = await confirm(
        `Esto NO se puede deshacer sin restaurar un backup. ¿Ejecutar contra ${c.bold(conn.database)}?`,
        { expect: conn.database }
      );
      if (!ok) abort('Cancelado: no se ejecutó nada.');
    }
  }

  const mysqlBin = resolveMysql();
  const defaultsFile = writeDefaultsFile(conn);

  log.step(`Ejecutando ${path.basename(sqlFile)} contra ${conn.database} @ ${conn.host}:${conn.port}`);

  try {
    const res = spawnSync(mysqlBin, [`--defaults-extra-file=${defaultsFile}`, '--table', conn.database], {
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.error) {
      abort(
        res.error.code === 'ENOENT'
          ? `No se encontró mysql (${mysqlBin}). Definí MYSQL_CLI_PATH apuntando al ejecutable.`
          : res.error.message
      );
    }
    if (res.stdout) console.log(res.stdout);
    if (res.status !== 0) abort(`mysql terminó con código ${res.status}`, res.stderr);
    log.ok(destructive.length > 0 ? 'Ejecución terminada.' : 'Consulta terminada.');
  } finally {
    if (existsSync(defaultsFile)) unlinkSync(defaultsFile);
  }
}

// Ejecutable directo: `node scripts/release/db-exec.mjs archivo.sql`.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  // main() es async desde que hay confirmación: sin el catch, un rechazo
  // inesperado saldría como UnhandledPromiseRejection y el mensaje útil se
  // perdería entre el stack trace.
  main().catch((err) => abort(err.message));
}
