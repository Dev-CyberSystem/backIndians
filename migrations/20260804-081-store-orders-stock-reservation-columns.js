'use strict';

/**
 * Marcas de idempotencia del flujo de reserva de stock (2.1 — Fase 2):
 * - stock_reserved_at: se setea al crear el pedido (se reservó stock_reserved).
 * - stock_confirmed_at: se setea al confirmarse el pago (la reserva se
 *   convirtió en descuento definitivo de stock_quantity).
 * Ambas NULL = pedido histórico de antes de 2.1 (ver backfill en 082) o
 * pedido nuevo que todavía no llegó a ese paso.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_orders');

    if (!table.stock_reserved_at) {
      await queryInterface.addColumn('store_orders', 'stock_reserved_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
        after: 'stock_restored_at',
      });
    }

    if (!table.stock_confirmed_at) {
      await queryInterface.addColumn('store_orders', 'stock_confirmed_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
        after: 'stock_reserved_at',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_orders');
    if (table.stock_confirmed_at) {
      await queryInterface.removeColumn('store_orders', 'stock_confirmed_at');
    }
    if (table.stock_reserved_at) {
      await queryInterface.removeColumn('store_orders', 'stock_reserved_at');
    }
  },
};
