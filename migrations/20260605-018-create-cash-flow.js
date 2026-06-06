'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();

    // ── cash_accounts ──────────────────────────────────────────────────────────
    if (!tables.includes('cash_accounts')) {
      await queryInterface.createTable('cash_accounts', {
        id:              { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        name:            { type: Sequelize.STRING(150), allowNull: false },
        type:            { type: Sequelize.ENUM('cash', 'petty_cash', 'bank'), allowNull: false },
        current_balance: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        description:     { type: Sequelize.TEXT, allowNull: true },
        active:          { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt:       { type: Sequelize.DATE, allowNull: false },
        updatedAt:       { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── cash_transaction_categories ───────────────────────────────────────────
    if (!tables.includes('cash_transaction_categories')) {
      await queryInterface.createTable('cash_transaction_categories', {
        id:        { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        name:      { type: Sequelize.STRING(150), allowNull: false },
        type:      { type: Sequelize.ENUM('income', 'expense', 'both'), allowNull: false },
        color:     { type: Sequelize.STRING(10), allowNull: true },
        is_system: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        active:    { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── cash_transactions ─────────────────────────────────────────────────────
    if (!tables.includes('cash_transactions')) {
      await queryInterface.createTable('cash_transactions', {
        id:                  { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        account_id:          { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'cash_accounts', key: 'id' } },
        category_id:         { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'cash_transaction_categories', key: 'id' } },
        type:                { type: Sequelize.ENUM('income', 'expense', 'transfer'), allowNull: false },
        amount:              { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        description:         { type: Sequelize.STRING(255), allowNull: false },
        date:                { type: Sequelize.DATEONLY, allowNull: false },
        reference_type:      { type: Sequelize.ENUM('invoice', 'order'), allowNull: true },
        reference_id:        { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
        transfer_account_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, references: { model: 'cash_accounts', key: 'id' } },
        created_by:          { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, references: { model: 'users', key: 'id' } },
        notes:               { type: Sequelize.TEXT, allowNull: true },
        createdAt:           { type: Sequelize.DATE, allowNull: false },
        updatedAt:           { type: Sequelize.DATE, allowNull: false },
      });

      await queryInterface.addIndex('cash_transactions', ['account_id']);
      await queryInterface.addIndex('cash_transactions', ['category_id']);
      await queryInterface.addIndex('cash_transactions', ['date']);
      await queryInterface.addIndex('cash_transactions', ['type']);
    }

    // ── Seeds idempotentes ────────────────────────────────────────────────────
    const now = new Date();

    const [catRows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM cash_transaction_categories WHERE is_system = 1'
    );
    if (Number(catRows[0].cnt) === 0) {
      await queryInterface.bulkInsert('cash_transaction_categories', [
        { name: 'Cobro de Factura',  type: 'income',  color: '#10B981', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Venta Contado',     type: 'income',  color: '#059669', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Pago a Proveedor',  type: 'expense', color: '#EF4444', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Sueldo / Empleado', type: 'expense', color: '#DC2626', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Servicios',         type: 'expense', color: '#F97316', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Alquiler',          type: 'expense', color: '#B91C1C', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Caja Chica',        type: 'both',    color: '#8B5CF6', is_system: true, active: true, createdAt: now, updatedAt: now },
        { name: 'Otros',             type: 'both',    color: '#6B7280', is_system: true, active: true, createdAt: now, updatedAt: now },
      ]);
    }

    const [accRows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS cnt FROM cash_accounts'
    );
    if (Number(accRows[0].cnt) === 0) {
      await queryInterface.bulkInsert('cash_accounts', [
        { name: 'Caja Principal', type: 'cash',       current_balance: 0, description: null, active: true, createdAt: now, updatedAt: now },
        { name: 'Caja Chica',     type: 'petty_cash', current_balance: 0, description: null, active: true, createdAt: now, updatedAt: now },
        { name: 'Banco',          type: 'bank',       current_balance: 0, description: null, active: true, createdAt: now, updatedAt: now },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cash_transactions');
    await queryInterface.dropTable('cash_transaction_categories');
    await queryInterface.dropTable('cash_accounts');
  },
};
