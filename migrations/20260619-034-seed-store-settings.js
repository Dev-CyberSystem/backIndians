'use strict';

const STORE_SETTINGS = [
  { key: 'store_name',            value: 'Indians Textil' },
  { key: 'store_description',     value: 'Ropa deportiva y casual de la mejor calidad' },
  { key: 'store_whatsapp',        value: '' },
  { key: 'store_instagram',       value: '' },
  { key: 'store_facebook',        value: '' },
  { key: 'store_logo_url',        value: '' },
  { key: 'store_banner_url',      value: '' },
  { key: 'store_primary_color',   value: '#1d4ed8' },
  { key: 'shipping_cost',         value: '0' },
  { key: 'free_shipping_min',     value: '0' },
  { key: 'store_active',          value: 'true' },
  { key: 'store_pickup_address',  value: '' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const setting of STORE_SETTINGS) {
      const [rows] = await queryInterface.sequelize.query(
        'SELECT `key` FROM settings WHERE `key` = ? LIMIT 1',
        { replacements: [setting.key] }
      );
      if (!rows.length) {
        await queryInterface.bulkInsert('settings', [{
          ...setting,
          createdAt: now,
          updatedAt: now,
        }]);
      }
    }
  },

  async down(queryInterface) {
    const keys = STORE_SETTINGS.map((s) => s.key);
    await queryInterface.bulkDelete('settings', { key: keys });
  },
};
