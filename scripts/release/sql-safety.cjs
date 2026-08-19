// Detección de sentencias destructivas en un archivo .sql.
//
// Por qué existe (R-05 de la auditoría del 2026-08-19): `db-query.mjs` decía en
// su primera línea "Corre un archivo .sql de SOLO LECTURA contra la base de
// PRODUCCIÓN" y no tenía nada que lo restringiera — pasaba el archivo entero al
// cliente mysql por stdin. De hecho fue la herramienta con la que se ejecutó el
// TRUNCATE de ~40 tablas productivas. El nombre y el encabezado generaban una
// confianza que el código no respaldaba.
//
// La respuesta no es prohibir lo destructivo (hace falta: limpiezas, parches
// puntuales), es que quien lo corre lo vea venir. Este módulo clasifica las
// sentencias para que `db-exec.mjs` pueda mostrarlas y pedir confirmación
// explícita antes de tocar nada.
//
// Es .cjs por el mismo motivo que verify-dump.cjs: así lo importan igual el
// script ESM del release y la suite de Jest, sin duplicar la lógica.

/** Verbos que modifican datos o estructura. Todo lo demás se considera lectura. */
const DESTRUCTIVE_VERBS = [
  'TRUNCATE',
  'DROP',
  'DELETE',
  'UPDATE',
  'ALTER',
  'INSERT',
  'REPLACE',
  'RENAME',
  'CREATE',
  'GRANT',
  'REVOKE',
];

/**
 * Saca comentarios y literales de texto antes de buscar verbos.
 *
 * Sin esto, un `SELECT * FROM logs WHERE msg = 'DROP TABLE'` se reportaría como
 * destructivo y un `-- DELETE ...` comentado también: falsos positivos que
 * entrenan a quien lo usa a confirmar sin leer, que es peor que no preguntar.
 */
function stripNoise(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--' || sql[i] === '#') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    const quote = sql[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === quote) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/**
 * Devuelve las sentencias destructivas encontradas, ya normalizadas y recortadas
 * para poder mostrarlas en pantalla.
 */
function findDestructiveStatements(sql) {
  const clean = stripNoise(String(sql ?? ''));
  const found = [];
  for (const raw of clean.split(';')) {
    const statement = raw.replace(/\s+/g, ' ').trim();
    if (!statement) continue;
    const verb = statement.split(' ')[0].toUpperCase();
    if (DESTRUCTIVE_VERBS.includes(verb)) {
      found.push(statement.length > 120 ? `${statement.slice(0, 117)}...` : statement);
    }
  }
  return found;
}

/** `true` si el archivo no toca nada (solo SELECT/SHOW/EXPLAIN/SET/USE…). */
function isReadOnly(sql) {
  return findDestructiveStatements(sql).length === 0;
}

module.exports = { DESTRUCTIVE_VERBS, stripNoise, findDestructiveStatements, isReadOnly };
