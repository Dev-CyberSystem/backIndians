'use strict';

/**
 * Nuevos tipos de movimiento para el ledger (2.1 — Fase 2):
 * - 'reserve': se reservó stock al crear un pedido (stock_reserved += n).
 * - 'release': se liberó una reserva sin llegar a vender (cancelación antes
 *   de pagar, o el paso intermedio al confirmar un pago — ver
 *   stockLedger.service.ts / confirmStoreOrderStock).
 * 'sale' y 'cancel' mantienen su significado exacto de siempre (stock_quantity
 * real que entra o sale por una venta efectivamente confirmada).
 */

const ENUM_VALUES = ['sale', 'return', 'cancel', 'adjustment', 'in', 'out', 'transfer', 'reserve', 'release'];
const PREVIOUS_ENUM_VALUES = ['sale', 'return', 'cancel', 'adjustment', 'in', 'out', 'transfer'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_stock_movements' AND COLUMN_NAME = 'type'
    `);
    const alreadyHasReserve = rows[0] && rows[0].COLUMN_TYPE.includes("'reserve'");
    if (!alreadyHasReserve) {
      await queryInterface.changeColumn('catalog_stock_movements', 'type', {
        type: Sequelize.ENUM(...ENUM_VALUES),
        allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // No revierte si ya hay movimientos con los tipos nuevos — MySQL fallaría
    // igual al intentar angostar el ENUM con filas que usan esos valores.
    await queryInterface.changeColumn('catalog_stock_movements', 'type', {
      type: Sequelize.ENUM(...PREVIOUS_ENUM_VALUES),
      allowNull: false,
    });
  },
};
