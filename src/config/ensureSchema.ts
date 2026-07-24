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

    // Unicidad por cliente: no se permite el mismo nombre de prenda dentro del
    // mismo cliente (pero sí entre clientes distintos).
    try {
      const indexes = (await qi.showIndex('garment_types')) as Array<{
        name: string; unique: boolean; fields?: Array<{ attribute: string }>;
      }>;
      const hasComposite = indexes.some(
        (ix) => ix.unique && (ix.fields?.length ?? 0) === 2
          && !!ix.fields?.some((f) => f.attribute === 'client_id')
          && !!ix.fields?.some((f) => f.attribute === 'name')
      );
      if (!hasComposite) {
        await qi.addConstraint('garment_types', {
          fields: ['client_id', 'name'],
          type: 'unique',
          name: 'uq_garment_types_client_name',
        });
        logger.info('ensureSchema.addConstraint', { meta: { table: 'garment_types', constraint: 'uq_garment_types_client_name' } });
      }
    } catch (e) {
      logger.error('ensureSchema.addClientNameUnique', e, { meta: { fatal: false } });
    }
  } catch (err) {
    // No es fatal: en un entorno ya migrado esto no hace falta.
    logger.error('ensureSchema.failed', err, { meta: { fatal: false } });
  }

  // ─── Seguimiento de pedidos de la tienda (migración 066) ────────────────────
  try {
    const storeOrders = await qi.describeTable('store_orders');

    // ENUM ampliado con delayed/returned (sync() no altera ENUMs existentes)
    await qi.sequelize.query(`
      ALTER TABLE store_orders
      MODIFY COLUMN status
      ENUM('pending_payment','paid','processing','review','awaiting_courier','shipped','delivered','cancelled','delayed','returned')
      NOT NULL DEFAULT 'pending_payment'
    `);

    if (!storeOrders.tracking_token) {
      await qi.addColumn('store_orders', 'tracking_token', {
        type: DataTypes.STRING(64),
        allowNull: true,
      });
      await qi.addIndex('store_orders', ['tracking_token'], {
        name: 'uq_store_orders_tracking_token',
        unique: true,
      });
      logger.info('ensureSchema.addColumn', { meta: { table: 'store_orders', column: 'tracking_token' } });
    }

    if (!storeOrders.tracking_token_expires_at) {
      await qi.addColumn('store_orders', 'tracking_token_expires_at', {
        type: DataTypes.DATE,
        allowNull: true,
      });
      logger.info('ensureSchema.addColumn', { meta: { table: 'store_orders', column: 'tracking_token_expires_at' } });
    }

    // Setting de vencimiento del link (default 30 días)
    const [settingRows] = await qi.sequelize.query(
      "SELECT `key` FROM settings WHERE `key` = 'tracking_link_expiry_days' LIMIT 1"
    );
    if (!(settingRows as unknown[]).length) {
      const now = new Date();
      await qi.bulkInsert('settings', [{
        key: 'tracking_link_expiry_days',
        value: '30',
        createdAt: now,
        updatedAt: now,
      }]);
      logger.info('ensureSchema.seedSetting', { meta: { key: 'tracking_link_expiry_days' } });
    }
  } catch (err) {
    logger.error('ensureSchema.storeTracking', err, { meta: { fatal: false } });
  }
}
