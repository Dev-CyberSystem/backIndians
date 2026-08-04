import { DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import { sequelize } from '../config/db';

export class WebhookEvent extends Model<
  InferAttributes<WebhookEvent>,
  InferCreationAttributes<WebhookEvent>
> {
  declare id: CreationOptional<number>;
  declare provider: string;
  declare event_id: string;
  declare payload_hash: CreationOptional<string | null>;
  declare processed_at: CreationOptional<Date | null>;
  declare result: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WebhookEvent.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    provider: { type: DataTypes.STRING(30), allowNull: false },
    event_id: { type: DataTypes.STRING(100), allowNull: false },
    payload_hash: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
    processed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    result: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: 'webhook_events', timestamps: true }
);
