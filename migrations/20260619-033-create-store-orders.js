'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes('store_coupons')) {
      await queryInterface.createTable('store_coupons', {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        code: {
          type: Sequelize.STRING(50),
          allowNull: false,
          unique: true,
        },
        description: {
          type: Sequelize.STRING(300),
          allowNull: true,
        },
        type: {
          type: Sequelize.ENUM('percentage', 'fixed'),
          allowNull: false,
        },
        value: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
        },
        min_purchase: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: null,
        },
        max_uses: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        used_count: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          defaultValue: 0,
        },
        active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        starts_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      });
    }

    if (!tables.includes('store_orders')) {
      await queryInterface.createTable('store_orders', {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        order_number: {
          type: Sequelize.STRING(30),
          allowNull: false,
          unique: true,
        },
        customer_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'store_customers', key: 'id' },
          onDelete: 'SET NULL',
        },
        // Snapshot de datos del comprador al momento del pedido
        customer_name: {
          type: Sequelize.STRING(200),
          allowNull: false,
        },
        customer_email: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        customer_phone: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'),
          allowNull: false,
          defaultValue: 'pending_payment',
        },
        subtotal: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        discount_amount: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        shipping_cost: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        total_amount: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0,
        },
        shipping_type: {
          type: Sequelize.ENUM('pickup', 'delivery'),
          allowNull: false,
          defaultValue: 'pickup',
        },
        shipping_address: {
          type: Sequelize.JSON,
          allowNull: true,
        },
        coupon_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'store_coupons', key: 'id' },
          onDelete: 'SET NULL',
        },
        coupon_code: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        mp_preference_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        mp_payment_id: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        mp_status: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      });

      await queryInterface.addIndex('store_orders', ['customer_id'], { name: 'idx_store_orders_customer_id' });
      await queryInterface.addIndex('store_orders', ['status'], { name: 'idx_store_orders_status' });
      await queryInterface.addIndex('store_orders', ['createdAt'], { name: 'idx_store_orders_created_at' });
    }

    if (!tables.includes('store_order_items')) {
      await queryInterface.createTable('store_order_items', {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        store_order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'store_orders', key: 'id' },
          onDelete: 'CASCADE',
        },
        catalog_product_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'catalog_products', key: 'id' },
          onDelete: 'RESTRICT',
        },
        product_title: {
          type: Sequelize.STRING(200),
          allowNull: false,
        },
        size_name: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        quantity: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          defaultValue: 1,
        },
        unit_price: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
        },
        subtotal: {
          type: Sequelize.DECIMAL(12, 2),
          allowNull: false,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
        },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('store_order_items');
    await queryInterface.dropTable('store_orders');
    await queryInterface.dropTable('store_coupons');
  },
};
