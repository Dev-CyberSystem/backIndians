'use strict';

/** Agrega 'store_order' al ENUM cash_transactions.reference_type (2.3 — Fase 2). */

const ENUM_VALUES = ['invoice', 'order', 'store_order'];
const PREVIOUS_ENUM_VALUES = ['invoice', 'order'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_transactions' AND COLUMN_NAME = 'reference_type'
    `);
    const alreadyHasStoreOrder = rows[0] && rows[0].COLUMN_TYPE.includes("'store_order'");
    if (!alreadyHasStoreOrder) {
      await queryInterface.changeColumn('cash_transactions', 'reference_type', {
        type: Sequelize.ENUM(...ENUM_VALUES),
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('cash_transactions', 'reference_type', {
      type: Sequelize.ENUM(...PREVIOUS_ENUM_VALUES),
      allowNull: true,
    });
  },
};
