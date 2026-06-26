'use strict';

/**
 * Índices para acelerar el catálogo de la tienda (listado + filtros), que en el
 * stress test eran el cuello de botella. Todas las queries públicas filtran por
 * show_in_store + active y agrupan/joinean por category, gender, talles y cliente.
 */
module.exports = {
  async up(queryInterface) {
    const addIfMissing = async (table, fields, name) => {
      const existing = await queryInterface.showIndex(table).catch(() => []);
      if (existing.some((i) => i.name === name)) return;
      await queryInterface.addIndex(table, { fields, name });
    };

    await addIfMissing('catalog_products', ['show_in_store', 'active'], 'idx_cp_store_active');
    await addIfMissing('catalog_products', ['category'], 'idx_cp_category');
    await addIfMissing('catalog_products', ['gender'], 'idx_cp_gender');
    await addIfMissing('catalog_products', ['garment_type_id'], 'idx_cp_garment_type');
    await addIfMissing('catalog_product_sizes', ['product_id'], 'idx_cps_product');
  },

  async down(queryInterface) {
    const drop = (table, name) => queryInterface.removeIndex(table, name).catch(() => {});
    await drop('catalog_products', 'idx_cp_store_active');
    await drop('catalog_products', 'idx_cp_category');
    await drop('catalog_products', 'idx_cp_gender');
    await drop('catalog_products', 'idx_cp_garment_type');
    await drop('catalog_product_sizes', 'idx_cps_product');
  },
};
