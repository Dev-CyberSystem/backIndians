'use strict';

/*
 * Costos de prendas — parte 4/4.
 * Detalle de costos "congelado" del pedido. Se genera al crear (y al reemplazar
 * los ítems de) un pedido, con los costos vigentes en ese momento. Guarda la
 * versión usada (inmutable) + el costo unitario y de línea calculados, de modo
 * que un cambio de costos futuro no altera pedidos ya cargados.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_cost_details', {
      id:                      { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      order_id:                { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'orders', key: 'id' }, onDelete: 'CASCADE' },
      order_item_id:           { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      garment_type_id:         { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, references: { model: 'garment_types', key: 'id' }, onDelete: 'SET NULL' },
      garment_type_name:       { type: Sequelize.STRING(150), allowNull: true, defaultValue: null },
      garment_cost_id:         { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      garment_cost_version_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      quantity:                { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      unit_cost:               { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      line_total:              { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      createdAt:               { type: Sequelize.DATE, allowNull: false },
      updatedAt:               { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('order_cost_details', ['order_id'], {
      name: 'idx_order_cost_details_order',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_cost_details');
  },
};
