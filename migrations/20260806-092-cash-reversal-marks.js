'use strict';

/**
 * Reversión automática de caja en cancelaciones y devoluciones (Fase 4 del
 * plan de corrección — cierra CASH-SALE-002: hoy cancelar un pedido pagado o
 * registrar una devolución no revierte el ingreso de caja ya registrado por
 * `recordStoreOrderIncome`).
 *
 * Dos columnas de idempotencia, no una: `store_returns.refunded_amount` +
 * `refund_status` permiten devoluciones PARCIALES y puede haber VARIAS
 * devoluciones sobre el mismo pedido. Una sola marca en `store_orders` haría
 * que la segunda devolución parcial se saltee en silencio — cada devolución
 * necesita su propia marca. `store_orders.cash_reversed_at` cubre solo la
 * cancelación total del pedido.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const storeOrders = await queryInterface.describeTable('store_orders');
    if (!storeOrders.cash_reversed_at) {
      await queryInterface.addColumn('store_orders', 'cash_reversed_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
        after: 'cash_recorded_at',
      });
    }

    const storeReturns = await queryInterface.describeTable('store_returns');
    if (!storeReturns.cash_reversed_at) {
      await queryInterface.addColumn('store_returns', 'cash_reversed_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
        after: 'refunded_at',
      });
    }
  },

  async down(queryInterface) {
    const storeOrders = await queryInterface.describeTable('store_orders');
    if (storeOrders.cash_reversed_at) {
      await queryInterface.removeColumn('store_orders', 'cash_reversed_at');
    }

    const storeReturns = await queryInterface.describeTable('store_returns');
    if (storeReturns.cash_reversed_at) {
      await queryInterface.removeColumn('store_returns', 'cash_reversed_at');
    }
  },
};
