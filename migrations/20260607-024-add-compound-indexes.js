'use strict';

/**
 * Índices compuestos y columnas de alta frecuencia no cubiertas por 016.
 * - catalog_orders.createdAt: usado en todas las queries del dashboard de catálogo.
 * - (orders.createdAt, orders.status): queries del dashboard que filtran por período Y estado.
 * - (invoices.issue_date, invoices.status): queries de revenue que filtran por fecha Y estado.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('catalog_orders', ['createdAt'], {
      name: 'idx_catalog_orders_created_at',
    });
    await queryInterface.addIndex('orders', ['createdAt', 'status'], {
      name: 'idx_orders_created_at_status',
    });
    await queryInterface.addIndex('invoices', ['issue_date', 'status'], {
      name: 'idx_invoices_issue_date_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('catalog_orders', 'idx_catalog_orders_created_at');
    await queryInterface.removeIndex('orders',         'idx_orders_created_at_status');
    await queryInterface.removeIndex('invoices',       'idx_invoices_issue_date_status');
  },
};
