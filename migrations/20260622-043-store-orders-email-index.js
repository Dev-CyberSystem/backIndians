'use strict';

/**
 * Índice sobre store_orders.customer_email.
 *
 * Lo usa getMyOrders: para un cliente logueado se buscan también sus pedidos
 * hechos como invitado mediante { customer_id: NULL, customer_email: <email> }.
 * Sin este índice, la rama por email del OR degrada a full scan; con él MySQL
 * puede resolver el OR por index_merge (customer_id + customer_email).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('store_orders', ['customer_email'], {
      name: 'idx_store_orders_customer_email',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('store_orders', 'idx_store_orders_customer_email');
  },
};
