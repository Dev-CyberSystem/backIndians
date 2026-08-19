// Verificación de un dump de MySQL comprimido (.sql.gz).
//
// Por qué existe (R-01 de la auditoría del 2026-08-19): el backup tomado antes
// del TRUNCATE de ~40 tablas productivas quedó truncado —descomprimía 142 KB,
// cortaba a mitad de un INSERT y le faltaban 9 tablas, entre ellas
// `store_orders` y `users`— y `db-backup.mjs` lo dio por bueno. Los tres
// controles que tenía no alcanzaban: el `pipeline` resolvió limpio (cuando
// mysqldump muere, su stdout se cierra y la pipeline termina sin error),
// mysqldump no devolvió un código distinto de cero, y el archivo superó el
// piso de tamaño.
//
// Un backup roto que se conserva es peor que ninguno: `db:restore` y
// `rollback` lo listan como válido y alguien confía en él justo cuando más
// importa. Estas tres comprobaciones son lo único que distingue un dump
// completo de uno cortado:
//
//   1. el gzip descomprime entero (un archivo truncado lanza Z_BUF_ERROR);
//   2. el SQL termina con el trailer `-- Dump completed on`, que mysqldump
//      escribe recién al final;
//   3. la cantidad de tablas volcadas llega al piso esperado.
//
// Vive en su propio módulo, sin dependencias del resto del release, para poder
// probarse contra archivos armados a mano sin base de datos real.
//
// Es .cjs y no .mjs a propósito, aunque el resto de scripts/release/ sea ESM:
// así lo pueden consumir los dos lados sin duplicar la lógica ni prender flags.
// `db-backup.mjs` lo importa como ESM (Node resuelve los named exports de un
// CJS sin problema) y la suite de Jest lo requiere directo — con .mjs, el test
// necesitaría --experimental-vm-modules para hacer un import() dinámico.

const { createReadStream } = require('node:fs');
const { createGunzip } = require('node:zlib');

/** Marca que mysqldump escribe una vez por tabla volcada. */
const TABLE_MARKER = '-- Table structure for table';

/** Trailer que mysqldump escribe recién cuando terminó de volcar todo. */
const DUMP_TRAILER = '-- Dump completed on';

/**
 * Piso de tablas por defecto. La base tiene ~50; un dump con menos de 40 ya es
 * sospechoso. Se puede ajustar con BACKUP_MIN_TABLES sin tocar código (por
 * ejemplo, para un dump parcial deliberado).
 */
const DEFAULT_MIN_TABLES = 40;

function resolveMinTables(env = process.env) {
  const raw = parseInt(env.BACKUP_MIN_TABLES ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_TABLES;
}

/**
 * Recorre el .sql.gz en streaming (los dumps pueden ser grandes; no se carga
 * entero en memoria) y devuelve lo que hace falta para decidir si sirve.
 *
 * `carry` mantiene el final de cada chunk para que una marca partida entre dos
 * chunks no se pierda — sin eso el conteo de tablas sería sistemáticamente bajo
 * y variable entre corridas.
 */
async function inspectDump(file) {
  let tables = 0;
  let tail = '';
  let carry = '';
  const overlap = TABLE_MARKER.length - 1;

  const source = createReadStream(file);
  const stream = source.pipe(createGunzip());
  try {
    for await (const chunk of stream) {
      const text = carry + chunk.toString('utf8');
      let from = 0;
      for (;;) {
        const at = text.indexOf(TABLE_MARKER, from);
        if (at === -1) break;
        tables++;
        from = at + TABLE_MARKER.length;
      }
      carry = text.slice(-overlap);
      tail = (tail + text).slice(-4096);
    }
  } catch (err) {
    // zlib corta acá cuando el gzip está incompleto: es exactamente el caso
    // que dejó pasar el backup pre-limpieza.
    return { ok: false, truncated: true, tables, error: err.message };
  } finally {
    // Sin esto, un gzip roto deja el descriptor del archivo abierto: en Windows
    // eso impide borrarlo o reemplazarlo después (justo lo que db-backup.mjs
    // hace cuando la verificación falla).
    stream.destroy();
    source.destroy();
  }

  return { ok: true, truncated: false, tables, tail };
}

/**
 * Verifica un dump comprimido. Devuelve `{ ok, tables, problems }` — nunca
 * lanza ni borra nada: quien llama decide qué hacer (db-backup.mjs borra el
 * archivo y aborta).
 */
async function verifyDump(file, { minTables = resolveMinTables() } = {}) {
  const problems = [];
  const info = await inspectDump(file);

  if (info.truncated) {
    problems.push(`el archivo gzip está truncado o corrupto (${info.error})`);
    return { ok: false, tables: info.tables, problems };
  }

  if (!info.tail.includes(DUMP_TRAILER)) {
    problems.push(
      `el dump no termina con "${DUMP_TRAILER}" — mysqldump lo escribe recién al final, así que falta contenido`
    );
  }

  if (info.tables < minTables) {
    problems.push(
      `sólo se volcaron ${info.tables} tablas y se esperaban al menos ${minTables} ` +
        '(ajustable con BACKUP_MIN_TABLES si el recorte es deliberado)'
    );
  }

  return { ok: problems.length === 0, tables: info.tables, problems };
}


module.exports = { DUMP_TRAILER, DEFAULT_MIN_TABLES, resolveMinTables, inspectDump, verifyDump };
