'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Descuento por producto (porcentaje 0-100) aplicado en la tienda y el carrito
    await queryInterface.addColumn('catalog_products', 'discount_percentage', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      after: 'public_price',
    });

    // Cupón promocionable como popup en la tienda
    await queryInterface.addColumn('store_coupons', 'show_popup', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'active',
    });
    await queryInterface.addColumn('store_coupons', 'popup_image_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
      defaultValue: null,
      after: 'show_popup',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('store_coupons', 'popup_image_url');
    await queryInterface.removeColumn('store_coupons', 'show_popup');
    await queryInterface.removeColumn('catalog_products', 'discount_percentage');
  },
};
