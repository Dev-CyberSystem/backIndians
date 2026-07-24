'use strict';

/*
 * Unicidad de tipos de prenda por cliente: no se permite el mismo nombre dentro
 * del mismo cliente (sí entre clientes distintos, y varios globales con
 * client_id NULL, ya que MySQL trata los NULL como distintos en índices únicos).
 */
module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('garment_types');
    const hasComposite = indexes.some(
      (ix) => ix.unique && (ix.fields?.length ?? 0) === 2
        && ix.fields?.some((f) => f.attribute === 'client_id')
        && ix.fields?.some((f) => f.attribute === 'name')
    );
    if (!hasComposite) {
      await queryInterface.addConstraint('garment_types', {
        fields: ['client_id', 'name'],
        type: 'unique',
        name: 'uq_garment_types_client_name',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('garment_types', 'uq_garment_types_client_name').catch(() => null);
  },
};
