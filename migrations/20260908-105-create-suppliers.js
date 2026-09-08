'use strict';

/**
 * Proveedores — entidad nueva e independiente.
 *
 * Hasta ahora Indians no tenía ningún registro de proveedores (a quién se le
 * compran telas, avíos, servicios de sublimación, etc.). Esta tabla es un ABM
 * autónomo: no toca stock, costos ni pedidos. Sirve como directorio consultable
 * con filtros (rubro, estado, texto libre).
 *
 * El CUIT se guarda normalizado (solo dígitos, sin guiones) para que la
 * unicidad no dependa del formato con el que se cargó. La validación de formato
 * vive en el servicio / las rutas.
 *
 * Migración aditiva: `up` no altera ni borra nada existente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('suppliers')) return;

    await queryInterface.createTable('suppliers', {
      id:                 { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      business_name:      { type: Sequelize.STRING(200), allowNull: false },
      trade_name:         { type: Sequelize.STRING(200), allowNull: true, defaultValue: null },
      // Rubro / categoría libre para clasificar y filtrar (telas, avíos,
      // sublimación, servicios, etc.). Texto libre a propósito: el negocio
      // arma su propia taxonomía sin depender de una migración de ENUM.
      category:           { type: Sequelize.STRING(100), allowNull: true, defaultValue: null },
      // Solo dígitos (11), sin guiones. La validación de formato vive en el servicio.
      tax_id:             { type: Sequelize.STRING(11), allowNull: true, defaultValue: null },
      tax_condition: {
        type: Sequelize.ENUM(
          'responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_categorizado'
        ),
        allowNull: true,
        defaultValue: null,
      },
      address:            { type: Sequelize.STRING(255), allowNull: true, defaultValue: null },
      province:           { type: Sequelize.STRING(100), allowNull: true, defaultValue: null },
      locality:           { type: Sequelize.STRING(100), allowNull: true, defaultValue: null },
      postal_code:        { type: Sequelize.STRING(20), allowNull: true, defaultValue: null },
      phone:              { type: Sequelize.STRING(50), allowNull: true, defaultValue: null },
      whatsapp:           { type: Sequelize.STRING(50), allowNull: true, defaultValue: null },
      email:              { type: Sequelize.STRING(150), allowNull: true, defaultValue: null },
      contact_person:     { type: Sequelize.STRING(150), allowNull: true, defaultValue: null },
      payment_terms:      { type: Sequelize.STRING(150), allowNull: true, defaultValue: null },
      notes:              { type: Sequelize.TEXT, allowNull: true, defaultValue: null },
      active:             { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by_user_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      updated_by_user_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
      createdAt:          { type: Sequelize.DATE, allowNull: false },
      updatedAt:          { type: Sequelize.DATE, allowNull: false },
    });

    // Único cuando está informado: en MySQL varias filas con tax_id NULL no
    // chocan entre sí, solo se rechaza un CUIT repetido ya cargado.
    await queryInterface.addConstraint('suppliers', {
      fields: ['tax_id'],
      type: 'unique',
      name: 'uq_suppliers_tax_id',
    });

    await queryInterface.addIndex('suppliers', ['active'], { name: 'idx_suppliers_active' });
    await queryInterface.addIndex('suppliers', ['business_name'], { name: 'idx_suppliers_business_name' });
    await queryInterface.addIndex('suppliers', ['category'], { name: 'idx_suppliers_category' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('suppliers');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_suppliers_tax_condition";');
    }
  },
};
