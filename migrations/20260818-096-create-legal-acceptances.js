'use strict';

/**
 * Constancia de aceptación de los textos legales de la tienda (Términos y
 * Condiciones y Política de Privacidad).
 *
 * Por qué una tabla propia y no dos columnas en `store_customers`: el
 * comprador puede comprar como invitado (sin cuenta), y una constancia sirve
 * para probar algo solo si guarda QUÉ versión se aceptó, CUÁNDO y DESDE
 * DÓNDE. Es append-only: cada aceptación es una fila nueva, no se actualiza.
 *
 * Sin claves foráneas duras hacia `store_customers` / `store_orders`: la
 * constancia tiene que sobrevivir aunque después se borre la cuenta o el
 * pedido (art. 16 Ley 25.326: el titular puede pedir la supresión de sus
 * datos, y la constancia de haber aceptado es justamente el respaldo del
 * tratamiento). Se resuelve con índices, no con FK.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('legal_acceptances')) return;

    await queryInterface.createTable('legal_acceptances', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      document: { type: Sequelize.ENUM('terms', 'privacy'), allowNull: false },
      version: { type: Sequelize.STRING(20), allowNull: false },
      customer_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      store_order_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      context: {
        type: Sequelize.ENUM('register', 'google_register', 'checkout'),
        allowNull: false,
      },
      ip: { type: Sequelize.STRING(45), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      accepted_at: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('legal_acceptances', ['customer_id'], {
      name: 'idx_legal_acceptances_customer',
    });
    await queryInterface.addIndex('legal_acceptances', ['store_order_id'], {
      name: 'idx_legal_acceptances_order',
    });
    await queryInterface.addIndex('legal_acceptances', ['email'], {
      name: 'idx_legal_acceptances_email',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('legal_acceptances');
  },
};
