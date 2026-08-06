'use strict';

/**
 * Ledger de stock de productos de catálogo (tienda online + mayorista).
 * Cierra C-5: hoy ninguna modificación de catalog_products.stock_quantity /
 * catalog_product_sizes.stock_quantity deja rastro. Esta tabla es el destino
 * único de src/services/stockLedger.service.ts, el único punto del sistema
 * que debe modificar esas columnas de ahora en más.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('catalog_stock_movements')) {
      await queryInterface.createTable('catalog_stock_movements', {
        id: {
          type: Sequelize.INTEGER.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
        },
        catalog_product_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          references: { model: 'catalog_products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        // Nullable: productos sin talles solo tocan catalog_products.stock_quantity.
        catalog_product_size_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'catalog_product_sizes', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        type: {
          type: Sequelize.ENUM('sale', 'return', 'cancel', 'adjustment', 'in', 'out', 'transfer'),
          allowNull: false,
        },
        quantity: { type: Sequelize.INTEGER, allowNull: false },
        previous_quantity: { type: Sequelize.INTEGER, allowNull: false },
        new_quantity: { type: Sequelize.INTEGER, allowNull: false },
        reason: { type: Sequelize.STRING(255), allowNull: true },
        source: {
          type: Sequelize.ENUM('store', 'catalog', 'manual', 'system'),
          allowNull: false,
        },
        store_order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'store_orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        catalog_order_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'catalog_orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        // NULL = proceso automático del sistema (sin usuario staff detrás).
        user_id: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        notes: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });

      await queryInterface.addIndex('catalog_stock_movements', ['catalog_product_id'], {
        name: 'idx_catalog_stock_movements_product',
      });
      await queryInterface.addIndex('catalog_stock_movements', ['catalog_product_size_id'], {
        name: 'idx_catalog_stock_movements_size',
      });
      await queryInterface.addIndex('catalog_stock_movements', ['store_order_id'], {
        name: 'idx_catalog_stock_movements_store_order',
      });
      await queryInterface.addIndex('catalog_stock_movements', ['catalog_order_id'], {
        name: 'idx_catalog_stock_movements_catalog_order',
      });
      await queryInterface.addIndex('catalog_stock_movements', ['createdAt'], {
        name: 'idx_catalog_stock_movements_created_at',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('catalog_stock_movements');
  },
};
