'use strict';

/**
 * Backfill de datos (2.1 — Fase 2), no de esquema. Antes de esta tarea, TODO
 * pedido de tienda que llegó a crearse ya había descontado stock_quantity de
 * verdad al momento del checkout (modelo de descuento inmediato de Fase 1) —
 * nunca hubo una reserva intermedia. Para que restoreStoreOrderStock siga
 * tratando a esos pedidos históricos como "stock ya confirmado/descontado"
 * (y no como "solo reservado", que nunca ocurrió), se les marca
 * stock_confirmed_at = createdAt.
 *
 * Se excluyen los pedidos que ya tienen stock_restored_at (ya se restituyó
 * su stock por cancelación — no importa qué rama tomarían en el futuro,
 * restoreStoreOrderStock corta ahí mismo por su propio guard de idempotencia).
 *
 * Idempotente: solo toca filas con stock_confirmed_at todavía NULL.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE store_orders
      SET stock_confirmed_at = createdAt
      WHERE stock_confirmed_at IS NULL
        AND stock_restored_at IS NULL
    `);
  },

  // No-op a propósito: backfill de datos, no de esquema (mismo criterio que 071).
  async down() {},
};
