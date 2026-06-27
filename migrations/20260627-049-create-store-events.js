'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('store_events', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      session_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
      event_type: {
        type: Sequelize.ENUM('product_view', 'cart_add', 'cart_remove', 'search', 'purchase', 'checkout_start'),
        allowNull: false,
      },
      product_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        defaultValue: null,
      },
      search_query: {
        type: Sequelize.STRING(200),
        allowNull: true,
        defaultValue: null,
      },
      device_type: {
        type: Sequelize.ENUM('mobile', 'tablet', 'desktop'),
        allowNull: false,
        defaultValue: 'desktop',
      },
      country_code: {
        type: Sequelize.STRING(2),
        allowNull: true,
        defaultValue: null,
      },
      region: {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: null,
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: null,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('store_events', ['event_type'], { name: 'idx_se_event_type' });
    await queryInterface.addIndex('store_events', ['product_id'],  { name: 'idx_se_product_id' });
    await queryInterface.addIndex('store_events', ['session_id'],  { name: 'idx_se_session_id' });
    await queryInterface.addIndex('store_events', ['city'],        { name: 'idx_se_city' });
    await queryInterface.addIndex('store_events', ['createdAt'],   { name: 'idx_se_created_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_events');
  },
};
