'use strict';

/** @type {import('sequelize').QueryInterface} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Expiración para verification_token (verificación de email y reset de
    // contraseña comparten esta columna). NULL = sin vencimiento (tokens viejos
    // pre-migración; se seguirán aceptando hasta que se regeneren).
    await queryInterface.addColumn('store_customers', 'token_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
      after: 'verification_token',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_customers', 'token_expires_at');
  },
};
