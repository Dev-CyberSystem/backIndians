import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/db';
import { SizesMap, CollarType, SleeveType, Sponsor, Customization } from '../types';

export class OrderItem extends Model<
  InferAttributes<OrderItem>,
  InferCreationAttributes<OrderItem>
> {
  declare id: CreationOptional<number>;
  declare order_id: number;

  // ─── Tipo de prenda y tela (tablas maestras) ────────────────────────────
  declare garment_type_id: number;
  declare fabric_type_id: number;

  // ─── Diseño y colores ───────────────────────────────────────────────────
  declare color: string;                               // Color principal
  declare color_secondary: CreationOptional<string | null>;
  declare color_sleeves: CreationOptional<string | null>;
  declare color_collar: CreationOptional<string | null>;
  declare color_seam_tape: CreationOptional<string | null>;  // Tapa costura
  declare collar_type: CreationOptional<CollarType | null>;
  declare sleeve_type: CreationOptional<SleeveType | null>;

  // ─── Accesorios complementarios ─────────────────────────────────────────
  declare short_description: CreationOptional<string | null>;  // Short/Bermuda
  declare socks_description: CreationOptional<string | null>;  // Medias

  // ─── Materiales de aplicación ────────────────────────────────────────────
  declare logo_material: CreationOptional<string | null>;       // Materiales Marca/Escudo
  declare size_label_type: CreationOptional<string | null>;     // Talle (DTF NEGRO, etc.)
  declare composition_label: CreationOptional<string | null>;   // Etiqueta de composición

  // ─── Detalle de la tela ─────────────────────────────────────────────────
  declare fabric_composition: CreationOptional<string | null>;  // "100% Poliéster"
  declare fabric_weight: CreationOptional<string | null>;       // "140 g/m²"

  // ─── Sponsors (JSON array) ──────────────────────────────────────────────
  // Ej: [{ element: "Escudo del club", location: "Pecho izquierdo" }, ...]
  declare sponsors: CreationOptional<Sponsor[] | null>;

  // ─── Personalización ────────────────────────────────────────────────────
  // { number_on_back, number_on_chest, player_name, number_font, ... }
  declare customization: CreationOptional<Customization | null>;

  // ─── Bordado ─────────────────────────────────────────────────────────────
  declare has_embroidery: CreationOptional<boolean>;
  declare embroidery_notes: CreationOptional<string | null>;

  // ─── Cantidades por talla ────────────────────────────────────────────────
  // { "id_SizeChart": cantidad } — ej: { "1": 5, "2": 10 }
  declare sizes: SizesMap;

  // ─── Precio y notas ──────────────────────────────────────────────────────
  declare unit_price: CreationOptional<number | null>;
  declare notes: CreationOptional<string | null>;

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Asociaciones
  declare garmentType?: NonAttribute<import('./GarmentType').GarmentType>;
  declare fabricType?: NonAttribute<import('./FabricType').FabricType>;
}

OrderItem.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    order_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    // Tablas maestras
    garment_type_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    fabric_type_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    // Diseño
    color: {
      type: DataTypes.STRING(150),
      allowNull: false,
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

    // Accesorios
    short_description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    socks_description: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },

    // Materiales de aplicación
    logo_material: {
      type: DataTypes.STRING(300),
      allowNull: true,
      comment: 'Materiales Marca/Escudo (VINILO, TPU, DTF...)',
    },
    size_label_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Tipo de talle impreso (DTF NEGRO, DTF BLANCO...)',
    },
    composition_label: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Etiqueta de composición interna (SIMPLE Satén...)',
    },

    // Detalle de tela
    fabric_composition: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Composición textil (100% Poliéster...)',
    },
    fabric_weight: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Gramaje (140 g/m²...)',
    },

    // Sponsors
    sponsors: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '[{element, location}]',
    },

    // Personalización
    customization: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '{number_on_back, number_on_chest, player_name, number_font, ...}',
    },

    // Bordado
    has_embroidery: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    embroidery_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // Tallas
    sizes: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: '{"id_SizeChart": cantidad}',
    },

    // Precio y notas
    unit_price: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  {
    sequelize,
    tableName: 'order_items',
    timestamps: true,
  }
);
