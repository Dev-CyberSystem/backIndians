'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const key of ['store_hero_image_2_url', 'store_hero_image_3_url']) {
      const [rows] = await queryInterface.sequelize.query(
        'SELECT `key` FROM settings WHERE `key` = ? LIMIT 1',
        { replacements: [key] }
      );
      if (!rows.length) {
        await queryInterface.bulkInsert('settings', [{ key, value: '', createdAt: now, updatedAt: now }]);
      }
    }
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete('settings', { key: ['store_hero_image_2_url', 'store_hero_image_3_url'] });
  },
};
