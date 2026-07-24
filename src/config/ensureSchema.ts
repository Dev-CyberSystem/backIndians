import { DataTypes } from 'sequelize';
import { sequelize } from './db';
import { logger } from '../utils/logger';

/**
 * Asegura de forma idempotente las columnas que agregan las migraciones sobre
 * tablas ya existentes. Necesario en desarrollo, donde la DB se sincroniza con
 * `sequelize.sync()` (crea tablas faltantes pero NO altera tablas existentes).
 * En producción (ya migrada) es no-op: las columnas ya existen.
 */
export async function ensureSchema(): Promise<void> {
  const qi = sequelize.getQueryInterface();

  try {
    const garmentTypes = await qi.describeTable('garment_types');

    if (!garmentTypes.cost_category) {
      await qi.addColumn('garment_types', 'cost_category', {
        type: DataTypes.ENUM('jersey', 'shorts'),
        allowNull: true,
        defaultValue: null,
      });
      logger.info('ensureSchema.addColumn', { meta: { table: 'garment_types', column: 'cost_category' } });
    }

    if (!garmentTypes.client_id) {
      await qi.addColumn('garment_types', 'client_id', {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      });
      logger.info('ensureSchema.addColumn', { meta: { table: 'garment_types', column: 'client_id' } });
    }

    // Con el modelo por-cliente el nombre NO debe ser único global (dos clientes
    // pueden tener "Camiseta"). Elimina el índice único heredado sobre `name`.
    try {
      const indexes = (await qi.showIndex('garment_types')) as Array<{
        name: string; unique: boolean; fields?: Array<{ attribute: string }>;
      }>;
      const nameUnique = indexes.find(
        (ix) => ix.unique && (ix.fields?.length ?? 0) === 1 && ix.fields?.[0]?.attribute === 'name'
      );
      if (nameUnique) {
        await qi.removeIndex('garment_types', nameUnique.name);
        logger.info('ensureSchema.removeIndex', { meta: { table: 'garment_types', index: nameUnique.name } });
      }
    } catch (e) {
      logger.error('ensureSchema.removeNameUnique', e, { meta: { fatal: false } });
    }
  } catch (err) {
    // No es fatal: en un entorno ya migrado esto no hace falta.
    logger.error('ensureSchema.failed', err, { meta: { fatal: false } });
  }
}
