'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'session_version', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      after: 'active',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'session_version');
  },
};
