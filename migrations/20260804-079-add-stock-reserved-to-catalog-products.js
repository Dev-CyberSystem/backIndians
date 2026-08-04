'use strict';

/**
 * Contador de stock reservado (2.1 — Fase 2). Disponible para venta =
 * stock_quantity - stock_reserved. Separado de stock_quantity (stock físico
 * real) para poder reservar al crear el pedido y descontar recién al
 * confirmarse el pago, sin perder el stock físico real como referencia.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('catalog_products');

    if (!table.stock_reserved) {
      await queryInterface.addColumn('catalog_products', 'stock_reserved', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        after: 'stock_quantity',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('catalog_products');
    if (table.stock_reserved) {
      await queryInterface.removeColumn('catalog_products', 'stock_reserved');
    }
  },
};
