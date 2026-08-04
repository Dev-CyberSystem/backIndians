'use strict';

/**
 * Categoría del sistema para los ingresos automáticos de la tienda online
 * (2.3 — Fase 2). `is_system: true` evita que se pueda editar/desactivar
 * desde el panel (mismo criterio que ya aplica `cash.service.ts` para las
 * categorías del sistema).
 */

const CATEGORY_NAME = 'Ventas tienda online';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM cash_transaction_categories WHERE name = ? AND is_system = 1',
      { replacements: [CATEGORY_NAME] }
    );
    if (existing.length === 0) {
      await queryInterface.sequelize.query(
        `INSERT INTO cash_transaction_categories (name, type, color, is_system, active, createdAt, updatedAt)
         VALUES (?, 'income', '#7C3AED', 1, 1, ?, ?)`,
        { replacements: [CATEGORY_NAME, now, now] }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE FROM cash_transaction_categories WHERE name = ? AND is_system = 1',
      { replacements: [CATEGORY_NAME] }
    );
  },
};
