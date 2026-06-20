'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('store_addresses')) return;

    await queryInterface.createTable('store_addresses', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'store_customers', key: 'id' },
        onDelete: 'CASCADE',
      },
      label: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      street: {
        type: Sequelize.STRING(300),
        allowNull: false,
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      state: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      zip_code: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(100),
        allowNull: false,
        defaultValue: 'Argentina',
      },
      is_default: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.addIndex('store_addresses', ['customer_id'], { name: 'idx_store_addresses_customer_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_addresses');
  },
};
