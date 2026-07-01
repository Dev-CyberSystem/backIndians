'use strict';

/** @type {import('sequelize').QueryInterface} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Estado del mail de bienvenida por usuario, para poder confirmar el envío,
    // mostrar el motivo de un fallo y ofrecer el reenvío desde el panel.
    await queryInterface.addColumn('users', 'welcome_email_sent_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
      after: 'session_version',
    });
    await queryInterface.addColumn('users', 'welcome_email_error', {
      type: Sequelize.STRING(500),
      allowNull: true,
      defaultValue: null,
      after: 'welcome_email_sent_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'welcome_email_error');
    await queryInterface.removeColumn('users', 'welcome_email_sent_at');
  },
};
