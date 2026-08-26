'use strict';

/**
 * Contador atómico para el número de pedido de la tienda (ECOM-YYYYMMDD-NNNN).
 *
 * Reemplaza el patrón anterior (SELECT último order_number LIKE 'prefix%' →
 * calcular +1 → INSERT), que bajo checkouts concurrentes hacía que dos
 * transacciones calcularan el mismo próximo número: el índice único de
 * `order_number` evitaba el duplicado real, pero tiraba abajo el checkout de
 * una de las dos con 409 "Valor duplicado". Agregarle `SELECT ... FOR UPDATE`
 * a ese SELECT (para serializar) tampoco funcionó: al ser un rango (LIKE +
 * ORDER BY DESC LIMIT 1) InnoDB toma gap/next-key locks, y eso generó
 * deadlocks reales entre checkouts concurrentes de productos distintos.
 * Reproducido con el test de carga (backIndians/stress/k6/03-checkout-transfer.js).
 *
 * Esta tabla usa el modismo estándar de MySQL para un contador atómico por
 * clave (`INSERT ... ON DUPLICATE KEY UPDATE next_seq = LAST_INSERT_ID(next_seq + 1)`
 * + `SELECT LAST_INSERT_ID()`): una sola sentencia, sin ventana de carrera,
 * con locking de fila exacta por PK (no de rango) — no genera el mismo tipo
 * de deadlock. Ver `getNextStoreOrderSequence` en store.service.ts.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('store_order_sequences')) return;

    await queryInterface.createTable('store_order_sequences', {
      date_key: { type: Sequelize.STRING(8), allowNull: false, primaryKey: true },
      next_seq: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_order_sequences');
  },
};
