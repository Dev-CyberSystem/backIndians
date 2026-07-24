'use strict';

/*
 * Con el modelo de tipos de prenda por cliente, el nombre ya no debe ser único
 * global (dos clientes pueden tener "Camiseta"). Elimina el índice único
 * heredado sobre `garment_types.name` si existe.
 */
module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('garment_types');
    const nameUnique = indexes.find(
      (ix) => ix.unique && (ix.fields?.length ?? 0) === 1 && ix.fields?.[0]?.attribute === 'name'
    );
    if (nameUnique) {
      await queryInterface.removeIndex('garment_types', nameUnique.name);
    }
  },

  async down() {
    // No se restaura el índice único: rompería el modelo por-cliente.
  },
};
