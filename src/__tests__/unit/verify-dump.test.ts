import { gzipSync } from 'zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  verifyDump,
  resolveMinTables,
  DEFAULT_MIN_TABLES,
} = require('../../../scripts/release/verify-dump.cjs');

/*
 * Verificación de los backups de producción (R-01 de la auditoría del
 * 2026-08-19). El backup tomado antes del TRUNCATE de ~40 tablas productivas
 * quedó truncado y `db-backup.mjs` lo dio por bueno: el pipeline resolvió
 * limpio, mysqldump no devolvió error y el archivo superó el piso de tamaño.
 * Los tres controles que sí lo detectan viven en scripts/release/verify-dump.mjs
 * y se prueban acá contra archivos armados a mano — sin base de datos real.
 */

/** Arma un .sql que se parece a un dump de mysqldump con `tables` tablas. */
function fakeDump(tables: number, { withTrailer = true } = {}): string {
  const parts = ['-- MySQL dump 10.13  Distrib 8.0.36', ''];
  for (let i = 1; i <= tables; i++) {
    parts.push(`-- Table structure for table \`tabla_${i}\``);
    parts.push(`DROP TABLE IF EXISTS \`tabla_${i}\`;`);
    parts.push(`CREATE TABLE \`tabla_${i}\` (\`id\` int NOT NULL);`);
    parts.push(`INSERT INTO \`tabla_${i}\` VALUES (1),(2),(3);`);
    parts.push('');
  }
  if (withTrailer) parts.push('-- Dump completed on 2026-08-19 10:01:00');
  return parts.join('\n');
}

describe('verifyDump — un backup roto no debe darse por bueno (R-01)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'indians-verify-dump-'));
  });

  afterAll(() => {
    // Windows no borra un archivo mientras alguien tenga su descriptor abierto,
    // y los descriptores de los streams se cierran en el tick siguiente al
    // destroy(). No vale la pena hacer fallar la suite por la limpieza de un
    // temporal del sistema: se reintenta y, si igual queda, lo levanta el SO.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* temporal del sistema, no es parte de lo que se está probando */
    }
  });

  function write(name: string, content: Buffer): string {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  it('acepta un dump completo', async () => {
    const file = write('completo.sql.gz', gzipSync(Buffer.from(fakeDump(50), 'utf8')));
    const res = await verifyDump(file);
    expect(res.ok).toBe(true);
    expect(res.tables).toBe(50);
    expect(res.problems).toEqual([]);
  });

  it('rechaza un gzip truncado — el modo de falla exacto del backup pre-limpieza', async () => {
    const full = gzipSync(Buffer.from(fakeDump(50), 'utf8'));
    // Cortar el final es lo que hace un mysqldump que muere a mitad del volcado:
    // el archivo existe, tiene nombre y tamaño plausibles, y no sirve.
    const file = write('truncado.sql.gz', full.subarray(0, Math.floor(full.length * 0.6)));

    const res = await verifyDump(file);
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/truncado o corrupto/);
  });

  it('rechaza un dump que descomprime bien pero no llegó al final (sin trailer)', async () => {
    // Caso sutil: el gzip cierra correcto porque el proceso terminó de escribir,
    // pero mysqldump nunca llegó a volcar todo. Sólo el trailer lo delata.
    const file = write('sin-trailer.sql.gz', gzipSync(Buffer.from(fakeDump(50, { withTrailer: false }), 'utf8')));
    const res = await verifyDump(file);
    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/Dump completed on/);
  });

  it('rechaza un dump al que le faltan tablas', async () => {
    // 41 tablas de 50: exactamente lo que pasó el 2026-08-19 (faltaban
    // store_orders, users, webhook_events y 6 más).
    const file = write('faltan-tablas.sql.gz', gzipSync(Buffer.from(fakeDump(41), 'utf8')));
    const res = await verifyDump(file, { minTables: 50 });
    expect(res.ok).toBe(false);
    expect(res.tables).toBe(41);
    expect(res.problems.join(' ')).toMatch(/41 tablas/);
  });

  it('acumula todos los problemas, no solo el primero', async () => {
    const file = write('doble-problema.sql.gz', gzipSync(Buffer.from(fakeDump(5, { withTrailer: false }), 'utf8')));
    const res = await verifyDump(file, { minTables: 40 });
    expect(res.ok).toBe(false);
    expect(res.problems).toHaveLength(2);
  });

  it('cuenta bien las tablas aunque la marca quede partida entre dos chunks del stream', async () => {
    // El lector es en streaming: sin el solapamiento entre chunks, una marca
    // cortada al medio no se cuenta y el total sale bajo de forma no
    // determinística (depende del tamaño del dump).
    const file = write('grande.sql.gz', gzipSync(Buffer.from(fakeDump(300), 'utf8')));
    const res = await verifyDump(file);
    expect(res.tables).toBe(300);
    expect(res.ok).toBe(true);
  });

  it('un archivo que no es gzip se rechaza en vez de explotar', async () => {
    const file = write('no-es-gzip.sql.gz', Buffer.from('esto no es un gzip', 'utf8'));
    const res = await verifyDump(file);
    expect(res.ok).toBe(false);
  });
});

describe('resolveMinTables — piso configurable', () => {
  it('usa el piso por defecto cuando no hay variable', () => {
    expect(resolveMinTables({})).toBe(DEFAULT_MIN_TABLES);
  });

  it('respeta BACKUP_MIN_TABLES', () => {
    expect(resolveMinTables({ BACKUP_MIN_TABLES: '12' })).toBe(12);
  });

  it('ignora un valor no numérico en vez de quedarse en NaN (que dejaría pasar cualquier dump)', () => {
    expect(resolveMinTables({ BACKUP_MIN_TABLES: 'muchas' })).toBe(DEFAULT_MIN_TABLES);
  });
});
