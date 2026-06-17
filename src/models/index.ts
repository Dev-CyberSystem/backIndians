// Punto de entrada de modelos: define todas las asociaciones entre tablas
import { User } from './User';
import { Client } from './Client';
import { Product } from './Product';
import { CatalogProduct } from './CatalogProduct';
import { CatalogProductImage } from './CatalogProductImage';
import { CatalogProductSize } from './CatalogProductSize';
import { CatalogOrder } from './CatalogOrder';
import { CatalogOrderItem } from './CatalogOrderItem';
import { CatalogInvoice } from './CatalogInvoice';
import { CatalogInvoiceImage } from './CatalogInvoiceImage';
import { InvoicePayment } from './InvoicePayment';
import { CatalogInvoicePayment } from './CatalogInvoicePayment';
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

// OrderItem ↔ FabricType (legacy)
OrderItem.belongsTo(FabricType, { foreignKey: 'fabric_type_id', as: 'fabricType' });
FabricType.hasMany(OrderItem, { foreignKey: 'fabric_type_id', as: 'order_items' });

// OrderItem ↔ StockItem (tela desde stock)
OrderItem.belongsTo(StockItem, { foreignKey: 'stock_fabric_id', as: 'stockFabric' });
StockItem.hasMany(OrderItem, { foreignKey: 'stock_fabric_id', as: 'fabric_order_items' });

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

// ─── Catálogo de productos ──────────────────────────────────────────────────

// CatalogProduct ↔ Client
CatalogProduct.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Client.hasMany(CatalogProduct, { foreignKey: 'client_id', as: 'catalog_products' });

// CatalogProductImage ↔ CatalogProduct
CatalogProduct.hasMany(CatalogProductImage, { foreignKey: 'product_id', as: 'images', onDelete: 'CASCADE' });
CatalogProductImage.belongsTo(CatalogProduct, { foreignKey: 'product_id', as: 'product' });

// CatalogProductSize ↔ CatalogProduct
CatalogProduct.hasMany(CatalogProductSize, { foreignKey: 'product_id', as: 'sizes', onDelete: 'CASCADE' });
CatalogProductSize.belongsTo(CatalogProduct, { foreignKey: 'product_id', as: 'product' });

// CatalogOrder ↔ Client
CatalogOrder.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Client.hasMany(CatalogOrder, { foreignKey: 'client_id', as: 'catalog_orders' });

// CatalogOrder ↔ User (vendedor)
CatalogOrder.belongsTo(User, { foreignKey: 'seller_id', as: 'seller' });
User.hasMany(CatalogOrder, { foreignKey: 'seller_id', as: 'catalog_sold_orders' });

// CatalogOrderItem ↔ CatalogOrder
CatalogOrder.hasMany(CatalogOrderItem, { foreignKey: 'catalog_order_id', as: 'items', onDelete: 'CASCADE' });
CatalogOrderItem.belongsTo(CatalogOrder, { foreignKey: 'catalog_order_id', as: 'order' });

// CatalogOrderItem ↔ CatalogProduct
CatalogOrderItem.belongsTo(CatalogProduct, { foreignKey: 'product_id', as: 'product' });
CatalogProduct.hasMany(CatalogOrderItem, { foreignKey: 'product_id', as: 'order_items' });

// CatalogInvoice ↔ CatalogOrder (1:1)
CatalogOrder.hasOne(CatalogInvoice, { foreignKey: 'catalog_order_id', as: 'invoice', onDelete: 'CASCADE' });
CatalogInvoice.belongsTo(CatalogOrder, { foreignKey: 'catalog_order_id', as: 'order' });

// CatalogInvoiceImage ↔ CatalogInvoice
CatalogInvoice.hasMany(CatalogInvoiceImage, { foreignKey: 'catalog_invoice_id', as: 'images', onDelete: 'CASCADE' });
CatalogInvoiceImage.belongsTo(CatalogInvoice, { foreignKey: 'catalog_invoice_id', as: 'invoice' });

// InvoicePayment ↔ Invoice
Invoice.hasMany(InvoicePayment, { foreignKey: 'invoice_id', as: 'payments', onDelete: 'CASCADE' });
InvoicePayment.belongsTo(Invoice, { foreignKey: 'invoice_id', as: 'invoice' });

// CatalogInvoicePayment ↔ CatalogInvoice
CatalogInvoice.hasMany(CatalogInvoicePayment, { foreignKey: 'catalog_invoice_id', as: 'payments', onDelete: 'CASCADE' });
CatalogInvoicePayment.belongsTo(CatalogInvoice, { foreignKey: 'catalog_invoice_id', as: 'invoice' });

export {
  User,
  Client,
  Product,
  CatalogProduct,
  CatalogProductImage,
  CatalogProductSize,
  CatalogOrder,
  CatalogOrderItem,
  CatalogInvoice,
  CatalogInvoiceImage,
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
  InvoicePayment,
  CatalogInvoicePayment,
};
