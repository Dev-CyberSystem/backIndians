'use strict';

const AFIP_COLS = (Sequelize) => [
  ['afip_status',                { type: Sequelize.ENUM('pending', 'sent', 'error'), allowNull: true, defaultValue: null }],
  ['afip_tipo_comprobante',      { type: Sequelize.TINYINT.UNSIGNED,                allowNull: true, defaultValue: null }],
  ['afip_concepto',              { type: Sequelize.TINYINT.UNSIGNED,                allowNull: true, defaultValue: null }],
  ['afip_iva_alicuota',          { type: Sequelize.DECIMAL(5, 2),                   allowNull: true, defaultValue: null }],
  ['afip_doc_tipo',              { type: Sequelize.TINYINT.UNSIGNED,                allowNull: true, defaultValue: null }],
  ['afip_condicion_iva_receptor',{ type: Sequelize.TINYINT.UNSIGNED,                allowNull: true, defaultValue: null }],
  ['afip_punto_venta',           { type: Sequelize.SMALLINT.UNSIGNED,               allowNull: true, defaultValue: null }],
  ['afip_cbte_nro',              { type: Sequelize.INTEGER.UNSIGNED,                allowNull: true, defaultValue: null }],
  ['afip_cae',                   { type: Sequelize.STRING(20),                      allowNull: true, defaultValue: null }],
  ['afip_cae_vto',               { type: Sequelize.DATEONLY,                        allowNull: true, defaultValue: null }],
  ['afip_sent_at',               { type: Sequelize.DATE,                            allowNull: true, defaultValue: null }],
  ['afip_error',                 { type: Sequelize.TEXT,                            allowNull: true, defaultValue: null }],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const [col, def] of AFIP_COLS(Sequelize)) {
      await queryInterface.addColumn('catalog_invoices', col, def);
    }
  },

  async down(queryInterface) {
    for (const [col] of AFIP_COLS({})) {
      await queryInterface.removeColumn('catalog_invoices', col);
    }
  },
};
