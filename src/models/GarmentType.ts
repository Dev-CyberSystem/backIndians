import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';

export class GarmentType extends Model<
  InferAttributes<GarmentType>,
  InferCreationAttributes<GarmentType>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  // Cliente dueño de la prenda. NULL = tipo global/legado (compartido).
  declare client_id: CreationOptional<number | null>;
  // Categoría de costo: define qué lista de ítems de costo aplica (jersey/shorts).
  declare cost_category: CreationOptional<'jersey' | 'shorts' | null>;
  declare active: CreationOptional<boolean>;
  declare sort_order: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

GarmentType.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    client_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    cost_category: {
      type: DataTypes.ENUM('jersey', 'shorts'),
      allowNull: true,
      defaultValue: null,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'garment_types',
    timestamps: true,
  }
);
