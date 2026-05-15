// Punto de entrada de modelos: define todas las asociaciones entre tablas
import { User } from './User';
import { Client } from './Client';
import { Product } from './Product';
import { Order } from './Order';
import { OrderItem } from './OrderItem';
import { OrderImage } from './OrderImage';
import { OrderStatusHistory } from './OrderStatusHistory';
import { Invoice } from './Invoice';
import { StockItem } from './StockItem';
import { StockCategory } from './StockCategory';
import { StockMovement } from './StockMovement';
import { GarmentType } from './GarmentType';
import { FabricType } from './FabricType';
import { SizeChart } from './SizeChart';
import { PasswordResetToken } from './PasswordResetToken';
import { Settings } from './Settings';

// ─── Asociaciones ───────────────────────────────────────────────────────────

// Order ↔ Client
Order.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Client.hasMany(Order, { foreignKey: 'client_id', as: 'orders' });

// Order ↔ User (creador)
Order.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
User.hasMany(Order, { foreignKey: 'created_by', as: 'created_orders' });

// Order ↔ User (vendedor — nullable)
Order.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });
User.hasMany(Order, { foreignKey: 'seller_id', as: 'sold_orders' });

// Order ↔ OrderItem
Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

// OrderItem ↔ GarmentType
OrderItem.belongsTo(GarmentType, { foreignKey: 'garment_type_id', as: 'garmentType' });
GarmentType.hasMany(OrderItem, { foreignKey: 'garment_type_id', as: 'order_items' });

// OrderItem ↔ FabricType
OrderItem.belongsTo(FabricType, { foreignKey: 'fabric_type_id', as: 'fabricType' });
FabricType.hasMany(OrderItem, { foreignKey: 'fabric_type_id', as: 'order_items' });

// Order ↔ OrderImage
Order.hasMany(OrderImage, { foreignKey: 'order_id', as: 'images', onDelete: 'CASCADE' });
OrderImage.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

// OrderImage ↔ User (subió la imagen)
OrderImage.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

// Order ↔ OrderStatusHistory
Order.hasMany(OrderStatusHistory, { foreignKey: 'order_id', as: 'status_history', onDelete: 'CASCADE' });
OrderStatusHistory.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

// OrderStatusHistory ↔ User (quién cambió)
OrderStatusHistory.belongsTo(User, { foreignKey: 'changed_by', as: 'changer' });

// Invoice ↔ Order
Invoice.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Order.hasMany(Invoice, { foreignKey: 'order_id', as: 'invoices' });

// PasswordResetToken ↔ User
PasswordResetToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(PasswordResetToken, { foreignKey: 'user_id', as: 'reset_tokens' });

// StockItem ↔ StockCategory
StockItem.belongsTo(StockCategory, { foreignKey: 'category_id', as: 'category' });
StockCategory.hasMany(StockItem, { foreignKey: 'category_id', as: 'items' });

// StockMovement ↔ StockItem
StockMovement.belongsTo(StockItem, { foreignKey: 'stock_item_id', as: 'item' });
StockItem.hasMany(StockMovement, { foreignKey: 'stock_item_id', as: 'movements' });

// StockMovement ↔ User
StockMovement.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasMany(StockMovement, { foreignKey: 'user_id', as: 'stock_movements' });

export {
  User,
  Client,
  Product,
  Order,
  OrderItem,
  OrderImage,
  OrderStatusHistory,
  Invoice,
  StockItem,
  GarmentType,
  FabricType,
  SizeChart,
  PasswordResetToken,
  Settings,
  StockCategory,
  StockMovement,
};
