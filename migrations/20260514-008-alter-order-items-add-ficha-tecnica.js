'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('order_items');

    const addIfMissing = async (column, definition) => {
      if (!tableDesc[column]) {
        await queryInterface.addColumn('order_items', column, definition);
      }
    };

    await addIfMissing('color_secondary', {
      type: Sequelize.STRING(150),
      allowNull: true,
      after: 'color',
    });
    await addIfMissing('color_sleeves', {
      type: Sequelize.STRING(150),
      allowNull: true,
      after: 'color_secondary',
    });
    await addIfMissing('color_collar', {
      type: Sequelize.STRING(150),
      allowNull: true,
      after: 'color_sleeves',
    });
    await addIfMissing('color_seam_tape', {
      type: Sequelize.STRING(150),
      allowNull: true,
      comment: 'Tapa costura',
      after: 'color_collar',
    });
    await addIfMissing('collar_type', {
      type: Sequelize.ENUM('v', 'round', 'mao'),
      allowNull: true,
      after: 'color_seam_tape',
    });
    await addIfMissing('sleeve_type', {
      type: Sequelize.ENUM('raglan', 'classic'),
      allowNull: true,
      after: 'collar_type',
    });
    await addIfMissing('short_description', {
      type: Sequelize.STRING(500),
      allowNull: true,
      comment: 'Descripción short/bermuda',
      after: 'sleeve_type',
    });
    await addIfMissing('socks_description', {
      type: Sequelize.STRING(300),
      allowNull: true,
      comment: 'Descripción medias',
      after: 'short_description',
    });
    await addIfMissing('logo_material', {
      type: Sequelize.STRING(300),
      allowNull: true,
      comment: 'Materiales Marca/Escudo (VINILO, TPU, DTF...)',
      after: 'socks_description',
    });
    await addIfMissing('size_label_type', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Tipo de talle impreso (DTF NEGRO, DTF BLANCO...)',
      after: 'logo_material',
    });
    await addIfMissing('composition_label', {
      type: Sequelize.STRING(200),
      allowNull: true,
      comment: 'Etiqueta de composición interna',
      after: 'size_label_type',
    });
    await addIfMissing('fabric_composition', {
      type: Sequelize.STRING(200),
      allowNull: true,
      comment: 'Composición textil (100% Poliéster...)',
      after: 'composition_label',
    });
    await addIfMissing('fabric_weight', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'Gramaje (140 g/m²...)',
      after: 'fabric_composition',
    });
    await addIfMissing('sponsors', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: '[{element, location}]',
      after: 'fabric_weight',
    });
    await addIfMissing('customization', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: '{number_on_back, number_on_chest, player_name, ...}',
      after: 'sponsors',
    });
  },

  async down(queryInterface, Sequelize) {
    const cols = [
      'color_secondary',
      'color_sleeves',
      'color_collar',
      'color_seam_tape',
      'collar_type',
      'sleeve_type',
      'short_description',
      'socks_description',
      'logo_material',
      'size_label_type',
      'composition_label',
      'fabric_composition',
      'fabric_weight',
      'sponsors',
      'customization',
    ];

    const tableDesc = await queryInterface.describeTable('order_items');
    for (const col of cols) {
      if (tableDesc[col]) {
        await queryInterface.removeColumn('order_items', col);
      }
    }

    // Drop ENUM types (MySQL handles inline; no-op for Postgres safety)
  },
};
