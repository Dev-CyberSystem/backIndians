'use strict';

/**
 * Ficha técnica + código interno en productos de catálogo.
 *
 * Permite cargar una vez (al crear/editar el producto) los mismos datos que
 * hoy solo existen en `order_items` (telas, colores, materiales de
 * aplicación, detalle de tela, sponsors, bordado, puño, accesorios), para
 * precargarlos al crear un pedido de producción desde el catálogo. Todas
 * las columnas son nullable: acá el producto es una plantilla, no todos
 * van a tener cargados todos los datos.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('catalog_products', 'internal_code', {
      type: Sequelize.STRING(100),
      allowNull: true,
      unique: true,
    });

    await queryInterface.addColumn('catalog_products', 'stock_fabric_ids', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: '[id, id, ...] — múltiples telas del stock',
    });

    await queryInterface.addColumn('catalog_products', 'color', {
      type: Sequelize.STRING(150),
      allowNull: true,
      comment: 'Color principal',
    });
    await queryInterface.addColumn('catalog_products', 'color_secondary', {
      type: Sequelize.STRING(150),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'color_sleeves', {
      type: Sequelize.STRING(150),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'color_collar', {
      type: Sequelize.STRING(150),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'color_seam_tape', {
      type: Sequelize.STRING(150),
      allowNull: true,
      comment: 'Tapa costura',
    });
    await queryInterface.addColumn('catalog_products', 'collar_type', {
      type: Sequelize.ENUM('v', 'round', 'mao'),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'sleeve_type', {
      type: Sequelize.ENUM('raglan', 'classic'),
      allowNull: true,
    });

    await queryInterface.addColumn('catalog_products', 'short_description', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'socks_description', {
      type: Sequelize.STRING(300),
      allowNull: true,
    });

    await queryInterface.addColumn('catalog_products', 'has_brand', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('catalog_products', 'brand_material', {
      type: Sequelize.STRING(300),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'brand_dimensions', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'has_shield', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('catalog_products', 'shield_material', {
      type: Sequelize.STRING(300),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'shield_dimensions', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'size_label_type', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'composition_label', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });

    await queryInterface.addColumn('catalog_products', 'fabric_composition', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('catalog_products', 'fabric_weight', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });

    await queryInterface.addColumn('catalog_products', 'sponsors', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: '[{element, location, size}]',
    });

    await queryInterface.addColumn('catalog_products', 'has_embroidery', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('catalog_products', 'embroidery_notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('catalog_products', 'has_cuff', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('catalog_products', 'cuff_color', {
      type: Sequelize.STRING(150),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const columns = [
      'internal_code',
      'stock_fabric_ids',
      'color',
      'color_secondary',
      'color_sleeves',
      'color_collar',
      'color_seam_tape',
      'collar_type',
      'sleeve_type',
      'short_description',
      'socks_description',
      'has_brand',
      'brand_material',
      'brand_dimensions',
      'has_shield',
      'shield_material',
      'shield_dimensions',
      'size_label_type',
      'composition_label',
      'fabric_composition',
      'fabric_weight',
      'sponsors',
      'has_embroidery',
      'embroidery_notes',
      'has_cuff',
      'cuff_color',
    ];
    for (const column of columns) {
      await queryInterface.removeColumn('catalog_products', column);
    }
  },
};
