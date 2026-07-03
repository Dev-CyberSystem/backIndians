'use strict';

/**
 * Seed de la tabla `size_charts` (talles del sistema).
 *
 * En producción la tabla quedó vacía (nunca se corrió `npm run seed`), por lo
 * que `GET /master/sizes` devolvía [] y el form de creación de pedido se quedaba
 * en "Cargando talles...". Sembramos el set canónico (mismo que seeders/index.ts)
 * de forma idempotente: inserta el que falte y reactiva el que exista inactivo,
 * para garantizar que los talles base estén disponibles.
 *
 * @type {import('sequelize-cli').Migration}
 */
const TALLES = [
  { name: 'XS',       sort_order: 1 },
  { name: 'S',        sort_order: 2 },
  { name: 'M',        sort_order: 3 },
  { name: 'L',        sort_order: 4 },
  { name: 'XL',       sort_order: 5 },
  { name: 'XXL',      sort_order: 6 },
  { name: 'XXXL',     sort_order: 7 },
  { name: 'Talle 2',  sort_order: 8 },
  { name: 'Talle 4',  sort_order: 9 },
  { name: 'Talle 6',  sort_order: 10 },
  { name: 'Talle 8',  sort_order: 11 },
  { name: 'Talle 10', sort_order: 12 },
  { name: 'Talle 12', sort_order: 13 },
  { name: 'Único',    sort_order: 14 },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const talle of TALLES) {
      const [rows] = await queryInterface.sequelize.query(
        'SELECT id FROM size_charts WHERE name = ? LIMIT 1',
        { replacements: [talle.name] }
      );
      if (rows.length) {
        // Existe: asegurar que esté activo y con su sort_order.
        await queryInterface.sequelize.query(
          'UPDATE size_charts SET active = 1, sort_order = ?, updatedAt = ? WHERE name = ?',
          { replacements: [talle.sort_order, now, talle.name] }
        );
      } else {
        await queryInterface.bulkInsert('size_charts', [{
          name: talle.name,
          sort_order: talle.sort_order,
          active: true,
          createdAt: now,
          updatedAt: now,
        }]);
      }
    }
  },

  async down(queryInterface) {
    // Reversible: elimina solo los talles sembrados por esta migración.
    await queryInterface.bulkDelete('size_charts', { name: TALLES.map((t) => t.name) });
  },
};
