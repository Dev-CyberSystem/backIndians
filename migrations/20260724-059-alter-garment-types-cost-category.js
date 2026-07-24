'use strict';

/*
 * Costos de prendas — parte 1/4.
 * Cada tipo de prenda pertenece a una "categoría de costo" que determina qué
 * lista de ítems de costo aplica (jersey vs shorts). Nullable: los tipos ya
 * existentes quedan sin categoría hasta que el admin la asigne.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('garment_types', 'cost_category', {
      type: Sequelize.ENUM('jersey', 'shorts'),
      allowNull: true,
      defaultValue: null,
      after: 'name',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('garment_types', 'cost_category');
    // Limpia el tipo ENUM en Postgres; en MySQL es no-op.
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_garment_types_cost_category";');
    }
  },
};
