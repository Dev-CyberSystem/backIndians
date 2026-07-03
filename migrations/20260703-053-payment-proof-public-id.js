'use strict';

/** @type {import('sequelize').QueryInterface} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // public_id de Cloudinary de cada comprobante (subidos como `authenticated`).
    // Permite generar URLs firmadas de acceso en cada lectura, en vez de guardar
    // una URL pública permanente. NULL = comprobante viejo (público) → se sigue
    // sirviendo su URL guardada tal cual (compatibilidad hacia atrás).
    await queryInterface.addColumn('store_orders', 'payment_proof_public_id', {
      type: Sequelize.STRING(300),
      allowNull: true,
      defaultValue: null,
      after: 'payment_proof_url_2',
    });
    await queryInterface.addColumn('store_orders', 'payment_proof_public_id_2', {
      type: Sequelize.STRING(300),
      allowNull: true,
      defaultValue: null,
      after: 'payment_proof_public_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_orders', 'payment_proof_public_id_2');
    await queryInterface.removeColumn('store_orders', 'payment_proof_public_id');
  },
};
