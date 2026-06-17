'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('order_items', 'stock_fabric_ids', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
      comment: '[id, id, ...] — múltiples telas del stock',
      after: 'stock_fabric_id',
    });
    await queryInterface.addColumn('order_items', 'size_chart_image_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
      defaultValue: null,
      comment: 'URL imagen tabla de talles (Cloudinary)',
      after: 'sizes',
    });
    await queryInterface.addColumn('order_items', 'size_chart_cloudinary_id', {
      type: Sequelize.STRING(300),
      allowNull: true,
      defaultValue: null,
      after: 'size_chart_image_url',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('order_items', 'stock_fabric_ids');
    await queryInterface.removeColumn('order_items', 'size_chart_image_url');
    await queryInterface.removeColumn('order_items', 'size_chart_cloudinary_id');
  },
};
