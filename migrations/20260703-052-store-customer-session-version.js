'use strict';

/** @type {import('sequelize').QueryInterface} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Versión de sesión para poder invalidar refresh tokens emitidos (ej: al
    // resetear la contraseña). El refresh compara este valor con el del token.
    await queryInterface.addColumn('store_customers', 'session_version', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      after: 'active',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_customers', 'session_version');
  },
};
