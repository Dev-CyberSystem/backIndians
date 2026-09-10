'use strict';

/**
 * Rol "Diseñador" (`designer`) para el sistema de gestión.
 *
 * El diseñador carga pedidos de producción con la ficha técnica completa y los
 * manda al taller, pero nunca ve costos de producción ni la facturación al
 * cliente (mismo criterio que el taller con los precios). Cambia estados solo
 * hasta `workshop_review`. Ver `ORDER_STATUS_TRANSITIONS` en
 * `src/services/order.service.ts` y `stripPricingForRoles`.
 *
 * Amplía el ENUM de `users.role`. No migra ninguna fila: los usuarios
 * existentes conservan su rol.
 *
 * OJO: replicado en `src/config/ensureSchema.ts` (en desarrollo la DB se
 * sincroniza con `sequelize.sync()`, que no altera ENUMs existentes).
 */

const FULL_ENUM = "ENUM('admin','billing','workshop','seller','designer')";
const PREV_ENUM = "ENUM('admin','billing','workshop','seller')";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    await q.query(
      `ALTER TABLE users MODIFY COLUMN role ${FULL_ENUM} NOT NULL DEFAULT 'workshop'`
    );
  },

  async down(queryInterface) {
    const q = queryInterface.sequelize;

    // Sin destino natural para un diseñador en el flujo previo: se degrada a
    // taller (rol por defecto), que es el más acotado de los internos.
    await q.query(`UPDATE users SET role='workshop' WHERE role='designer'`);
    await q.query(
      `ALTER TABLE users MODIFY COLUMN role ${PREV_ENUM} NOT NULL DEFAULT 'workshop'`
    );
  },
};
