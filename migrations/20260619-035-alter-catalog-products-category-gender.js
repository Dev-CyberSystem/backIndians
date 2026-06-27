'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('catalog_products', 'category', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null,
      after: 'show_in_store',
    });
    await queryInterface.addColumn('catalog_products', 'gender', {
      type: Sequelize.ENUM('masculino', 'femenino', 'infantil', 'unisex'),
      allowNull: true,
      defaultValue: null,
      after: 'category',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('catalog_products', 'gender');
    await queryInterface.removeColumn('catalog_products', 'category');
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS `catalog_products_gender`");
  },
};
