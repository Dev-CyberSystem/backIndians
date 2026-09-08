import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';

export type EmployeeEventType =
  | 'salary_change'   // cambio de sueldo
  | 'sanction'        // sanción
  | 'notification'    // notificación
  | 'sick_leave'      // enfermedad
  | 'leave'           // licencia / vacaciones
  | 'onboarding'      // ingreso / alta
  | 'offboarding'     // egreso / baja
  | 'other';          // otra

/**
 * Novedad del legajo de un empleado. Registro pensado como inmutable: no hay
 * endpoint de edición; solo `admin` puede borrar una cargada por error.
 *
 * `event_date` es la fecha a la que corresponde la novedad (puede diferir de
 * `createdAt`, que es cuándo se cargó). Para `type = 'salary_change'`, `amount`
 * es el nuevo sueldo y `previous_amount` el anterior (snapshot); el servicio
 * actualiza `Employee.current_remuneration` en la misma transacción.
 */
export class EmployeeEvent extends Model<
  InferAttributes<EmployeeEvent>,
  InferCreationAttributes<EmployeeEvent>
> {
  declare id: CreationOptional<number>;
  declare employee_id: number;
  declare type: EmployeeEventType;
  declare title: string;
  declare body: CreationOptional<string | null>;
  declare event_date: string; // DATEONLY → 'YYYY-MM-DD'
  declare amount: CreationOptional<number | null>;
  declare previous_amount: CreationOptional<number | null>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare author?: NonAttribute<import('./User').User>;
  declare employee?: NonAttribute<import('./Employee').Employee>;
}

function decimalGetter(field: 'amount' | 'previous_amount') {
  return function (this: EmployeeEvent) {
    const v = this.getDataValue(field);
    return v === null || v === undefined ? null : parseFloat(String(v));
  };
}

EmployeeEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    employee_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    type: {
      type: DataTypes.ENUM(
        'salary_change', 'sanction', 'notification', 'sick_leave',
        'leave', 'onboarding', 'offboarding', 'other'
      ),
      allowNull: false,
      defaultValue: 'other',
    },
    title: { type: DataTypes.STRING(200), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    event_date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
      get: decimalGetter('amount'),
    },
    previous_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
      get: decimalGetter('previous_amount'),
    },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'employee_events', timestamps: true }
);
