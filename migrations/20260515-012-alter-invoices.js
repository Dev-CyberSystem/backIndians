'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'notes', {
      type: Sequelize.TEXT,
      allowNull: true,
      after: 'status',
    });
    await queryInterface.addColumn('invoices', 'discount_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      after: 'notes',
    });
    await queryInterface.addColumn('invoices', 'extra_items', {
      type: Sequelize.JSON,
      allowNull: true,
      after: 'discount_amount',
    });
    await queryInterface.addColumn('invoices', 'total_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      after: 'extra_items',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('invoices', 'notes');
    await queryInterface.removeColumn('invoices', 'discount_amount');
    await queryInterface.removeColumn('invoices', 'extra_items');
    await queryInterface.removeColumn('invoices', 'total_amount');
  },
};
