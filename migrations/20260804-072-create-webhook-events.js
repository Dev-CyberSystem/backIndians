'use strict';

/**
 * Registro de eventos de webhook procesados (1.5 / A-7). Cierra la
 * idempotencia real "por evento" (no solo por resultado): antes de procesar
 * un webhook se registra acá; si ya existe y quedó completo
 * (`processed_at` seteado), no se reprocesa.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('webhook_events')) {
      await queryInterface.createTable('webhook_events', {
        id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        provider: { type: Sequelize.STRING(30), allowNull: false },
        event_id: { type: Sequelize.STRING(100), allowNull: false },
        payload_hash: { type: Sequelize.STRING(64), allowNull: true },
        processed_at: { type: Sequelize.DATE, allowNull: true },
        result: { type: Sequelize.STRING(50), allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('webhook_events', ['provider', 'event_id'], {
        name: 'uq_webhook_events_provider_event',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('webhook_events');
  },
};
