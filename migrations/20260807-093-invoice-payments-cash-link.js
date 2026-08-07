'use strict';

/**
 * Conecta la cobranza de facturas de fábrica con caja (DEC-012, Fase 2 del
 * plan de GO — cierra CASH-INV-001 y CASH-INV-002 de
 * `VERIFICACION_FINAL_CAJA_PRODUCCION_2026-08-07.md`).
 *
 * `payment_method`: mismo vocabulario que `store_orders.payment_method`
 * (migración 041) para no inventar un segundo diccionario de medios de pago
 * en el mismo sistema. `NOT NULL` sin default: los 8 cobros que existían en
 * desarrollo eran artefactos de `factory-invoices.test.ts` y se borraron
 * antes de esta migración (autorizado explícitamente, D-4) — no hay datos
 * reales que inventar un medio de pago para ellos.
 *
 * `cash_recorded_at`: idempotencia del ASIENTO de caja de este cobro
 * puntual — análoga a `store_orders.cash_recorded_at`. Un cobro puede
 * quedar sin asiento si la cuenta de destino no está configurada
 * (`BR-CASH-008`: nunca bloquear el registro del cobro por eso).
 *
 * `idempotency_key`: idempotencia del ALTA del cobro en sí (doble clic /
 * reintento de red), no del asiento. Sin `unique: true` en el modelo a
 * propósito — mismo patrón que `cash_transactions.idempotency_key`
 * (migración 091): declararlo en el modelo Y en la migración duplica el
 * índice bajo `sync()` en desarrollo.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('invoice_payments');

    if (!table.payment_method) {
      await queryInterface.addColumn('invoice_payments', 'payment_method', {
        type: Sequelize.ENUM('cash', 'bank_transfer', 'mercadopago'),
        allowNull: false,
        after: 'amount',
      });
    }

    if (!table.cash_recorded_at) {
      await queryInterface.addColumn('invoice_payments', 'cash_recorded_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!table.idempotency_key) {
      await queryInterface.addColumn('invoice_payments', 'idempotency_key', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
      await queryInterface.addIndex('invoice_payments', ['idempotency_key'], {
        name: 'uq_invoice_payments_idempotency_key',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('invoice_payments');

    if (table.idempotency_key) {
      await queryInterface.removeIndex('invoice_payments', 'uq_invoice_payments_idempotency_key');
      await queryInterface.removeColumn('invoice_payments', 'idempotency_key');
    }
    if (table.cash_recorded_at) await queryInterface.removeColumn('invoice_payments', 'cash_recorded_at');
    if (table.payment_method) await queryInterface.removeColumn('invoice_payments', 'payment_method');
  },
};
