'use strict';

/*
 * Siembra el tipo de prenda «Bolso / Mochila» para cada cliente existente.
 *
 * Los tipos de prenda son por cliente (listGarmentTypes filtra estrictamente por
 * client_id), así que no sirve uno global. Es solo datos: no cambia el esquema,
 * por eso no tiene espejo en ensureSchema.ts. Idempotente: si el cliente ya tiene
 * un tipo con ese nombre (índice único client_id+name), no lo duplica.
 * Sin categoría de costo (cost_category NULL): no es jersey ni short.
 */
const NAME = 'Bolso / Mochila';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `INSERT INTO garment_types (name, client_id, cost_category, active, sort_order, createdAt, updatedAt)
       SELECT :name, c.id, NULL, 1, 0, NOW(), NOW()
         FROM clients c
        WHERE NOT EXISTS (
          SELECT 1 FROM garment_types g WHERE g.client_id = c.id AND g.name = :name
        )`,
      { replacements: { name: NAME } }
    );
  },

  // No se borra en el down: a esta altura puede haber pedidos, productos o costos
  // que referencian el tipo, y los que el usuario creó a mano tienen el mismo nombre.
  async down() {},
};
