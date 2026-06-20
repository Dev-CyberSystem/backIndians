'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('store_customers')) return;

    await queryInterface.createTable('store_customers', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      google_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
      },
      email_verified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      verification_token: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      avatar_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('store_customers', ['email'], { name: 'idx_store_customers_email' });
    await queryInterface.addIndex('store_customers', ['google_id'], { name: 'idx_store_customers_google_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_customers');
  },
};
