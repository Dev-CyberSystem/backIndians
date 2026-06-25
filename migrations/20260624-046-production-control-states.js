'use strict';

// ENUM completo: estados base + controles de producción (nuevos) + legados (para el historial).
const FULL_ENUM =
  "ENUM('pending','under_review','workshop_review','observed'," +
  "'raw_material_control','cutting_control','printing_control','sewing_control','quality_control','packaging_control'," +
  "'ready','cancelled'," +
  "'in_production','sewing','stamping','quality_check')";

const OLD_ENUM =
  "ENUM('pending','under_review','workshop_review','observed'," +
  "'in_production','sewing','stamping','quality_check','ready','cancelled')";

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    // 1. Ampliar el ENUM de estados en orders y en el historial.
    await q.query(`ALTER TABLE orders MODIFY COLUMN status ${FULL_ENUM} NOT NULL DEFAULT 'pending'`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN previous_status ${FULL_ENUM} NULL`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN new_status ${FULL_ENUM} NOT NULL`);

    // 2. Migrar pedidos activos de los estados legados a los nuevos controles.
    await q.query(`UPDATE orders SET status='raw_material_control' WHERE status='in_production'`);
    await q.query(`UPDATE orders SET status='printing_control'     WHERE status='stamping'`);
    await q.query(`UPDATE orders SET status='sewing_control'       WHERE status='sewing'`);
    await q.query(`UPDATE orders SET status='quality_control'      WHERE status='quality_check'`);

    // 3. Tabla de tildes del checklist (auditoría por ítem).
    const tables = await queryInterface.showAllTables();
    const has = tables.map((t) => (typeof t === 'string' ? t : t.tableName));
    if (!has.includes('order_checklist_checks')) {
      await queryInterface.createTable('order_checklist_checks', {
        id:         { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        order_id:   { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        status:     { type: Sequelize.STRING(50), allowNull: false },
        item_key:   { type: Sequelize.STRING(80), allowNull: false },
        checked_by: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        createdAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      });
      await queryInterface.addIndex('order_checklist_checks', ['order_id', 'status', 'item_key'], {
        unique: true,
        name: 'uniq_order_checklist_item',
      });
      await queryInterface.addConstraint('order_checklist_checks', {
        fields: ['order_id'],
        type: 'foreign key',
        name: 'fk_checklist_order',
        references: { table: 'orders', field: 'id' },
        onDelete: 'CASCADE',
      });
    }
  },

  async down(queryInterface) {
    const q = queryInterface.sequelize;

    // Revertir pedidos a los estados legados (best-effort).
    await q.query(`UPDATE orders SET status='in_production' WHERE status IN ('raw_material_control','cutting_control')`);
    await q.query(`UPDATE orders SET status='stamping'      WHERE status='printing_control'`);
    await q.query(`UPDATE orders SET status='sewing'        WHERE status='sewing_control'`);
    await q.query(`UPDATE orders SET status='quality_check' WHERE status IN ('quality_control','packaging_control')`);

    await queryInterface.dropTable('order_checklist_checks').catch(() => {});

    await q.query(`ALTER TABLE orders MODIFY COLUMN status ${OLD_ENUM} NOT NULL DEFAULT 'pending'`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN previous_status ${OLD_ENUM} NULL`);
    await q.query(`ALTER TABLE order_status_history MODIFY COLUMN new_status ${OLD_ENUM} NOT NULL`);
  },
};
