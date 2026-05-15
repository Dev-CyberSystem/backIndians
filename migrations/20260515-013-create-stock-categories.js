'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('stock_categories', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    const now = new Date();
    await queryInterface.bulkInsert('stock_categories', [
      { name: 'Telas', description: 'Géneros y materiales textiles', createdAt: now, updatedAt: now },
      { name: 'Hilos', description: 'Hilos de costura y bordado', createdAt: now, updatedAt: now },
      { name: 'Elásticos y Cintas', description: 'Elásticos, cintas y tiras', createdAt: now, updatedAt: now },
      { name: 'Entretelas', description: 'Entretelas y materiales de refuerzo', createdAt: now, updatedAt: now },
      { name: 'Agujas e Insumos', description: 'Agujas, alfileres y consumibles de máquina', createdAt: now, updatedAt: now },
      { name: 'Botones y Cierres', description: 'Botones, cierres, broches y avíos', createdAt: now, updatedAt: now },
      { name: 'Sublimación', description: 'Papeles, tintas y materiales de sublimación', createdAt: now, updatedAt: now },
      { name: 'Lubricantes', description: 'Aceites y lubricantes para maquinaria', createdAt: now, updatedAt: now },
      { name: 'Accesorios', description: 'Accesorios varios para prendas', createdAt: now, updatedAt: now },
      { name: 'Otros', description: 'Otros materiales', createdAt: now, updatedAt: now },
    ]);

    // Extend stock_items
    await queryInterface.addColumn('stock_items', 'category_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: { model: 'stock_categories', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('stock_items', 'description', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('stock_items', 'active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('stock_items', 'active');
    await queryInterface.removeColumn('stock_items', 'description');
    await queryInterface.removeColumn('stock_items', 'category_id');
    await queryInterface.dropTable('stock_categories');
  },
};
