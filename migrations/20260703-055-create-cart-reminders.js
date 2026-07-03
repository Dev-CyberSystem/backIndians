'use strict';

/**
 * Registro de recordatorios de carrito abandonado enviados por el admin.
 *
 * Un carrito se considera "ya recordado" si existe una fila para ese
 * customer_id con `sent_at >= last_cart_add_at` del carrito actual. Si el
 * cliente vuelve a agregar productos después, genera un carrito nuevo elegible.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('store_cart_reminders', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      customer_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'store_customers', key: 'id' },
        onDelete: 'CASCADE',
      },
      sent_by: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      // Snapshot de los productos del carrito al momento de recordar (JSON de ids).
      product_ids: { type: Sequelize.JSON, allowNull: true },
      // Marca temporal del último cart_add del carrito recordado (para el dedup).
      last_cart_add_at: { type: Sequelize.DATE, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('store_cart_reminders', ['customer_id', 'sent_at'], {
      name: 'idx_cart_reminders_customer_sent',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_cart_reminders');
  },
};
