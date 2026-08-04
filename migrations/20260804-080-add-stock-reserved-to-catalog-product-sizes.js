'use strict';

/** Mismo campo que 079, para productos con talles (2.1 — Fase 2). */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('catalog_product_sizes');

    if (!table.stock_reserved) {
      await queryInterface.addColumn('catalog_product_sizes', 'stock_reserved', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        after: 'stock_quantity',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('catalog_product_sizes');
    if (table.stock_reserved) {
      await queryInterface.removeColumn('catalog_product_sizes', 'stock_reserved');
    }
  },
};
