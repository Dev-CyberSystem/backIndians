'use strict';

/**
 * Detalle por ítem de una devolución (2.4 — ver 088). `condition` queda NULL
 * hasta que se revisa; solo los ítems `resellable` disparan una restitución
 * de stock real (vía stockLedger, movimiento `return` — tipo que ya existía
 * en el ENUM de catalog_stock_movements desde 1.2, sin usar hasta ahora).
 * `restocked_at` es la marca de idempotencia de esa restitución.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('store_return_items')) {
      await queryInterface.createTable('store_return_items', {
        id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        store_return_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'store_returns', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        store_order_item_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'store_order_items', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        quantity: { type: Sequelize.INTEGER, allowNull: false },
        condition: {
          type: Sequelize.ENUM('resellable', 'not_resellable'),
          allowNull: true,
          defaultValue: null,
        },
        restocked_at: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });

      await queryInterface.addIndex('store_return_items', ['store_return_id'], {
        name: 'idx_store_return_items_return',
      });
      await queryInterface.addIndex('store_return_items', ['store_order_item_id'], {
        name: 'idx_store_return_items_order_item',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_return_items');
  },
};
