'use strict';

/**
 * Reemplaza la estructura de order_items con la nueva hoja de pedido configurable.
 *
 * Estructura anterior:  product_id, quantity, size_breakdown (JSON), color,
 *                       customization_notes, unit_price
 * Estructura nueva:     garment_type_id, fabric_type_id, color,
 *                       has_embroidery, embroidery_notes, sizes (JSON),
 *                       unit_price (nullable), notes
 *
 * ATENCIÓN: esta migración elimina columnas con datos. Hacer backup antes de
 * ejecutar en producción.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('order_items');

    // ── Quitar columnas del esquema anterior ────────────────────────────────
    const oldCols = ['product_id', 'quantity', 'size_breakdown', 'customization_notes'];
    for (const col of oldCols) {
      if (tableDesc[col]) {
        await queryInterface.removeColumn('order_items', col);
      }
    }

    // ── Agregar columnas nuevas ─────────────────────────────────────────────
    if (!tableDesc.garment_type_id) {
      await queryInterface.addColumn('order_items', 'garment_type_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'garment_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        after: 'order_id',
      });
    }

    if (!tableDesc.fabric_type_id) {
      await queryInterface.addColumn('order_items', 'fabric_type_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'fabric_types', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        after: 'garment_type_id',
      });
    }

    // color ya existe; aseguramos que sea NOT NULL
    if (tableDesc.color) {
      await queryInterface.changeColumn('order_items', 'color', {
        type: Sequelize.STRING(100),
        allowNull: false,
      });
    } else {
      await queryInterface.addColumn('order_items', 'color', {
        type: Sequelize.STRING(100),
        allowNull: false,
        after: 'fabric_type_id',
      });
    }

    if (!tableDesc.has_embroidery) {
      await queryInterface.addColumn('order_items', 'has_embroidery', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        after: 'color',
      });
    }

    if (!tableDesc.embroidery_notes) {
      await queryInterface.addColumn('order_items', 'embroidery_notes', {
        type: Sequelize.TEXT,
        allowNull: true,
        after: 'has_embroidery',
      });
    }

    if (!tableDesc.sizes) {
      await queryInterface.addColumn('order_items', 'sizes', {
        type: Sequelize.JSON,
        allowNull: false,
        after: 'embroidery_notes',
      });
    }

    // unit_price pasa a nullable
    if (tableDesc.unit_price) {
      await queryInterface.changeColumn('order_items', 'unit_price', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
    }

    if (!tableDesc.notes) {
      await queryInterface.addColumn('order_items', 'notes', {
        type: Sequelize.TEXT,
        allowNull: true,
        after: 'unit_price',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('order_items');

    // Quitar columnas nuevas
    const newCols = [
      'garment_type_id', 'fabric_type_id', 'has_embroidery',
      'embroidery_notes', 'sizes', 'notes',
    ];
    for (const col of newCols) {
      if (tableDesc[col]) {
        await queryInterface.removeColumn('order_items', col);
      }
    }

    // Restaurar columnas anteriores
    if (!tableDesc.product_id) {
      await queryInterface.addColumn('order_items', 'product_id', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: { model: 'products', key: 'id' },
      });
    }
    if (!tableDesc.quantity) {
      await queryInterface.addColumn('order_items', 'quantity', {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      });
    }
    if (!tableDesc.size_breakdown) {
      await queryInterface.addColumn('order_items', 'size_breakdown', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }
    if (!tableDesc.customization_notes) {
      await queryInterface.addColumn('order_items', 'customization_notes', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    // Revertir unit_price a NOT NULL
    if (tableDesc.unit_price) {
      await queryInterface.changeColumn('order_items', 'unit_price', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
  },
};
