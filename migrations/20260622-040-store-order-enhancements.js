'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Ampliar el ENUM de status con los nuevos estados del flujo de despacho
    await queryInterface.sequelize.query(`
      ALTER TABLE store_orders
      MODIFY COLUMN status
      ENUM('pending_payment','paid','processing','review','awaiting_courier','shipped','delivered','cancelled')
      NOT NULL DEFAULT 'pending_payment'
    `);

    // 2. Campo para el número de seguimiento del envío
    await queryInterface.addColumn('store_orders', 'tracking_number', {
      type: Sequelize.STRING(200),
      allowNull: true,
      after: 'mp_status',
    });

    // 3. Campo para el nombre del correo/empresa de envío
    await queryInterface.addColumn('store_orders', 'courier_name', {
      type: Sequelize.STRING(200),
      allowNull: true,
      after: 'tracking_number',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_orders', 'tracking_number');
    await queryInterface.removeColumn('store_orders', 'courier_name');
    await queryInterface.sequelize.query(`
      ALTER TABLE store_orders
      MODIFY COLUMN status
      ENUM('pending_payment','paid','processing','shipped','delivered','cancelled')
      NOT NULL DEFAULT 'pending_payment'
    `);
  },
};
