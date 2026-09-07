// Backup diario de producción. Pensado para correr desde el Programador de
// tareas de Windows (ver install-daily-backup-task.ps1), no a mano.
//
// Reusa `backupDatabase()` de db-backup.mjs —mismo mysqldump + gzip + las tres
// verificaciones de integridad (gzip completo, trailer de mysqldump, cantidad
// de tablas vs. el backup anterior)— y le agrega dos cosas que un backup
// desatendido necesita:
//
//   1. Retención: conserva los últimos N backups `daily-*` (30 por defecto) y
//      borra los más viejos. NUNCA toca los backups de release (`vX.Y.Z-*`).
//
//   2. Rastro: escribe una línea de resultado en `.releases/db/_daily-backup.log`
//      y sale con código != 0 si algo falló, para que el Programador de tareas
//      lo marque como error en "Resultado de la última ejecución".
//
// La carpeta `.releases/db/` vive dentro de OneDrive (el repo está en
// OneDrive\Escritorio\indians), así que cada backup queda además replicado en la
// nube sin pasos extra. Verificá que OneDrive esté sincronizando esa carpeta y
// no la tenga en "solo en la nube" / excluida.
//
// Uso:
//   node scripts/release/db-backup-daily.mjs [--keep=30]

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKUP_DIR, ensureDir, parseArgs } from './lib.mjs';
import { backupDatabase } from './db-backup.mjs';

const LOG_FILE = path.join(BACKUP_DIR, '_daily-backup.log');
const DEFAULT_KEEP = 30;
const LOG_MAX_BYTES = 1024 * 1024; // 1 MB → se recorta a las últimas 200 líneas
const DAILY_RE = /^daily-\d{8}-\d{6}\.sql\.gz$/;

/** Fecha y hora LOCAL (coincide con el timestamp del nombre de archivo). */
function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Agrega una línea al log, recortándolo si creció demasiado. */
function logLine(line) {
  try {
    ensureDir(BACKUP_DIR);
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      const kept = readFileSync(LOG_FILE, 'utf8').split('\n').slice(-200).join('\n');
      writeFileSync(LOG_FILE, kept);
    }
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* el log es best-effort: si falla, queda la salida de consola */
  }
}

/** Borra los backups `daily-*` que sobran, dejando los `keep` más nuevos. */
function pruneOldDailies(keep) {
  let files;
  try {
    files = readdirSync(BACKUP_DIR)
      .filter((f) => DAILY_RE.test(f))
      .map((f) => ({ f, full: path.join(BACKUP_DIR, f), mtime: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
  const removed = [];
  for (const { f, full } of files.slice(keep)) {
    try {
      unlinkSync(full);
      removed.push(f);
    } catch {
      /* si no se puede borrar uno, seguir con el resto */
    }
  }
  return removed;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const keep = Number.isFinite(Number(flags.keep))
    ? Math.max(1, Number(flags.keep))
    : Number(process.env.DAILY_BACKUP_KEEP) || DEFAULT_KEEP;

  const { file, size, tables } = await backupDatabase({ tag: 'daily' });
  const mb = (size / 1024 / 1024).toFixed(2);

  const removed = pruneOldDailies(keep);
  const pruneNote = removed.length ? `, podados ${removed.length} (retención ${keep})` : '';

  logLine(`${ts()}  OK    ${path.basename(file)}  ${mb} MB  ${tables} tablas${pruneNote}`);
  console.log(`\nBackup diario OK: ${path.basename(file)} (${mb} MB, ${tables} tablas)${pruneNote}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  // backupDatabase() puede cortar con process.exit(1) por dentro (abort). Este
  // handler garantiza que SIEMPRE quede una línea en el log, incluso en ese caso.
  let done = false;
  process.on('exit', (code) => {
    if (!done && code !== 0) logLine(`${ts()}  FAIL  backup diario abortó (código ${code}) — ver salida de consola`);
  });

  main()
    .then(() => {
      done = true;
    })
    .catch((err) => {
      done = true;
      logLine(`${ts()}  FAIL  ${err instanceof Error ? err.message : String(err)}`);
      console.error(`\nBackup diario FALLÓ: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
