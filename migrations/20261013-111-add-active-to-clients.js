'use strict';

/**
 * Baja lógica de clientes: `active` + `archived_at`.
 *
 * Un cliente archivado desaparece de listados y selectores (nuevo pedido,
 * filtros, facturas) pero conserva pedidos, facturas, catálogo y costos.
 * Los existentes quedan activos. El borrado físico lo controla el servicio
 * (solo si el cliente no tiene ningún dato asociado).
 *
 * OJO: replicado en `src/config/ensureSchema.ts` (en desarrollo la DB se
 * sincroniza con `sequelize.sync()`, que no altera tablas existentes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('clients');
    if (!cols.active) {
      await queryInterface.addColumn('clients', 'active', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }
    if (!cols.archived_at) {
      await queryInterface.addColumn('clients', 'archived_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const cols = await queryInterface.describeTable('clients');
    if (cols.archived_at) await queryInterface.removeColumn('clients', 'archived_at');
    if (cols.active) await queryInterface.removeColumn('clients', 'active');
  },
};
