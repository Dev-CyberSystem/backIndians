'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Tabla de talles por producto
    await queryInterface.createTable('catalog_product_sizes', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      product_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'catalog_products', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      size_name: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      stock_quantity: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      sort_order: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('catalog_product_sizes', ['product_id']);

    // Talle elegido en el ítem del pedido
    await queryInterface.addColumn('catalog_order_items', 'size_name', {
      type: Sequelize.STRING(50),
      allowNull: true,
      defaultValue: null,
      after: 'product_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('catalog_order_items', 'size_name');
    await queryInterface.dropTable('catalog_product_sizes');
  },
};
