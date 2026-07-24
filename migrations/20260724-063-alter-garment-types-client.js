'use strict';

/*
 * Tipos de prenda por cliente. Cada tipo de prenda pasa a pertenecer a un
 * cliente (client_id). Nullable: los tipos globales ya existentes quedan como
 * legado (client_id NULL) y siguen sirviendo a los pedidos/productos viejos;
 * los flujos nuevos filtran por cliente.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('garment_types', 'client_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
      references: { model: 'clients', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      after: 'name',
    });
    await queryInterface.addIndex('garment_types', ['client_id'], {
      name: 'idx_garment_types_client',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('garment_types', 'idx_garment_types_client');
    await queryInterface.removeColumn('garment_types', 'client_id');
  },
};
