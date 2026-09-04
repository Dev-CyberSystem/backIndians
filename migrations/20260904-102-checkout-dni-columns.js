'use strict';

/**
 * DNI obligatorio en el checkout de la tienda online.
 *
 * A partir de esta migración el comprador tiene que informar su DNI para poder
 * despachar el envío. Se guarda en dos lugares:
 *   - `store_orders.customer_dni`: el DNI con el que se hizo esa compra puntual
 *     (lo que va en la etiqueta de envío). Es el dato de verdad para el despacho.
 *   - `store_customers.dni`: último DNI usado por un comprador con cuenta, para
 *     autocompletar el checkout la próxima vez (no es fuente de verdad del envío).
 *
 * Las dos columnas son NULL-ables a nivel base: los pedidos y las cuentas que ya
 * existen no tienen DNI y no se los puede inventar. La obligatoriedad se aplica
 * en el validador del checkout (`src/routes/store.routes.ts`), no acá.
 *
 * OJO: cualquier cambio acá tiene que replicarse en `src/config/ensureSchema.ts`
 * (en desarrollo la DB se sincroniza con `sequelize.sync()`, que no altera
 * tablas existentes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const orders = await queryInterface.describeTable('store_orders');
    if (!orders.customer_dni) {
      await queryInterface.addColumn('store_orders', 'customer_dni', {
        type: Sequelize.STRING(15),
        allowNull: true,
        defaultValue: null,
      });
    }

    const customers = await queryInterface.describeTable('store_customers');
    if (!customers.dni) {
      await queryInterface.addColumn('store_customers', 'dni', {
        type: Sequelize.STRING(15),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface) {
    const orders = await queryInterface.describeTable('store_orders');
    if (orders.customer_dni) await queryInterface.removeColumn('store_orders', 'customer_dni');

    const customers = await queryInterface.describeTable('store_customers');
    if (customers.dni) await queryInterface.removeColumn('store_customers', 'dni');
  },
};
