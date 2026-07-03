'use strict';

/**
 * Índice sobre store_customers.verification_token.
 *
 * Justificación: verificación de email (storeVerifyEmailService) y reset de
 * contraseña (storeResetPasswordService) hacen `findOne({ where: { verification_token } })`.
 * Sin índice esos lookups eran full scan de store_customers; con él es una
 * búsqueda por índice O(log n), que además escala con la base de compradores.
 *
 * No es UNIQUE a propósito: puede haber múltiples filas con NULL (tokens ya
 * consumidos) y MySQL permite muchos NULL en un índice no único.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('store_customers', ['verification_token'], {
      name: 'idx_store_customers_verification_token',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('store_customers', 'idx_store_customers_verification_token');
  },
};
