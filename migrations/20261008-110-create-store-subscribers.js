'use strict';

/**
 * Suscriptores del pop-up de registro con descuento (brief de modificaciones web
 * 06.10.2026, pedido 03).
 *
 * Un visitante deja su email (y opcionalmente su nombre) y recibe un cupón
 * PERSONAL de un solo uso, que se crea como una fila más de `store_coupons`.
 * Esta tabla guarda el registro y la relación con ese cupón.
 *
 * - `email` único (guardado en minúsculas): un mismo email no puede pedir el
 *   beneficio dos veces. La unicidad vive solo acá (convención de `suppliers`).
 * - `coupon_id` sin FK a propósito: borrar un cupón desde el panel no debe
 *   borrar el registro de la persona.
 * - `consent_at`: cuándo vio y aceptó el aviso de privacidad del pop-up.
 *
 * Migración aditiva: no altera ni borra nada existente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('store_subscribers')) return;

    await queryInterface.createTable('store_subscribers', {
      id:             { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      email:          { type: Sequelize.STRING(254), allowNull: false },
      name:           { type: Sequelize.STRING(100), allowNull: true, defaultValue: null },
      coupon_id:      { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      source:         { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'welcome_popup' },
      consent_at:     { type: Sequelize.DATE, allowNull: false },
      coupon_sent_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
      createdAt:      { type: Sequelize.DATE, allowNull: false },
      updatedAt:      { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addConstraint('store_subscribers', {
      fields: ['email'],
      type: 'unique',
      name: 'uq_store_subscribers_email',
    });
    await queryInterface.addIndex('store_subscribers', ['createdAt'], { name: 'idx_store_subscribers_created_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_subscribers');
  },
};
