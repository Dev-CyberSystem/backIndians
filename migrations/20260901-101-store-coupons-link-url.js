'use strict';

/**
 * Destino configurable del botón "Ver la colección" del popup promocional
 * de cupón (StoreLayout → CouponPopup). Antes iba siempre a /tienda/productos;
 * ahora cada cupón puede apuntar a la sección/producto que se está publicando
 * (ej. /tienda/coleccion/despedida-el-pulga o /tienda/productos/123).
 *
 * Texto libre igual que store_hero_image_link (mismo resolver de link en el
 * front, ver src/utils/links.ts). Vacío/null → fallback a /tienda/productos.
 *
 * OJO: cualquier cambio acá tiene que replicarse en `src/config/ensureSchema.ts`
 * (en desarrollo la DB se sincroniza con `sequelize.sync()`, que no altera
 * tablas existentes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('store_coupons');
    if (!table.link_url) {
      await queryInterface.addColumn('store_coupons', 'link_url', {
        type: Sequelize.STRING(500),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('store_coupons');
    if (table.link_url) await queryInterface.removeColumn('store_coupons', 'link_url');
  },
};
