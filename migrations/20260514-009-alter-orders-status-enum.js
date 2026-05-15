'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    // 1. Soltar el ENUM convirtiéndolo a VARCHAR (libera la restricción de valores)
    await queryInterface.changeColumn('orders', 'status', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'pending',
    });

    // 2. Mapear valores viejos a los nuevos equivalentes
    await q.query(`UPDATE orders SET status = 'in_production' WHERE status = 'in_progress'`);
    await q.query(`UPDATE orders SET status = 'ready'         WHERE status = 'delivered'`);
    // Cualquier valor inválido que quedara, llevarlo a 'pending'
    await q.query(`
      UPDATE orders SET status = 'pending'
      WHERE status NOT IN (
        'pending','under_review','workshop_review',
        'observed','in_production','quality_check','ready','cancelled'
      )
    `);

    // 3. Aplicar el ENUM nuevo
    await queryInterface.changeColumn('orders', 'status', {
      type: Sequelize.ENUM(
        'pending',
        'under_review',
        'workshop_review',
        'observed',
        'in_production',
        'quality_check',
        'ready',
        'cancelled'
      ),
      allowNull: false,
      defaultValue: 'pending',
    });
  },

  async down(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    await queryInterface.changeColumn('orders', 'status', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'pending',
    });

    await q.query(`UPDATE orders SET status = 'in_progress' WHERE status = 'in_production'`);
    await q.query(`UPDATE orders SET status = 'delivered'   WHERE status = 'ready'`);
    await q.query(`
      UPDATE orders SET status = 'pending'
      WHERE status NOT IN ('pending','in_progress','quality_check','ready','delivered','cancelled')
    `);

    await queryInterface.changeColumn('orders', 'status', {
      type: Sequelize.ENUM(
        'pending',
        'in_progress',
        'quality_check',
        'ready',
        'delivered',
        'cancelled'
      ),
      allowNull: false,
      defaultValue: 'pending',
    });
  },
};
