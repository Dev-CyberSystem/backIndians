'use strict';

/**
 * Marca de idempotencia para el registro automático del ingreso en caja
 * (2.3 — Fase 2). Separada de `stock_confirmed_at` a propósito: son dos
 * efectos distintos disparados por el mismo evento (pago confirmado), y si
 * alguno falla (p. ej. falta configurar la cuenta de caja) no debe impedir
 * reintentar el otro de forma independiente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_orders');
    if (!table.cash_recorded_at) {
      await queryInterface.addColumn('store_orders', 'cash_recorded_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
        after: 'stock_confirmed_at',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_orders');
    if (table.cash_recorded_at) {
      await queryInterface.removeColumn('store_orders', 'cash_recorded_at');
    }
  },
};
