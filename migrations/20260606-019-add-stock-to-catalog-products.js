'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('catalog_products', 'stock_quantity', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      after: 'price',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('catalog_products', 'stock_quantity');
  },
};
