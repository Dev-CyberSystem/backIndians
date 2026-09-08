import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';

/**
 * Legajo de un empleado. Datos personales + laborales + remuneración vigente.
 * La baja es lógica (`active=false` + `termination_date`). El historial de
 * novedades vive en `employee_events` (ver EmployeeEvent).
 *
 * El índice único de `dni` vive solo en la migración (no `unique: true` en el
 * atributo) para no duplicarlo bajo `sequelize.sync()` en dev — mismo patrón
 * que `suppliers.tax_id` / `cash_transactions.idempotency_key`.
 */
export class Employee extends Model<
  InferAttributes<Employee>,
  InferCreationAttributes<Employee>
> {
  declare id: CreationOptional<number>;
  declare full_name: string;
  /** Solo dígitos, sin puntos. */
  declare dni: string;
  declare address: CreationOptional<string | null>;
  declare email: CreationOptional<string | null>;
  declare phone: CreationOptional<string | null>;
  declare hire_date: string; // DATEONLY → 'YYYY-MM-DD'
  declare termination_date: CreationOptional<string | null>;
  declare current_remuneration: CreationOptional<number | null>;
  declare sector: CreationOptional<string | null>;
  declare notes: CreationOptional<string | null>;
  declare active: CreationOptional<boolean>;
  declare created_by_user_id: CreationOptional<number | null>;
  declare updated_by_user_id: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare events?: NonAttribute<import('./EmployeeEvent').EmployeeEvent[]>;
}

Employee.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    full_name: { type: DataTypes.STRING(200), allowNull: false },
    dni: { type: DataTypes.STRING(15), allowNull: false },
    address: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
    email: { type: DataTypes.STRING(150), allowNull: true, defaultValue: null },
    phone: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
    hire_date: { type: DataTypes.DATEONLY, allowNull: false },
    termination_date: { type: DataTypes.DATEONLY, allowNull: true, defaultValue: null },
    current_remuneration: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
      get() {
        const v = this.getDataValue('current_remuneration');
        return v === null || v === undefined ? null : parseFloat(String(v));
      },
    },
    sector: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    notes: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    updated_by_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'employees', timestamps: true }
);
