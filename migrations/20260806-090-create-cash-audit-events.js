'use strict';

/**
 * Auditoría inmutable del módulo de caja (Fase 1 del plan de corrección —
 * cierra el hallazgo CASH-AUDIT-001 de `AUDITORIA_FLUJO_CAJA_2026-08-06.md`).
 *
 * Hasta ahora no existía ningún registro de dominio de quién tocaba qué en
 * caja: lo único disponible era el log HTTP de Pino, que sabe qué request
 * entró pero no qué valores cambiaron. Sin eso, una diferencia detectada
 * después es imposible de reconstruir.
 *
 * La tabla es **append-only por diseño**:
 *   - No tiene `updatedAt` — una fila de auditoría no se actualiza nunca.
 *   - No se expone ningún endpoint de escritura ni de borrado sobre ella
 *     (solo `GET /cash/audit`, restringido a admin).
 *   - `user_id` es RESTRICT a propósito: si alguien intentara borrar un
 *     usuario con historial de caja, la FK lo impide en vez de dejar
 *     eventos huérfanos sin responsable.
 *
 * `before_json`/`after_json` guardan el snapshot del registro afectado. Se
 * usa JSON y no columnas tipadas porque la tabla cubre tres entidades
 * distintas (movimiento, cuenta, categoría) con formas diferentes.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('cash_audit_events')) {
      await queryInterface.createTable('cash_audit_events', {
        id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        entity_type: {
          type: Sequelize.ENUM('transaction', 'account', 'category'),
          allowNull: false,
        },
        entity_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        action: {
          type: Sequelize.ENUM('create', 'update', 'reverse', 'delete', 'toggle'),
          allowNull: false,
        },
        user_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        before_json: { type: Sequelize.JSON, allowNull: true },
        after_json: { type: Sequelize.JSON, allowNull: true },
        reason: { type: Sequelize.STRING(500), allowNull: true },
        ip: { type: Sequelize.STRING(45), allowNull: true },
        user_agent: { type: Sequelize.STRING(255), allowNull: true },
        correlation_id: { type: Sequelize.STRING(64), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        // Sin `updatedAt`: la tabla es append-only.
      });

      await queryInterface.addIndex('cash_audit_events', ['entity_type', 'entity_id'], {
        name: 'idx_cash_audit_entity',
      });
      await queryInterface.addIndex('cash_audit_events', ['createdAt'], {
        name: 'idx_cash_audit_created',
      });
      await queryInterface.addIndex('cash_audit_events', ['user_id'], {
        name: 'idx_cash_audit_user',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cash_audit_events');
  },
};
