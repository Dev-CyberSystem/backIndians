'use strict';

/**
 * Agrega 'seller' al ENUM de role en la tabla users.
 * MySQL requiere redefinir el ENUM completo con MODIFY COLUMN.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('users', 'role', {
      type: Sequelize.ENUM('admin', 'billing', 'workshop', 'seller'),
      allowNull: false,
      defaultValue: 'workshop',
    });
  },

  async down(queryInterface, Sequelize) {
    // Revertir: quitar 'seller' del ENUM
    // Primero actualizar registros con rol seller (evitar FK constraint)
    await queryInterface.sequelize.query(
      "UPDATE users SET role = 'billing' WHERE role = 'seller'"
    );
    await queryInterface.changeColumn('users', 'role', {
      type: Sequelize.ENUM('admin', 'billing', 'workshop'),
      allowNull: false,
      defaultValue: 'workshop',
    });
  },
};
