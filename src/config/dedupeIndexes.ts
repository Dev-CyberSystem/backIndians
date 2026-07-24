import { sequelize } from './db';
import { logger } from '../utils/logger';

/*
 * Elimina índices DUPLICADOS acumulados en desarrollo. `sequelize.sync()` puede
 * re-crear índices únicos/FK en cada arranque para tablas con referencias
 * cíclicas (ej. store_customers.email → email_2, email_3, ...), llegando al
 * límite de MySQL de 64 índices por tabla. Se corre ANTES de sync() en dev, así
 * la cantidad de índices se mantiene acotada. No-op en prod (migraciones).
 */

interface IndexRow {
  Key_name: string;
  Column_name: string;
  Seq_in_index: number;
  Non_unique: number;
}

const NUMBERED = /_\d+$/;

export async function dedupeIndexes(): Promise<void> {
  const qi = sequelize.getQueryInterface();
  try {
    const [tables] = (await sequelize.query(
      "SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
    )) as [{ t: string }[], unknown];

    for (const { t } of tables) {
      let rows: IndexRow[];
      try {
        rows = (await sequelize.query(`SHOW INDEX FROM \`${t}\``))[0] as unknown as IndexRow[];
      } catch {
        continue;
      }

      // Agrupa columnas por índice
      const idx = new Map<string, { cols: string[]; nonUnique: number }>();
      for (const r of rows) {
        const g = idx.get(r.Key_name) ?? { cols: [], nonUnique: r.Non_unique };
        g.cols[r.Seq_in_index - 1] = r.Column_name;
        idx.set(r.Key_name, g);
      }

      // Agrupa índices por "firma" (unicidad + columnas)
      const bySig = new Map<string, string[]>();
      for (const [name, g] of idx) {
        if (name === 'PRIMARY') continue;
        const sig = `${g.nonUnique}|${g.cols.join(',')}`;
        const arr = bySig.get(sig) ?? [];
        arr.push(name);
        bySig.set(sig, arr);
      }

      // En cada grupo con más de un índice, conserva uno y borra el resto
      for (const names of bySig.values()) {
        if (names.length <= 1) continue;
        const sorted = [...names].sort((a, b) => {
          const na = NUMBERED.test(a), nb = NUMBERED.test(b);
          if (na !== nb) return na ? 1 : -1;            // los "_N" van al final (se borran)
          return a.length - b.length || a.localeCompare(b);
        });
        const drop = sorted.slice(1);
        for (const name of drop) {
          try {
            await qi.removeIndex(t, name);
          } catch (e) {
            // p.ej. índice requerido por una FK: se ignora
            logger.warn('dedupeIndexes.skip', { meta: { table: t, index: name, err: (e as Error).message } });
          }
        }
        if (drop.length) {
          logger.info('dedupeIndexes', { meta: { table: t, kept: sorted[0], dropped: drop.length } });
        }
      }
    }
  } catch (e) {
    logger.error('dedupeIndexes.failed', e, { meta: { fatal: false } });
  }
}
