'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('clients', 'condicion_iva', {
      type: Sequelize.TINYINT.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      comment: '1=RI, 4=Exento, 5=Consumidor Final, 6=Monotributista',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('clients', 'condicion_iva');
  },
};
