'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('catalog_products');

    if (!table.public_price) {
      await queryInterface.addColumn('catalog_products', 'public_price', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: null,
        after: 'price',
      });
    }

    if (!table.show_in_store) {
      await queryInterface.addColumn('catalog_products', 'show_in_store', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        after: 'public_price',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('catalog_products');
    if (table.public_price) await queryInterface.removeColumn('catalog_products', 'public_price');
    if (table.show_in_store) await queryInterface.removeColumn('catalog_products', 'show_in_store');
  },
};
