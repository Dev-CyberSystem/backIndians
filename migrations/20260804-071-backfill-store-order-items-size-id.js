'use strict';

/**
 * Backfill de catalog_product_size_id para store_order_items históricos
 * (1.10 / M-8). Resuelve por (catalog_product_id, size_name) SOLO cuando hay
 * una coincidencia unívoca en catalog_product_sizes (exactamente una fila
 * con ese product_id + size_name) — si el talle es ambiguo, no existe más,
 * o el ítem no tiene size_name (producto sin talles), se deja NULL: no
 * inventa datos. Idempotente: solo toca filas con catalog_product_size_id
 * todavía NULL, así que correrla de nuevo no cambia nada.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE store_order_items soi
      JOIN (
        SELECT product_id, size_name, MIN(id) AS size_id
        FROM catalog_product_sizes
        GROUP BY product_id, size_name
        HAVING COUNT(*) = 1
      ) matched
        ON matched.product_id = soi.catalog_product_id
        AND matched.size_name = soi.size_name
      SET soi.catalog_product_size_id = matched.size_id
      WHERE soi.catalog_product_size_id IS NULL
        AND soi.size_name IS NOT NULL
    `);
  },

  // No-op a propósito: es un backfill de datos, no de esquema. Revertir la
  // columna (si hiciera falta) ya lo hace el down() de la migración 070.
  async down() {},
};
