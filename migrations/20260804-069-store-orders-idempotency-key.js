'use strict';

/**
 * Idempotencia del checkout (1.4 / A-1): un pedido puede llevar la clave
 * (UUID) que el frontend generó para ese intento de compra. El índice único
 * es la red de seguridad real contra dos requests concurrentes (doble clic).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_orders');

    if (!table.idempotency_key) {
      await queryInterface.addColumn('store_orders', 'idempotency_key', {
        type: Sequelize.STRING(64),
        allowNull: true,
        after: 'stock_restored_at',
      });
      await queryInterface.addIndex('store_orders', ['idempotency_key'], {
        name: 'uq_store_orders_idempotency_key',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_orders');
    if (table.idempotency_key) {
      await queryInterface.removeIndex('store_orders', 'uq_store_orders_idempotency_key');
      await queryInterface.removeColumn('store_orders', 'idempotency_key');
    }
  },
};
