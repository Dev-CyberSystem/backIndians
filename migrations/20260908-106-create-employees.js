'use strict';

/**
 * Empleados (legajo interno) + histórico de novedades.
 *
 * `employees`: ficha del empleado con sus datos personales, laborales y la
 * remuneración vigente. `sector` es texto libre (el negocio arma su taxonomía
 * sin depender de una migración). Baja = lógica (`active=false` + `termination_date`).
 *
 * `employee_events`: legajo de novedades. Registro pensado como **inmutable**
 * (no hay endpoint de edición; solo `admin` puede borrar una cargada por error).
 * Cada novedad guarda su fecha propia (`event_date`, puede diferir de la fecha
 * de carga), el tipo, un resumen + detalle y quién la cargó. Para el tipo
 * `salary_change` se guardan además `amount` (nuevo sueldo) y `previous_amount`
 * (snapshot del anterior) — el servicio actualiza `employees.current_remuneration`
 * en la misma operación.
 *
 * Ambas tablas son nuevas y no referencian dominios existentes salvo `users`
 * (autor de la novedad / creador de la ficha). Migración aditiva.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes('employees')) {
      await queryInterface.createTable('employees', {
        id:                    { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        full_name:             { type: Sequelize.STRING(200), allowNull: false },
        // Solo dígitos, sin puntos. La validación de formato vive en el servicio.
        dni:                   { type: Sequelize.STRING(15), allowNull: false },
        address:               { type: Sequelize.STRING(255), allowNull: true, defaultValue: null },
        email:                 { type: Sequelize.STRING(150), allowNull: true, defaultValue: null },
        phone:                 { type: Sequelize.STRING(50), allowNull: true, defaultValue: null },
        hire_date:             { type: Sequelize.DATEONLY, allowNull: false },
        termination_date:      { type: Sequelize.DATEONLY, allowNull: true, defaultValue: null },
        current_remuneration:  { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: null },
        sector:                { type: Sequelize.STRING(100), allowNull: true, defaultValue: null },
        notes:                 { type: Sequelize.TEXT, allowNull: true, defaultValue: null },
        active:                { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        created_by_user_id:    { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        updated_by_user_id:    { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        createdAt:             { type: Sequelize.DATE, allowNull: false },
        updatedAt:             { type: Sequelize.DATE, allowNull: false },
      });

      // DNI único cuando está informado (siempre lo está: la columna es NOT NULL,
      // pero el índice único igual tolera un futuro cambio a nullable).
      await queryInterface.addConstraint('employees', {
        fields: ['dni'],
        type: 'unique',
        name: 'uq_employees_dni',
      });
      await queryInterface.addIndex('employees', ['active'], { name: 'idx_employees_active' });
      await queryInterface.addIndex('employees', ['sector'], { name: 'idx_employees_sector' });
      await queryInterface.addIndex('employees', ['full_name'], { name: 'idx_employees_full_name' });
    }

    if (!tables.includes('employee_events')) {
      await queryInterface.createTable('employee_events', {
        id:                  { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        employee_id:         { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        type: {
          type: Sequelize.ENUM(
            'salary_change', 'sanction', 'notification', 'sick_leave',
            'leave', 'onboarding', 'offboarding', 'other'
          ),
          allowNull: false,
          defaultValue: 'other',
        },
        title:               { type: Sequelize.STRING(200), allowNull: false },
        body:                { type: Sequelize.TEXT, allowNull: true, defaultValue: null },
        event_date:          { type: Sequelize.DATEONLY, allowNull: false },
        amount:              { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: null },
        previous_amount:     { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: null },
        created_by_user_id:  { type: Sequelize.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        createdAt:           { type: Sequelize.DATE, allowNull: false },
        updatedAt:           { type: Sequelize.DATE, allowNull: false },
      });

      await queryInterface.addConstraint('employee_events', {
        fields: ['employee_id'],
        type: 'foreign key',
        name: 'fk_employee_events_employee',
        references: { table: 'employees', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
      await queryInterface.addIndex('employee_events', ['employee_id', 'event_date'], {
        name: 'idx_employee_events_employee_date',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('employee_events');
    await queryInterface.dropTable('employees');
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_employee_events_type";');
    }
  },
};
