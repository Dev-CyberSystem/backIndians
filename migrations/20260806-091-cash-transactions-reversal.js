'use strict';

/**
 * Inmutabilidad y reversión de movimientos de caja (Fase 2 del plan de
 * corrección — cierra el hallazgo CASH-MUT-001 de
 * `AUDITORIA_FLUJO_CAJA_2026-08-06.md`: hoy un movimiento confirmado se
 * puede editar/borrar sin motivo ni rastro del valor anterior).
 *
 * A partir de esta migración, un `CashTransaction` confirmado no se edita
 * ni se elimina: se revierte. La reversión crea un contraasiento nuevo
 * (mismo mecanismo de siempre para el saldo — `applyBalanceEffect`) y deja
 * el original intacto, solo marcado.
 *
 * `idempotency_key` sigue el patrón de `store_orders` (migración 069) con
 * una diferencia deliberada: acá NO se declara `unique: true` en el
 * atributo del modelo Sequelize, solo en esta migración (vía `addIndex`) y
 * en `ensureSchema.ts`. Declararlo en el modelo Y en la migración genera un
 * índice duplicado en cada `sync()` de desarrollo — es el mismo patrón que
 * `dedupeIndexes.ts` tiene que limpiar hoy para `store_orders.idempotency_key`
 * (confirmado en logs de esta sesión: "kept: idempotency_key, dropped: 1"
 * en cada seed). No repetirlo acá.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('cash_transactions');

    if (!table.status) {
      await queryInterface.addColumn('cash_transactions', 'status', {
        type: Sequelize.ENUM('active', 'reversed'),
        allowNull: false,
        defaultValue: 'active',
      });
      await queryInterface.addIndex('cash_transactions', ['status'], {
        name: 'idx_cash_transactions_status',
      });
    }

    if (!table.reversal_of_id) {
      await queryInterface.addColumn('cash_transactions', 'reversal_of_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'cash_transactions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      });
      await queryInterface.addIndex('cash_transactions', ['reversal_of_id'], {
        name: 'idx_cash_transactions_reversal_of',
      });
    }

    if (!table.reversal_reason) {
      await queryInterface.addColumn('cash_transactions', 'reversal_reason', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }

    if (!table.reversed_at) {
      await queryInterface.addColumn('cash_transactions', 'reversed_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!table.reversed_by) {
      await queryInterface.addColumn('cash_transactions', 'reversed_by', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }

    if (!table.idempotency_key) {
      await queryInterface.addColumn('cash_transactions', 'idempotency_key', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
      await queryInterface.addIndex('cash_transactions', ['idempotency_key'], {
        name: 'uq_cash_transactions_idempotency_key',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('cash_transactions');

    if (table.idempotency_key) {
      await queryInterface.removeIndex('cash_transactions', 'uq_cash_transactions_idempotency_key');
      await queryInterface.removeColumn('cash_transactions', 'idempotency_key');
    }
    if (table.reversed_by) await queryInterface.removeColumn('cash_transactions', 'reversed_by');
    if (table.reversed_at) await queryInterface.removeColumn('cash_transactions', 'reversed_at');
    if (table.reversal_reason) await queryInterface.removeColumn('cash_transactions', 'reversal_reason');
    if (table.reversal_of_id) {
      await queryInterface.removeIndex('cash_transactions', 'idx_cash_transactions_reversal_of');
      await queryInterface.removeColumn('cash_transactions', 'reversal_of_id');
    }
    if (table.status) {
      await queryInterface.removeIndex('cash_transactions', 'idx_cash_transactions_status');
      await queryInterface.removeColumn('cash_transactions', 'status');
    }
  },
};
