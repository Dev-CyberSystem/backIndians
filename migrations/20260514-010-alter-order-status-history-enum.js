'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    // previous_status — paso a VARCHAR
    await queryInterface.changeColumn('order_status_history', 'previous_status', {
      type: Sequelize.STRING(30),
      allowNull: true,
    });
    // new_status — paso a VARCHAR
    await queryInterface.changeColumn('order_status_history', 'new_status', {
      type: Sequelize.STRING(30),
      allowNull: false,
    });

    // Mapear valores viejos
    await q.query(`UPDATE order_status_history SET previous_status = 'in_production' WHERE previous_status = 'in_progress'`);
    await q.query(`UPDATE order_status_history SET new_status      = 'in_production' WHERE new_status      = 'in_progress'`);
    await q.query(`UPDATE order_status_history SET previous_status = 'ready'         WHERE previous_status = 'delivered'`);
    await q.query(`UPDATE order_status_history SET new_status      = 'ready'         WHERE new_status      = 'delivered'`);

    // Valores inválidos → null / pending
    await q.query(`
      UPDATE order_status_history SET previous_status = NULL
      WHERE previous_status IS NOT NULL
        AND previous_status NOT IN (
          'pending','under_review','workshop_review',
          'observed','in_production','quality_check','ready','cancelled'
        )
    `);
    await q.query(`
      UPDATE order_status_history SET new_status = 'pending'
      WHERE new_status NOT IN (
        'pending','under_review','workshop_review',
        'observed','in_production','quality_check','ready','cancelled'
      )
    `);

    const newEnum = Sequelize.ENUM(
      'pending', 'under_review', 'workshop_review',
      'observed', 'in_production', 'quality_check', 'ready', 'cancelled'
    );

    await queryInterface.changeColumn('order_status_history', 'previous_status', {
      type: newEnum,
      allowNull: true,
    });
    await queryInterface.changeColumn('order_status_history', 'new_status', {
      type: newEnum,
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    await queryInterface.changeColumn('order_status_history', 'previous_status', {
      type: Sequelize.STRING(30),
      allowNull: true,
    });
    await queryInterface.changeColumn('order_status_history', 'new_status', {
      type: Sequelize.STRING(30),
      allowNull: false,
    });

    await q.query(`UPDATE order_status_history SET previous_status = 'in_progress' WHERE previous_status = 'in_production'`);
    await q.query(`UPDATE order_status_history SET new_status      = 'in_progress' WHERE new_status      = 'in_production'`);
    await q.query(`UPDATE order_status_history SET previous_status = 'delivered'   WHERE previous_status = 'ready'`);
    await q.query(`UPDATE order_status_history SET new_status      = 'delivered'   WHERE new_status      = 'ready'`);

    await q.query(`
      UPDATE order_status_history SET previous_status = NULL
      WHERE previous_status IS NOT NULL
        AND previous_status NOT IN ('pending','in_progress','quality_check','ready','delivered','cancelled')
    `);
    await q.query(`
      UPDATE order_status_history SET new_status = 'pending'
      WHERE new_status NOT IN ('pending','in_progress','quality_check','ready','delivered','cancelled')
    `);

    const oldEnum = Sequelize.ENUM(
      'pending', 'in_progress', 'quality_check', 'ready', 'delivered', 'cancelled'
    );

    await queryInterface.changeColumn('order_status_history', 'previous_status', {
      type: oldEnum,
      allowNull: true,
    });
    await queryInterface.changeColumn('order_status_history', 'new_status', {
      type: oldEnum,
      allowNull: false,
    });
  },
};
