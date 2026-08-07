'use strict';

/**
 * Idéntico a la migración 093, para el circuito de facturas de catálogo
 * (`addPaymentToCatalogInvoice` en `catalog.service.ts` es una copia
 * funcional de `addPaymentToInvoice` — hay que cerrar el mismo hueco en los
 * dos circuitos o queda una vía de cobranza sin asentar en caja).
 *
 * Ver comentarios completos en 20260807-093-invoice-payments-cash-link.js.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('catalog_invoice_payments');

    if (!table.payment_method) {
      await queryInterface.addColumn('catalog_invoice_payments', 'payment_method', {
        type: Sequelize.ENUM('cash', 'bank_transfer', 'mercadopago'),
        allowNull: false,
        after: 'amount',
      });
    }

    if (!table.cash_recorded_at) {
      await queryInterface.addColumn('catalog_invoice_payments', 'cash_recorded_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!table.idempotency_key) {
      await queryInterface.addColumn('catalog_invoice_payments', 'idempotency_key', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
      await queryInterface.addIndex('catalog_invoice_payments', ['idempotency_key'], {
        name: 'uq_catalog_invoice_payments_idempotency_key',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('catalog_invoice_payments');

    if (table.idempotency_key) {
      await queryInterface.removeIndex('catalog_invoice_payments', 'uq_catalog_invoice_payments_idempotency_key');
      await queryInterface.removeColumn('catalog_invoice_payments', 'idempotency_key');
    }
    if (table.cash_recorded_at) await queryInterface.removeColumn('catalog_invoice_payments', 'cash_recorded_at');
    if (table.payment_method) await queryInterface.removeColumn('catalog_invoice_payments', 'payment_method');
  },
};
