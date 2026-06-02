'use strict';

/**
 * Desacopla la tela del ítem de pedido del maestro fabric_types
 * y la vincula al stock real (stock_items):
 *
 *   - fabric_type_id  → pasa a NULL (legacy, se mantiene para historial)
 *   - stock_fabric_id → columna nueva, FK a stock_items.id (nullable)
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('order_items');

    // 1. fabric_type_id: NOT NULL → NULL
    if (tableDesc.fabric_type_id) {
      await queryInterface.changeColumn('order_items', 'fabric_type_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      });
    }

    // 2. stock_fabric_id: nueva columna nullable con FK a stock_items
    if (!tableDesc.stock_fabric_id) {
      await queryInterface.addColumn('order_items', 'stock_fabric_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'stock_items', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        after: 'fabric_type_id',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('order_items');

    // Revertir stock_fabric_id
    if (tableDesc.stock_fabric_id) {
      await queryInterface.removeColumn('order_items', 'stock_fabric_id');
    }

    // Revertir fabric_type_id a NOT NULL (requiere que no haya NULLs en la tabla)
    if (tableDesc.fabric_type_id) {
      await queryInterface.changeColumn('order_items', 'fabric_type_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      });
    }
  },
};
