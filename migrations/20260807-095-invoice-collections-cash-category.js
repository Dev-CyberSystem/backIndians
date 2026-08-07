'use strict';

/**
 * Cierra el resto de DEC-012 / Fase 2 del plan de GO:
 *
 *  - Agrega `'catalog_invoice'` al ENUM `cash_transactions.reference_type`
 *    (mismo patrón que la migración 086 agregó `'store_order'`). Las
 *    cobranzas de facturas de fábrica reusan el valor `'invoice'` que ya
 *    existía en el ENUM (declarado desde el origen del módulo pero nunca
 *    usado programáticamente hasta ahora).
 *  - Siembra la categoría de sistema `Cobranzas de facturas`, compartida por
 *    los dos circuitos de cobranza (fábrica y catálogo son el mismo
 *    concepto de negocio — cobrar una factura ya emitida).
 */

const CATEGORY_NAME = 'Cobranzas de facturas';
const ENUM_VALUES = ['invoice', 'order', 'store_order', 'catalog_invoice'];
const PREVIOUS_ENUM_VALUES = ['invoice', 'order', 'store_order'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_transactions' AND COLUMN_NAME = 'reference_type'
    `);
    const alreadyHasCatalogInvoice = rows[0] && rows[0].COLUMN_TYPE.includes("'catalog_invoice'");
    if (!alreadyHasCatalogInvoice) {
      await queryInterface.changeColumn('cash_transactions', 'reference_type', {
        type: Sequelize.ENUM(...ENUM_VALUES),
        allowNull: true,
      });
    }

    const now = new Date();
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM cash_transaction_categories WHERE name = ? AND is_system = 1',
      { replacements: [CATEGORY_NAME] }
    );
    if (existing.length === 0) {
      await queryInterface.sequelize.query(
        `INSERT INTO cash_transaction_categories (name, type, color, is_system, active, createdAt, updatedAt)
         VALUES (?, 'income', '#0EA5E9', 1, 1, ?, ?)`,
        { replacements: [CATEGORY_NAME, now, now] }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'DELETE FROM cash_transaction_categories WHERE name = ? AND is_system = 1',
      { replacements: [CATEGORY_NAME] }
    );
    await queryInterface.changeColumn('cash_transactions', 'reference_type', {
      type: Sequelize.ENUM(...PREVIOUS_ENUM_VALUES),
      allowNull: true,
    });
  },
};
