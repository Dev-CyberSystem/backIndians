'use strict';

/**
 * Facturación electrónica ARCA (Fase 2 / módulo portado desde la branch
 * `integracionarca`, renumerado 050→074 para no chocar con migraciones que
 * ya existían en esos números en esta branch).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('clients');
    if (!table.condicion_iva) {
      await queryInterface.addColumn('clients', 'condicion_iva', {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
        defaultValue: null,
        comment: '1=RI, 4=Exento, 5=Consumidor Final, 6=Monotributista',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('clients');
    if (table.condicion_iva) {
      await queryInterface.removeColumn('clients', 'condicion_iva');
    }
  },
};
