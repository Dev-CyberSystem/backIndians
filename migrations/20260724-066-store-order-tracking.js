'use strict';

/**
 * Seguimiento de pedidos de la tienda:
 *  - Amplía el ENUM de status con `delayed` (Demorado) y `returned` (Devuelto).
 *  - Agrega token de seguimiento (link único no adivinable) + su vencimiento.
 *  - Crea la tabla de historial de estados (traza inmutable).
 *  - Siembra el setting `tracking_link_expiry_days` (default 30).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Ampliar el ENUM de status
    await queryInterface.sequelize.query(`
      ALTER TABLE store_orders
      MODIFY COLUMN status
      ENUM('pending_payment','paid','processing','review','awaiting_courier','shipped','delivered','cancelled','delayed','returned')
      NOT NULL DEFAULT 'pending_payment'
    `);

    // 2. Token de seguimiento + vencimiento
    const table = await queryInterface.describeTable('store_orders');

    if (!table.tracking_token) {
      await queryInterface.addColumn('store_orders', 'tracking_token', {
        type: Sequelize.STRING(64),
        allowNull: true,
        after: 'courier_name',
      });
      await queryInterface.addIndex('store_orders', ['tracking_token'], {
        name: 'uq_store_orders_tracking_token',
        unique: true,
      });
    }

    if (!table.tracking_token_expires_at) {
      await queryInterface.addColumn('store_orders', 'tracking_token_expires_at', {
        type: Sequelize.DATE,
        allowNull: true,
        after: 'tracking_token',
      });
    }

    // 3. Historial de estados
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('store_order_status_history')) {
      await queryInterface.createTable('store_order_status_history', {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        store_order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'store_orders', key: 'id' },
          onDelete: 'CASCADE',
        },
        previous_status: {
          type: Sequelize.ENUM('pending_payment','paid','processing','review','awaiting_courier','shipped','delivered','cancelled','delayed','returned'),
          allowNull: true,
        },
        new_status: {
          type: Sequelize.ENUM('pending_payment','paid','processing','review','awaiting_courier','shipped','delivered','cancelled','delayed','returned'),
          allowNull: false,
        },
        note: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        // Admin/billing que hizo el cambio. NULL = cambio automático del sistema
        // (webhook de pago).
        changed_by: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onDelete: 'SET NULL',
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      });
      await queryInterface.addIndex('store_order_status_history', ['store_order_id'], {
        name: 'idx_store_order_status_history_order',
      });
    }

    // 4. Setting de vencimiento del link (default 30 días)
    const [rows] = await queryInterface.sequelize.query(
      "SELECT `key` FROM settings WHERE `key` = 'tracking_link_expiry_days' LIMIT 1"
    );
    if (!rows.length) {
      const now = new Date();
      await queryInterface.bulkInsert('settings', [{
        key: 'tracking_link_expiry_days',
        value: '30',
        createdAt: now,
        updatedAt: now,
      }]);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_order_status_history');
    await queryInterface.removeIndex('store_orders', 'uq_store_orders_tracking_token');
    await queryInterface.removeColumn('store_orders', 'tracking_token');
    await queryInterface.removeColumn('store_orders', 'tracking_token_expires_at');
    await queryInterface.bulkDelete('settings', { key: 'tracking_link_expiry_days' });
    await queryInterface.sequelize.query(`
      ALTER TABLE store_orders
      MODIFY COLUMN status
      ENUM('pending_payment','paid','processing','review','awaiting_courier','shipped','delivered','cancelled')
      NOT NULL DEFAULT 'pending_payment'
    `);
  },
};
