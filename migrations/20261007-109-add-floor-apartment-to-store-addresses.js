'use strict';

/**
 * Piso y departamento opcionales en las direcciones guardadas del comprador.
 *
 * En el pedido (`store_orders.shipping_address`) viajan dentro del JSON, así que
 * ahí no hace falta migración. Las direcciones guardadas de "Mi cuenta"
 * (`store_addresses`) son columnas fijas: se agregan `floor` y `apartment`,
 * NULL-ables (las direcciones existentes no tienen esos datos).
 *
 * OJO: replicado en `src/config/ensureSchema.ts` (en desarrollo la DB se
 * sincroniza con `sequelize.sync()`, que no altera tablas existentes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('store_addresses');
    if (!cols.floor) {
      await queryInterface.addColumn('store_addresses', 'floor', {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
      });
    }
    if (!cols.apartment) {
      await queryInterface.addColumn('store_addresses', 'apartment', {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const cols = await queryInterface.describeTable('store_addresses');
    if (cols.apartment) await queryInterface.removeColumn('store_addresses', 'apartment');
    if (cols.floor) await queryInterface.removeColumn('store_addresses', 'floor');
  },
};
