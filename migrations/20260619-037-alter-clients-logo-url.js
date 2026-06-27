'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('clients', 'logo_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
      defaultValue: null,
      after: 'notes',
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('clients', 'logo_url');
  },
};
