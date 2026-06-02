'use strict';

/**
 * Crea las tablas base que en desarrollo generaba sequelize.sync().
 * Todas las tablas usan IF NOT EXISTS via la verificación previa de showAllTables(),
 * por lo que es seguro correr en entornos donde ya existan.
 *
 * Schema INICIAL (antes de las migraciones 004–015 que hacen ALTER TABLE).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const existing = await queryInterface.showAllTables();
    const has = (t) => existing.includes(t);

    // ── users ──────────────────────────────────────────────────────────────────
    // role sin 'seller' (004 lo agrega)
    if (!has('users')) {
      await queryInterface.createTable('users', {
        id:            { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        name:          { type: Sequelize.STRING(150), allowNull: false },
        email:         { type: Sequelize.STRING(255), allowNull: false, unique: true },
        password_hash: { type: Sequelize.STRING(255), allowNull: false },
        role: {
          type: Sequelize.ENUM('admin', 'billing', 'workshop'),
          allowNull: false,
          defaultValue: 'workshop',
        },
        active:    { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── clients ────────────────────────────────────────────────────────────────
    if (!has('clients')) {
      await queryInterface.createTable('clients', {
        id:           { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        name:         { type: Sequelize.STRING(200), allowNull: false },
        contact_name: { type: Sequelize.STRING(150), allowNull: true },
        phone:        { type: Sequelize.STRING(50),  allowNull: true },
        email:        { type: Sequelize.STRING(255), allowNull: true },
        address:      { type: Sequelize.STRING(500), allowNull: true },
        cuit:         { type: Sequelize.STRING(30),  allowNull: true },
        notes:        { type: Sequelize.TEXT,        allowNull: true },
        createdAt:    { type: Sequelize.DATE, allowNull: false },
        updatedAt:    { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── orders ─────────────────────────────────────────────────────────────────
    // sin order_number ni seller_id (005 los agrega)
    // status con valores viejos (009 los actualiza)
    if (!has('orders')) {
      await queryInterface.createTable('orders', {
        id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        client_id: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'clients', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        created_by: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        status: {
          type: Sequelize.ENUM('pending', 'in_progress', 'quality_check', 'ready', 'delivered', 'cancelled'),
          allowNull: false,
          defaultValue: 'pending',
        },
        delivery_date:  { type: Sequelize.DATEONLY,      allowNull: true },
        total_amount:   { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        notes:          { type: Sequelize.TEXT, allowNull: true },
        workshop_notes: { type: Sequelize.TEXT, allowNull: true },
        createdAt:      { type: Sequelize.DATE, allowNull: false },
        updatedAt:      { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── order_items ────────────────────────────────────────────────────────────
    // schema mínimo previo a migración 006 (que reestructura la tabla)
    if (!has('order_items')) {
      await queryInterface.createTable('order_items', {
        id:       { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        order_id: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        color:      { type: Sequelize.STRING(100),    allowNull: true },
        unit_price: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        createdAt:  { type: Sequelize.DATE, allowNull: false },
        updatedAt:  { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── order_images ───────────────────────────────────────────────────────────
    if (!has('order_images')) {
      await queryInterface.createTable('order_images', {
        id:                   { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        order_id: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        url:                  { type: Sequelize.STRING(1000), allowNull: false },
        cloudinary_public_id: { type: Sequelize.STRING(500),  allowNull: false },
        description:          { type: Sequelize.STRING(500),  allowNull: true },
        uploaded_by: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── order_status_history ───────────────────────────────────────────────────
    // status con valores viejos (010 los actualiza)
    if (!has('order_status_history')) {
      await queryInterface.createTable('order_status_history', {
        id:       { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        order_id: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'CASCADE',
        },
        previous_status: {
          type: Sequelize.ENUM('pending', 'in_progress', 'quality_check', 'ready', 'delivered', 'cancelled'),
          allowNull: true,
        },
        new_status: {
          type: Sequelize.ENUM('pending', 'in_progress', 'quality_check', 'ready', 'delivered', 'cancelled'),
          allowNull: false,
        },
        comment:    { type: Sequelize.TEXT, allowNull: true },
        changed_by: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── invoices ───────────────────────────────────────────────────────────────
    // sin notes/discount_amount/extra_items/total_amount (012 los agrega)
    if (!has('invoices')) {
      await queryInterface.createTable('invoices', {
        id:       { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        order_id: {
          type: Sequelize.INTEGER.UNSIGNED, allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE', onDelete: 'RESTRICT',
        },
        invoice_number: { type: Sequelize.STRING(50),   allowNull: false },
        issue_date:     { type: Sequelize.DATEONLY,      allowNull: false },
        due_date:       { type: Sequelize.DATEONLY,      allowNull: true  },
        status: {
          type: Sequelize.ENUM('draft', 'issued', 'paid', 'cancelled'),
          allowNull: false,
          defaultValue: 'draft',
        },
        pdf_url:   { type: Sequelize.STRING(1000), allowNull: true  },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // ── stock_items ────────────────────────────────────────────────────────────
    // sin category_id/description/active (013 los agrega)
    if (!has('stock_items')) {
      await queryInterface.createTable('stock_items', {
        id:               { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        name:             { type: Sequelize.STRING(200),    allowNull: false },
        unit:             { type: Sequelize.STRING(50),     allowNull: false, defaultValue: 'unidad' },
        current_quantity: { type: Sequelize.DECIMAL(12, 3), allowNull: false, defaultValue: 0 },
        min_quantity:     { type: Sequelize.DECIMAL(12, 3), allowNull: false, defaultValue: 0 },
        createdAt:        { type: Sequelize.DATE, allowNull: false },
        updatedAt:        { type: Sequelize.DATE, allowNull: false },
      });
    }
  },

  async down(queryInterface) {
    // Orden inverso respetando FK
    await queryInterface.dropTable('stock_items');
    await queryInterface.dropTable('invoices');
    await queryInterface.dropTable('order_status_history');
    await queryInterface.dropTable('order_images');
    await queryInterface.dropTable('order_items');
    await queryInterface.dropTable('orders');
    await queryInterface.dropTable('clients');
    await queryInterface.dropTable('users');
  },
};
