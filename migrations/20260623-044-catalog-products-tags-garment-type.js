'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('catalog_products');

    if (!table.tags) {
      await queryInterface.addColumn('catalog_products', 'tags', {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: null,
        after: 'gender',
      });
    }

    if (!table.garment_type_id) {
      await queryInterface.addColumn('catalog_products', 'garment_type_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
        references: { model: 'garment_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        after: 'tags',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('catalog_products');
    if (table.garment_type_id) {
      await queryInterface.removeColumn('catalog_products', 'garment_type_id');
    }
    if (table.tags) {
      await queryInterface.removeColumn('catalog_products', 'tags');
    }
  },
};
