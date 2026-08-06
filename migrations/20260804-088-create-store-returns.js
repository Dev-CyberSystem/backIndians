'use strict';

/**
 * Circuito de devoluciones con revisión (2.4 — Fase 2 / decisión de negocio
 * #4: "el producto devuelto requiere revisión, nunca automático"). Un
 * `StoreReturn` es la solicitud de devolución de un pedido entregado;
 * `store_return_items` (migración 089) el detalle por ítem.
 *
 * `refund_status` solo refleja lo que pasó en MercadoPago/efectivo/
 * transferencia — decisión de negocio #5: los reintegros se ejecutan
 * manualmente desde afuera del sistema, acá no se dispara ninguna API.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('store_returns')) {
      await queryInterface.createTable('store_returns', {
        id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        store_order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'store_orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        status: {
          type: Sequelize.ENUM('pending_review', 'approved', 'rejected'),
          allowNull: false,
          defaultValue: 'pending_review',
        },
        reason: { type: Sequelize.TEXT, allowNull: true },
        refund_status: {
          type: Sequelize.ENUM('none', 'pending', 'refunded'),
          allowNull: false,
          defaultValue: 'none',
        },
        refunded_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
        refunded_at: { type: Sequelize.DATE, allowNull: true },
        requested_by: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        reviewed_by: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        reviewed_at: { type: Sequelize.DATE, allowNull: true },
        review_notes: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });

      await queryInterface.addIndex('store_returns', ['store_order_id'], {
        name: 'idx_store_returns_order',
      });
      await queryInterface.addIndex('store_returns', ['status'], {
        name: 'idx_store_returns_status',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_returns');
  },
};
