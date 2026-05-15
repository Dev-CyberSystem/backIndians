'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('settings', {
      key: {
        type: Sequelize.STRING(100),
        primaryKey: true,
        allowNull: false,
      },
      value: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    // Valores por defecto
    const now = new Date();
    await queryInterface.bulkInsert('settings', [
      { key: 'company_name',    value: 'Indians Textil',        createdAt: now, updatedAt: now },
      { key: 'company_address', value: '',                       createdAt: now, updatedAt: now },
      { key: 'company_cuit',    value: '',                       createdAt: now, updatedAt: now },
      { key: 'company_phone',   value: '',                       createdAt: now, updatedAt: now },
      { key: 'company_email',   value: '',                       createdAt: now, updatedAt: now },
      { key: 'invoice_due_days', value: '30',                    createdAt: now, updatedAt: now },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('settings');
  },
};
