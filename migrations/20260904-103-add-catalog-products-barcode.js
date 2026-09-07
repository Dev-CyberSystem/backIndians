'use strict';

/**
 * Código de barras único por producto de catálogo.
 *
 * Cada `CatalogProduct` recibe un código Code128 (`PRD-NNNNNN`, basado en su
 * `id`) para poder imprimirlo/escanearlo físicamente. Se genera automáticamente:
 *   - Productos nuevos: al crearlos, en `catalog.service.ts` (`createProduct`).
 *   - Productos ya existentes: backfill acá mismo, determinístico por `id`.
 *
 * El índice único se crea con `addIndex` explícito (no `unique: true` en el
 * atributo del modelo) para no duplicarlo bajo `sync()` en desarrollo — mismo
 * patrón ya usado para `cash_transactions.idempotency_key` (ver comentario en
 * `ensureSchema.ts` y la regla en `CLAUDE.md` sobre no repetir el caso
 * `OrderChecklistCheck`).
 *
 * OJO: replicado en `src/config/ensureSchema.ts` (en desarrollo la DB se
 * sincroniza con `sequelize.sync()`, que no altera tablas existentes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('catalog_products');

    if (!table.barcode) {
      await queryInterface.addColumn('catalog_products', 'barcode', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }

    const indexes = await queryInterface.showIndex('catalog_products');
    const hasBarcodeIndex = indexes.some((ix) => ix.name === 'uq_catalog_products_barcode');
    if (!hasBarcodeIndex) {
      await queryInterface.addIndex('catalog_products', ['barcode'], {
        name: 'uq_catalog_products_barcode',
        unique: true,
      });
    }

    await queryInterface.sequelize.query(
      "UPDATE catalog_products SET barcode = CONCAT('PRD-', LPAD(id, 6, '0')) WHERE barcode IS NULL"
    );
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('catalog_products');
    const hasBarcodeIndex = indexes.some((ix) => ix.name === 'uq_catalog_products_barcode');
    if (hasBarcodeIndex) {
      await queryInterface.removeIndex('catalog_products', 'uq_catalog_products_barcode');
    }

    const table = await queryInterface.describeTable('catalog_products');
    if (table.barcode) {
      await queryInterface.removeColumn('catalog_products', 'barcode');
    }
  },
};
