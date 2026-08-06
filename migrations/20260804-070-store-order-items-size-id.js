'use strict';

/**
 * catalog_product_size_id en store_order_items (1.10 / M-8, habilita 1.3).
 * Hasta ahora el talle solo se guardaba como texto (`size_name`), lo que
 * hacía frágil restituir stock si el talle se renombra/elimina. Columna
 * nullable: se puebla en los pedidos nuevos (createStoreOrder) y, para los
 * históricos, en la migración de backfill separada (071).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_order_items');

    if (!table.catalog_product_size_id) {
      await queryInterface.addColumn('store_order_items', 'catalog_product_size_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'catalog_product_sizes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        after: 'size_name',
      });
      await queryInterface.addIndex('store_order_items', ['catalog_product_size_id'], {
        name: 'idx_store_order_items_size_id',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_order_items');
    if (table.catalog_product_size_id) {
      await queryInterface.removeColumn('store_order_items', 'catalog_product_size_id');
    }
  },
};
