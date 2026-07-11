'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('order_items', 'has_cuff', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'embroidery_notes',
    });
    await queryInterface.addColumn('order_items', 'cuff_color', {
      type: Sequelize.STRING(150),
      allowNull: true,
      defaultValue: null,
      after: 'has_cuff',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('order_items', 'has_cuff');
    await queryInterface.removeColumn('order_items', 'cuff_color');
  },
};
