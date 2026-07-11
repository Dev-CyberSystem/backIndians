'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('order_items', 'has_brand', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'logo_material',
    });
    await queryInterface.addColumn('order_items', 'brand_material', {
      type: Sequelize.STRING(300),
      allowNull: true,
      defaultValue: null,
      after: 'has_brand',
    });
    await queryInterface.addColumn('order_items', 'brand_dimensions', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null,
      after: 'brand_material',
    });
    await queryInterface.addColumn('order_items', 'has_shield', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'brand_dimensions',
    });
    await queryInterface.addColumn('order_items', 'shield_material', {
      type: Sequelize.STRING(300),
      allowNull: true,
      defaultValue: null,
      after: 'has_shield',
    });
    await queryInterface.addColumn('order_items', 'shield_dimensions', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null,
      after: 'shield_material',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('order_items', 'has_brand');
    await queryInterface.removeColumn('order_items', 'brand_material');
    await queryInterface.removeColumn('order_items', 'brand_dimensions');
    await queryInterface.removeColumn('order_items', 'has_shield');
    await queryInterface.removeColumn('order_items', 'shield_material');
    await queryInterface.removeColumn('order_items', 'shield_dimensions');
  },
};
