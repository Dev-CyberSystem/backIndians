'use strict';

/**
 * Marca de idempotencia para la restitución de stock al cancelar un pedido
 * de tienda (1.3 / C-1). NULL = stock todavía no restituido.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_orders');

    if (!table.stock_restored_at) {
      await queryInterface.addColumn('store_orders', 'stock_restored_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
        after: 'tracking_token_expires_at',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_orders');
    if (table.stock_restored_at) {
      await queryInterface.removeColumn('store_orders', 'stock_restored_at');
    }
  },
};
