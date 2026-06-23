'use strict';

/** Agrega payment_method + payment_proof_url a store_orders */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('store_orders', 'payment_method', {
      type: Sequelize.ENUM('mercadopago', 'cash', 'bank_transfer'),
      allowNull: false,
      defaultValue: 'mercadopago',
      after: 'mp_status',
    });
    await queryInterface.addColumn('store_orders', 'payment_proof_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
      after: 'payment_method',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_orders', 'payment_proof_url');
    await queryInterface.removeColumn('store_orders', 'payment_method');
    await queryInterface.sequelize.query(
      "ALTER TABLE store_orders MODIFY payment_method ENUM('mercadopago','cash','bank_transfer')"
    ).catch(() => {});
  },
};
