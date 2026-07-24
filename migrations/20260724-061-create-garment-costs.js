'use strict';

/*
 * Costos de prendas — parte 3/4.
 * Hoja de costos por (cliente + tipo de prenda) con versionado. El costo
 * "actual" es siempre la última versión: cada guardado crea una versión nueva
 * (nunca pisa) con su detalle de ítems denormalizado (label + monto), de modo
 * que el historial queda estable aunque el maestro cambie.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Hoja actual por (cliente, tipo de prenda) ──
    await queryInterface.createTable('garment_costs', {
      id:                 { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      client_id:          { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'clients', key: 'id' }, onDelete: 'CASCADE' },
      garment_type_id:    { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'garment_types', key: 'id' }, onDelete: 'CASCADE' },
      total_cost:         { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      current_version_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      updated_by:         { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      createdAt:          { type: Sequelize.DATE, allowNull: false },
      updatedAt:          { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('garment_costs', {
      fields: ['client_id', 'garment_type_id'],
      type: 'unique',
      name: 'uq_garment_costs_client_garment',
    });

    // ── Versiones (historial) ──
    await queryInterface.createTable('garment_cost_versions', {
      id:              { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      garment_cost_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'garment_costs', key: 'id' }, onDelete: 'CASCADE' },
      version_number:  { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      total_cost:      { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      created_by:      { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      createdAt:       { type: Sequelize.DATE, allowNull: false },
      updatedAt:       { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('garment_cost_versions', ['garment_cost_id', 'version_number'], {
      name: 'idx_garment_cost_versions_cost_version',
    });

    // ── Ítems de cada versión (snapshot denormalizado) ──
    await queryInterface.createTable('garment_cost_version_items', {
      id:           { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      version_id:   { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'garment_cost_versions', key: 'id' }, onDelete: 'CASCADE' },
      cost_item_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, references: { model: 'garment_cost_items', key: 'id' }, onDelete: 'SET NULL' },
      item_key:     { type: Sequelize.STRING(60), allowNull: false },
      item_label:   { type: Sequelize.STRING(150), allowNull: false },
      amount:       { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      createdAt:    { type: Sequelize.DATE, allowNull: false },
      updatedAt:    { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('garment_cost_version_items', ['version_id'], {
      name: 'idx_garment_cost_version_items_version',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('garment_cost_version_items');
    await queryInterface.dropTable('garment_cost_versions');
    await queryInterface.dropTable('garment_costs');
  },
};
