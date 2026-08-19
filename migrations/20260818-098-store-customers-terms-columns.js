'use strict';

/**
 * Resumen de la última aceptación de textos legales en la propia cuenta.
 *
 * El detalle completo (una fila por documento y por evento) vive en
 * `legal_acceptances` — estas dos columnas existen para no tener que hacer un
 * JOIN cada vez que el panel muestra un cliente, y para poder detectar de un
 * vistazo a quién hay que volver a pedirle aceptación cuando cambie la
 * versión de los términos.
 *
 * OJO: cualquier cambio acá tiene que replicarse en `src/config/ensureSchema.ts`
 * (en desarrollo la DB se sincroniza con `sequelize.sync()`, que no altera
 * tablas existentes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_customers');

    if (!table.terms_accepted_at) {
      await queryInterface.addColumn('store_customers', 'terms_accepted_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }

    if (!table.terms_version) {
      await queryInterface.addColumn('store_customers', 'terms_version', {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_customers');
    if (table.terms_version) await queryInterface.removeColumn('store_customers', 'terms_version');
    if (table.terms_accepted_at) await queryInterface.removeColumn('store_customers', 'terms_accepted_at');
  },
};
