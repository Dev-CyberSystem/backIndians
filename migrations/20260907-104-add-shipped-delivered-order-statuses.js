'use strict';

/**
 * Estados "Enviado" y "Entregado" para el flujo de pedidos mayoristas.
 *
 * Después de "Listo para despacho" (`ready`) el pedido pasa a `shipped` (salió
 * del taller hacia el cliente) y luego a `delivered` (recibido por el cliente).
 * El taller marca `ready → shipped`; facturación/admin marca `shipped →
 * delivered`. Ver `ORDER_STATUS_TRANSITIONS` en `src/services/order.service.ts`.
 *
 * Amplía el ENUM de `orders.status` y de `order_status_history`
 * (`previous_status` / `new_status`). No migra ninguna fila: los pedidos ya
 * existentes conservan su estado.
 *
 * OJO: replicado en `src/config/ensureSchema.ts` (en desarrollo la DB se
 * sincroniza con `sequelize.sync()`, que no altera ENUMs existentes).
 */

const FULL_ENUM =
  "ENUM('pending','under_review','workshop_review','observed'," +
  "'raw_material_control','cutting_control','printing_control','sewing_control','quality_control','packaging_control'," +
  "'ready','shipped','delivered','cancelled'," +
  "'in_production','sewing','stamping','quality_check')";

const PREV_ENUM =
  "ENUM('pending','under_review','workshop_review','observed'," +
  "'raw_material_control','cutting_control','printing_control','sewing_control','quality_control','packaging_control'," +
  "'ready','cancelled'," +
  "'in_production','sewing','stamping','quality_check')";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    await q.query(`ALTER TABLE orders MODIFY COLUMN status ${FULL_ENUM} NOT NULL DEFAULT 'pending'`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN previous_status ${FULL_ENUM} NULL`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN new_status ${FULL_ENUM} NOT NULL`);
  },

  async down(queryInterface) {
    const q = queryInterface.sequelize;

    // Revertir pedidos en los estados nuevos al último estado del flujo previo.
    await q.query(`UPDATE orders SET status='ready' WHERE status IN ('shipped','delivered')`);
    await q.query(`UPDATE order_status_history SET previous_status='ready' WHERE previous_status IN ('shipped','delivered')`);
    await q.query(`UPDATE order_status_history SET new_status='ready' WHERE new_status IN ('shipped','delivered')`);

    await q.query(`ALTER TABLE orders MODIFY COLUMN status ${PREV_ENUM} NOT NULL DEFAULT 'pending'`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN previous_status ${PREV_ENUM} NULL`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN new_status ${PREV_ENUM} NOT NULL`);
  },
};
