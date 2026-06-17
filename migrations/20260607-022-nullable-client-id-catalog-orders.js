'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('catalog_orders', 'catalog_orders_ibfk_1');

    await queryInterface.changeColumn('catalog_orders', 'client_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    });

    await queryInterface.addConstraint('catalog_orders', {
      fields: ['client_id'],
      type: 'foreign key',
      name: 'catalog_orders_client_id_fk',
      references: { table: 'clients', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('catalog_orders', 'catalog_orders_client_id_fk');

    await queryInterface.changeColumn('catalog_orders', 'client_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
    });

    await queryInterface.addConstraint('catalog_orders', {
      fields: ['client_id'],
      type: 'foreign key',
      name: 'catalog_orders_ibfk_1',
      references: { table: 'clients', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    });
  },
};
