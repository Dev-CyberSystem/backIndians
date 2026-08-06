'use strict';

/**
 * Usuario "Sistema" (2.3 — Fase 2): responsable de las transacciones de caja
 * que crea el sistema automáticamente (p. ej. el webhook de MercadoPago
 * confirma un pago y no hay ningún admin humano detrás del cambio).
 * `cash_transactions.created_by` es NOT NULL — no hay forma de dejarlo en
 * null como sí se puede con `catalog_stock_movements.user_id`.
 *
 * `active: false` y un password_hash inutilizable (no es un bcrypt hash de
 * nada real): este usuario NUNCA debe poder loguearse, es solo un ancla de
 * FK para atribuir acciones automáticas.
 */

const SYSTEM_EMAIL = 'sistema@indians.internal';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO users (name, email, password_hash, role, active, session_version, createdAt, updatedAt)
       VALUES (?, ?, ?, 'admin', 0, 1, ?, ?)`,
      { replacements: ['Sistema', SYSTEM_EMAIL, 'DISABLED-NO-LOGIN', now, now] }
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM users WHERE email = ?', {
      replacements: [SYSTEM_EMAIL],
    });
  },
};
