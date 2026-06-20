'use strict';

const LANDING_SETTINGS = [
  { key: 'store_hero_title',        value: 'Vestite para ganar' },
  { key: 'store_hero_subtitle',     value: 'La mejor indumentaria deportiva. Calidad y estilo para cada deporte.' },
  { key: 'store_hero_cta',          value: 'Ver colección' },
  { key: 'store_hero_badge',        value: 'Nueva temporada 2026' },
  { key: 'store_hero_image_url',    value: '' },
  { key: 'store_marquee',           value: 'Envío a todo el país · Pago seguro con MercadoPago · Talles XS al XXXL · Fabricación propia' },
  { key: 'store_categories_title',  value: 'Comprá por deporte' },
  { key: 'store_featured_title',    value: 'Novedades' },
  { key: 'store_featured_subtitle', value: 'Los últimos productos en la tienda' },
  { key: 'store_promo_image_url',   value: '' },
  { key: 'store_promo_title',       value: 'Nueva temporada' },
  { key: 'store_promo_subtitle',    value: 'Descubrí toda la colección' },
  { key: 'store_promo_cta',         value: 'Ver todo' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const setting of LANDING_SETTINGS) {
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
    const keys = LANDING_SETTINGS.map((s) => s.key);
    await queryInterface.bulkDelete('settings', { key: keys });
  },
};
