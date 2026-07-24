'use strict';

/*
 * Costos de prendas — parte 2/4.
 * Maestro configurable de ítems de costo por categoría. Se siembra con las dos
 * listas fijas (jersey / shorts). `group_key` agrupa ítems excluyentes o
 * condicionales (tipos de cuello, telas de "doble tela") solo a nivel de UI:
 * ningún ítem es obligatorio y los no cargados suman 0.
 */

const JERSEY = [
  { key: 'tela_principal',      label: 'Tela principal',            group_key: null },
  { key: 'tela_delantera',      label: 'Tela delantera (doble tela)', group_key: 'doble_tela' },
  { key: 'tela_trasera',        label: 'Tela trasera (doble tela)',   group_key: 'doble_tela' },
  { key: 'hilos',               label: 'Hilos',                     group_key: null },
  { key: 'cierre',              label: 'Cierre',                    group_key: null },
  { key: 'cuello_tejido',       label: 'Cuello tejido',             group_key: 'cuello' },
  { key: 'cuello_misma_tela',   label: 'Cuello en misma tela',      group_key: 'cuello' },
  { key: 'cuello_dry',          label: 'Cuello Dry',                group_key: 'cuello' },
  { key: 'cuello_lycra',        label: 'Cuello Lycra',              group_key: 'cuello' },
  { key: 'etiqueta_composicion', label: 'Etiqueta de composición',  group_key: null },
  { key: 'etiqueta_talle',      label: 'Etiqueta de talle',         group_key: null },
  { key: 'etiqueta_colgante',   label: 'Etiqueta colgante',         group_key: null },
  { key: 'marca',               label: 'Marca',                     group_key: null },
  { key: 'escudo',              label: 'Escudo',                    group_key: null },
  { key: 'sponsors',            label: 'Sponsors',                  group_key: null },
  { key: 'apliques',            label: 'Apliques',                  group_key: null },
  { key: 'parche',              label: 'Parche',                    group_key: null },
  { key: 'nombre',              label: 'Nombre',                    group_key: null },
  { key: 'numero',              label: 'Número',                    group_key: null },
];

const SHORTS = [
  { key: 'tela',                label: 'Tela',                      group_key: null },
  { key: 'hilos',               label: 'Hilos',                     group_key: null },
  { key: 'elastico',            label: 'Elástico',                  group_key: null },
  { key: 'etiquetas',           label: 'Etiquetas',                 group_key: null },
  { key: 'etiqueta_composicion', label: 'Etiqueta de composición',  group_key: null },
  { key: 'etiqueta_talle',      label: 'Etiqueta de talle',         group_key: null },
  { key: 'etiqueta_colgante',   label: 'Etiqueta colgante',         group_key: null },
  { key: 'marca',               label: 'Marca',                     group_key: null },
  { key: 'escudo',              label: 'Escudo',                    group_key: null },
  { key: 'sponsors',            label: 'Sponsors',                  group_key: null },
  { key: 'apliques',            label: 'Apliques',                  group_key: null },
  { key: 'parche',              label: 'Parche',                    group_key: null },
  { key: 'numero',              label: 'Número',                    group_key: null },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('garment_cost_items', {
      id:         { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      category:   { type: Sequelize.ENUM('jersey', 'shorts'), allowNull: false },
      key:        { type: Sequelize.STRING(60), allowNull: false },
      label:      { type: Sequelize.STRING(150), allowNull: false },
      group_key:  { type: Sequelize.STRING(40), allowNull: true, defaultValue: null },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active:     { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt:  { type: Sequelize.DATE, allowNull: false },
      updatedAt:  { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addConstraint('garment_cost_items', {
      fields: ['category', 'key'],
      type: 'unique',
      name: 'uq_garment_cost_items_category_key',
    });

    const now = new Date();
    const rows = [];
    JERSEY.forEach((it, i) => rows.push({ category: 'jersey', ...it, sort_order: i, active: true, createdAt: now, updatedAt: now }));
    SHORTS.forEach((it, i) => rows.push({ category: 'shorts', ...it, sort_order: i, active: true, createdAt: now, updatedAt: now }));
    await queryInterface.bulkInsert('garment_cost_items', rows);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('garment_cost_items');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_garment_cost_items_category";');
    }
  },
};
