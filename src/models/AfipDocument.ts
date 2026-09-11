import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/db";

export type AfipTarget = "invoice" | "catalogInvoice" | "storeOrder";
export class AfipDocument extends Model {
  declare id: string;
  declare target: AfipTarget;
  declare target_id: number;
  declare environment: "homo" | "prod";
  declare stream: string;
  declare status: "prepared" | "uncertain" | "sent" | "rejected";
  declare snapshot: any;
  declare response: any;
  declare error: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}
AfipDocument.init(
  {
    id: { type: DataTypes.STRING(100), primaryKey: true },
    target: { type: DataTypes.STRING(20), allowNull: false },
    target_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    environment: { type: DataTypes.STRING(4), allowNull: false },
    stream: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.STRING(12), allowNull: false },
    snapshot: { type: DataTypes.JSON, allowNull: false },
    response: { type: DataTypes.JSON, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
  },
  { sequelize, tableName: "afip_documents", timestamps: true },
);

/** Ticket cifrado: nunca se devuelve por API ni se imprime en logs. */
export class AfipAuthTicket extends Model {
  declare id: string;
  declare encrypted: string;
  declare expires_at: Date;
}
AfipAuthTicket.init(
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    encrypted: { type: DataTypes.TEXT, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: "afip_auth_tickets", timestamps: true },
);
