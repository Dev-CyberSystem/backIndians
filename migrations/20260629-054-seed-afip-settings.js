'use strict';

const SETTINGS = [
  { key: 'afip_enabled',          value: 'false' },
  { key: 'afip_environment',      value: 'homo' },
  { key: 'afip_punto_venta',      value: '' },
  { key: 'afip_concepto_default', value: '1' },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const s of SETTINGS) {
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO settings (\`key\`, value, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
        { replacements: [s.key, s.value, now, now] }
      );
    }
  },

  async down(queryInterface) {
    const keys = SETTINGS.map((s) => s.key);
    await queryInterface.sequelize.query(
      `DELETE FROM settings WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
      { replacements: keys }
    );
  },
};
