'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('catalog_invoice_payments', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      catalog_invoice_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'catalog_invoices', key: 'id' },
        onDelete: 'CASCADE',
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      paid_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      notes: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('catalog_invoice_payments', ['catalog_invoice_id'], { name: 'idx_catalog_invoice_payments_invoice_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('catalog_invoice_payments');
  },
};
