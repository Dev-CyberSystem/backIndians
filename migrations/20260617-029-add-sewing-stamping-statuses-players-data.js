'use strict';

const NEW_ENUM = [
  'pending', 'under_review', 'workshop_review', 'observed',
  'in_production', 'sewing', 'stamping', 'quality_check', 'ready', 'cancelled',
];

const OLD_ENUM = [
  'pending', 'under_review', 'workshop_review', 'observed',
  'in_production', 'quality_check', 'ready', 'cancelled',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Ampliar ENUM en orders.status
    await queryInterface.changeColumn('orders', 'status', {
      type: Sequelize.ENUM(...NEW_ENUM),
      allowNull: false,
      defaultValue: 'pending',
    });

    // 2. Ampliar ENUM en order_status_history
    await queryInterface.changeColumn('order_status_history', 'previous_status', {
      type: Sequelize.ENUM(...NEW_ENUM),
      allowNull: true,
    });
    await queryInterface.changeColumn('order_status_history', 'new_status', {
      type: Sequelize.ENUM(...NEW_ENUM),
      allowNull: false,
    });

    // 3. Agregar players_data a order_items
    await queryInterface.addColumn('order_items', 'players_data', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: null,
      comment: '{ sizeId: [{ name, number }] }',
      after: 'sizes',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('orders', 'status', {
      type: Sequelize.ENUM(...OLD_ENUM),
      allowNull: false,
      defaultValue: 'pending',
    });
    await queryInterface.changeColumn('order_status_history', 'previous_status', {
      type: Sequelize.ENUM(...OLD_ENUM),
      allowNull: true,
    });
    await queryInterface.changeColumn('order_status_history', 'new_status', {
      type: Sequelize.ENUM(...OLD_ENUM),
      allowNull: false,
    });
    await queryInterface.removeColumn('order_items', 'players_data');
  },
};
