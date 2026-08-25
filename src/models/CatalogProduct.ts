import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import { sequelize } from '../config/db';
import { CollarType, SleeveType, Sponsor } from '../types';

export class CatalogProduct extends Model<
  InferAttributes<CatalogProduct>,
  InferCreationAttributes<CatalogProduct>
> {
  declare id: CreationOptional<number>;
  declare client_id: number;
  declare title: string;
  declare description: CreationOptional<string | null>;
  declare price: number;
  declare stock_quantity: CreationOptional<number>;
  /** Reservado por pedidos en pending_payment todavía no confirmados (2.1). Disponible = stock_quantity - stock_reserved. */
  declare stock_reserved: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare public_price: CreationOptional<number | null>;
  declare discount_percentage: CreationOptional<number>;
  declare show_in_store: CreationOptional<boolean>;
  declare category: CreationOptional<string | null>;
  declare gender: CreationOptional<'masculino' | 'femenino' | 'infantil' | 'unisex' | null>;
  declare tags: CreationOptional<string[] | null>;
  declare garment_type_id: CreationOptional<number | null>;

  /** Código interno de referencia del producto (texto libre, sin formato forzado). */
  declare internal_code: CreationOptional<string | null>;

  // ─── Ficha técnica — plantilla para precargar el ítem de un pedido ────────
  declare stock_fabric_ids: CreationOptional<number[] | null>;

  declare color: CreationOptional<string | null>;
  declare color_secondary: CreationOptional<string | null>;
  declare color_sleeves: CreationOptional<string | null>;
  declare color_collar: CreationOptional<string | null>;
  declare color_seam_tape: CreationOptional<string | null>;
  declare collar_type: CreationOptional<CollarType | null>;
  declare sleeve_type: CreationOptional<SleeveType | null>;

  declare short_description: CreationOptional<string | null>;
  declare socks_description: CreationOptional<string | null>;

  declare has_brand: CreationOptional<boolean>;
  declare brand_material: CreationOptional<string | null>;
  declare brand_dimensions: CreationOptional<string | null>;
  declare has_shield: CreationOptional<boolean>;
  declare shield_material: CreationOptional<string | null>;
  declare shield_dimensions: CreationOptional<string | null>;
  declare size_label_type: CreationOptional<string | null>;
  declare composition_label: CreationOptional<string | null>;

  declare fabric_composition: CreationOptional<string | null>;
  declare fabric_weight: CreationOptional<string | null>;

  declare sponsors: CreationOptional<Sponsor[] | null>;

  declare has_embroidery: CreationOptional<boolean>;
  declare embroidery_notes: CreationOptional<string | null>;

  declare has_cuff: CreationOptional<boolean>;
  declare cuff_color: CreationOptional<string | null>;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CatalogProduct.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    client_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('price');
        return v === null ? null : parseFloat(String(v));
      },
    },
    stock_quantity: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    stock_reserved: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    public_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: null,
      get() {
        const v = this.getDataValue('public_price');
        return v === null ? null : parseFloat(String(v));
      },
    },
    discount_percentage: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    show_in_store: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: null,
    },
    gender: {
      type: DataTypes.ENUM('masculino', 'femenino', 'infantil', 'unisex'),
      allowNull: true,
      defaultValue: null,
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
    garment_type_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },

    internal_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
    },

    // Ficha técnica — plantilla para precargar el ítem de un pedido
    stock_fabric_ids: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '[id, id, ...] — múltiples telas del stock',
    },

    color: {
      type: DataTypes.STRING(150),
      allowNull: true,
      comment: 'Color principal',
    },
    color_secondary: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    color_sleeves: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    color_collar: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    color_seam_tape: {
      type: DataTypes.STRING(150),
      allowNull: true,
      comment: 'Tapa costura',
    },
    collar_type: {
      type: DataTypes.ENUM('v', 'round', 'mao'),
      allowNull: true,
    },
    sleeve_type: {
      type: DataTypes.ENUM('raglan', 'classic'),
      allowNull: true,
    },

    short_description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    socks_description: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },

    has_brand: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    brand_material: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    brand_dimensions: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    has_shield: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    shield_material: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    shield_dimensions: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    size_label_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    composition_label: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },

    fabric_composition: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    fabric_weight: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    sponsors: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '[{element, location, size}]',
    },

    has_embroidery: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    embroidery_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    has_cuff: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    cuff_color: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },

    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'catalog_products',
    timestamps: true,
  }
);
