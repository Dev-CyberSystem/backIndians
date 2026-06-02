'use strict';

/**
 * Agrega índices en columnas de alta frecuencia de consulta.
 * Las FK ya están indexadas automáticamente por InnoDB.
 * Estos índices cubren los patrones de filtro/range más usados en producción.
 */
module.exports = {
  async up(queryInterface) {
    // orders: filtros por fecha, estado y fecha de entrega
    await queryInterface.addIndex('orders', ['createdAt'],     { name: 'idx_orders_created_at' });
    await queryInterface.addIndex('orders', ['status'],        { name: 'idx_orders_status' });
    await queryInterface.addIndex('orders', ['delivery_date'], { name: 'idx_orders_delivery_date' });

    // invoices: filtros por fecha y estado en dashboard y listados
    await queryInterface.addIndex('invoices', ['issue_date'], { name: 'idx_invoices_issue_date' });
    await queryInterface.addIndex('invoices', ['status'],     { name: 'idx_invoices_status' });
    await queryInterface.addIndex('invoices', ['due_date'],   { name: 'idx_invoices_due_date' });

    // stock_items: filtro por estado de stock (active + quantity comparisons)
    await queryInterface.addIndex('stock_items', ['active'],           { name: 'idx_stock_items_active' });
    await queryInterface.addIndex('stock_items', ['current_quantity'], { name: 'idx_stock_items_qty' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('orders',      'idx_orders_created_at');
    await queryInterface.removeIndex('orders',      'idx_orders_status');
    await queryInterface.removeIndex('orders',      'idx_orders_delivery_date');
    await queryInterface.removeIndex('invoices',    'idx_invoices_issue_date');
    await queryInterface.removeIndex('invoices',    'idx_invoices_status');
    await queryInterface.removeIndex('invoices',    'idx_invoices_due_date');
    await queryInterface.removeIndex('stock_items', 'idx_stock_items_active');
    await queryInterface.removeIndex('stock_items', 'idx_stock_items_qty');
  },
};
