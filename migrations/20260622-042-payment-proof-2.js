'use strict';

/** @type {import('sequelize').QueryInterface} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('store_orders', 'payment_proof_url_2', {
      type: Sequelize.STRING(500),
      allowNull: true,
      defaultValue: null,
      after: 'payment_proof_url',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_orders', 'payment_proof_url_2');
  },
};
