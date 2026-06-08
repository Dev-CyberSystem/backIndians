'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'payment_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
      after: 'total_amount',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('invoices', 'payment_amount');
  },
};
