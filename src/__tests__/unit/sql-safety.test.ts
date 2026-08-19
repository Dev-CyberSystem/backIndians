import { readFileSync } from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  findDestructiveStatements,
  isReadOnly,
} = require('../../../scripts/release/sql-safety.cjs');

/*
 * Detección de SQL destructivo (R-05 de la auditoría del 2026-08-19).
 *
 * `db-query.mjs` decía "SOLO LECTURA" en su primera línea y ejecutaba lo que le
 * pasaran: fue la herramienta con la que se corrió el TRUNCATE de ~40 tablas
 * productivas. Ahora se llama `db-exec.mjs` y pide confirmación explícita
 * cuando detecta sentencias que modifican la base. Esa detección tiene que
 * cumplir dos cosas a la vez: no dejar pasar nada destructivo, y no gritar en
 * falso — un aviso que salta siempre entrena a confirmar sin leer, que es peor
 * que no preguntar.
 */

describe('findDestructiveStatements — lo que modifica la base tiene que verse', () => {
  it.each([
    ['TRUNCATE store_orders;'],
    ['DROP TABLE users;'],
    ['DELETE FROM store_events WHERE id > 0;'],
    ['UPDATE settings SET value = "x" WHERE `key` = "y";'],
    ['ALTER TABLE orders ADD COLUMN foo INT;'],
    ['INSERT INTO settings VALUES ("a", "b");'],
    ['RENAME TABLE a TO b;'],
    ['CREATE TABLE t (id INT);'],
    ['GRANT ALL ON *.* TO fulano;'],
  ])('detecta %s', (sql) => {
    expect(findDestructiveStatements(sql)).toHaveLength(1);
    expect(isReadOnly(sql)).toBe(false);
  });

  it.each([
    ['SELECT * FROM store_orders;'],
    ['SHOW TABLES;'],
    ['EXPLAIN SELECT 1;'],
    ['SET FOREIGN_KEY_CHECKS = 1;'],
    ['USE indians;'],
  ])('no marca %s', (sql) => {
    expect(isReadOnly(sql)).toBe(true);
  });

  it('ignora lo que está comentado — no es lo que se va a ejecutar', () => {
    expect(isReadOnly('-- TRUNCATE users;\nSELECT 1;')).toBe(true);
    expect(isReadOnly('# DROP TABLE users;\nSELECT 1;')).toBe(true);
    expect(isReadOnly('/* DELETE FROM users; */ SELECT 1;')).toBe(true);
  });

  it('ignora los verbos que aparecen dentro de literales de texto', () => {
    // Sin esto, cualquier consulta sobre la tabla de logs dispararía el aviso.
    expect(isReadOnly("SELECT * FROM logs WHERE msg = 'DROP TABLE users';")).toBe(true);
    expect(isReadOnly('SELECT * FROM logs WHERE msg = "TRUNCATE orders";')).toBe(true);
  });

  it('encuentra todas las sentencias, no solo la primera', () => {
    const found = findDestructiveStatements('SELECT 1; TRUNCATE a; SELECT 2; DELETE FROM b;');
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/TRUNCATE a/);
    expect(found[1]).toMatch(/DELETE FROM b/);
  });

  it('recorta las sentencias largas para que la lista siga siendo legible', () => {
    const long = `DELETE FROM t WHERE id IN (${Array.from({ length: 200 }, (_, i) => i).join(',')});`;
    const [statement] = findDestructiveStatements(long);
    expect(statement.length).toBeLessThanOrEqual(120);
    expect(statement.endsWith('...')).toBe(true);
  });

  it('tolera entrada vacía o nula sin romper', () => {
    expect(findDestructiveStatements('')).toEqual([]);
    expect(findDestructiveStatements(null)).toEqual([]);
    expect(findDestructiveStatements(undefined)).toEqual([]);
  });

  it('marca el script real que vació producción el 2026-08-19', () => {
    // La prueba de fuego: el archivo que se corrió con la herramienta "de solo
    // lectura". Se commiteó tal cual se ejecutó, como registro histórico.
    const file = path.resolve(__dirname, '../../../scripts/release/prod-cleanup-2026-08-19.sql');
    const found = findDestructiveStatements(readFileSync(file, 'utf8'));
    expect(found.length).toBeGreaterThan(30);
    expect(found.some((s: string) => /TRUNCATE store_orders/i.test(s))).toBe(true);
  });
});
