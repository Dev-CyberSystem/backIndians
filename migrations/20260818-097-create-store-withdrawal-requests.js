'use strict';

/**
 * Solicitudes de arrepentimiento (Resolución 424/2020 de la Secretaría de
 * Comercio Interior, art. 34 Ley 24.240 y arts. 1110/1111 CCyCN).
 *
 * La resolución prohíbe exigir registración previa o cualquier trámite extra
 * para usar el botón, y obliga a informar un código de identificación dentro
 * de las 24 h de recibida la solicitud. De ahí el diseño:
 *   - sin FK obligatoria a `store_customers` ni a `store_orders`;
 *   - `code` único, generado en el mismo request;
 *   - `order_number` es lo que escribió el comprador (texto libre);
 *     `store_order_id` solo se completa si ese número existe de verdad.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('store_withdrawal_requests')) return;

    await queryInterface.createTable('store_withdrawal_requests', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      code: { type: Sequelize.STRING(24), allowNull: false, unique: true },
      order_number: { type: Sequelize.STRING(60), allowNull: true },
      store_order_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      customer_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      customer_name: { type: Sequelize.STRING(120), allowNull: false },
      customer_email: { type: Sequelize.STRING(255), allowNull: false },
      customer_phone: { type: Sequelize.STRING(40), allowNull: true },
      reason: { type: Sequelize.TEXT, allowNull: true },
      status: {
        type: Sequelize.ENUM('received', 'in_progress', 'resolved', 'rejected'),
        allowNull: false,
        defaultValue: 'received',
      },
      admin_notes: { type: Sequelize.TEXT, allowNull: true },
      resolved_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      ip: { type: Sequelize.STRING(45), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('store_withdrawal_requests', ['status'], {
      name: 'idx_store_withdrawals_status',
    });
    await queryInterface.addIndex('store_withdrawal_requests', ['customer_email'], {
      name: 'idx_store_withdrawals_email',
    });
    await queryInterface.addIndex('store_withdrawal_requests', ['store_order_id'], {
      name: 'idx_store_withdrawals_order',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_withdrawal_requests');
  },
};
