'use strict';

/**
 * Agrega a la tabla orders:
 *   - order_number (STRING unique, NOT NULL)  — número correlativo PED-YYYY-NNNNN
 *   - seller_id    (FK → users, nullable)     — vendedor que cargó el pedido
 *
 * IMPORTANTE: order_number se agrega como nullable primero, luego se rellena
 * con valores temporales y finalmente se pone NOT NULL para no romper filas
 * existentes.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('orders');

    // Agregar order_number si no existe
    if (!tableDesc.order_number) {
      await queryInterface.addColumn('orders', 'order_number', {
        type: Sequelize.STRING(20),
        allowNull: true, // temporal, se rellena abajo
        unique: true,
        after: 'id',
      });

      // Rellenar filas existentes con un número temporal único
      await queryInterface.sequelize.query(`
        UPDATE orders
        SET order_number = CONCAT('PED-', YEAR(createdAt), '-', LPAD(id, 5, '0'))
        WHERE order_number IS NULL
      `);

      // Ahora sí ponerlo NOT NULL
      await queryInterface.changeColumn('orders', 'order_number', {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
      });
    }

    // Agregar seller_id si no existe
    if (!tableDesc.seller_id) {
      await queryInterface.addColumn('orders', 'seller_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        after: 'created_by',
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('orders');

    if (tableDesc.seller_id) {
      await queryInterface.removeColumn('orders', 'seller_id');
    }
    if (tableDesc.order_number) {
      await queryInterface.removeColumn('orders', 'order_number');
    }
  },
};
