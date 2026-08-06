'use strict';

/**
 * Fecha del último evento de pago aplicado (1.5 / A-7): permite ignorar
 * webhooks desordenados (p. ej. un "pending" que llega después de un
 * "approved" ya aplicado) sin retroceder el estado del pedido.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_orders');
    if (!table.mp_payment_date) {
      await queryInterface.addColumn('store_orders', 'mp_payment_date', {
        type: Sequelize.DATE,
        allowNull: true,
        after: 'mp_status',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_orders');
    if (table.mp_payment_date) {
      await queryInterface.removeColumn('store_orders', 'mp_payment_date');
    }
  },
};
