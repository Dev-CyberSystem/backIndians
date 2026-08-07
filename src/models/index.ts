// Punto de entrada de modelos: define todas las asociaciones entre tablas
import { ProductCategory } from './ProductCategory';
import { StoreEvent } from './StoreEvent';
import { StoreWishlist } from './StoreWishlist';
import { StoreCustomer } from './StoreCustomer';
import { StoreAddress } from './StoreAddress';
import { StoreCoupon } from './StoreCoupon';
import { StoreOrder } from './StoreOrder';
import { StoreOrderItem } from './StoreOrderItem';
import { StoreOrderStatusHistory } from './StoreOrderStatusHistory';
import { StoreReturn } from './StoreReturn';
import { StoreReturnItem } from './StoreReturnItem';
import { StoreCartReminder } from './StoreCartReminder';
import { WebhookEvent } from './WebhookEvent';
import { User } from './User';
import { Client } from './Client';
import { Product } from './Product';
import { CatalogProduct } from './CatalogProduct';
import { CatalogProductImage } from './CatalogProductImage';
import { CatalogProductSize } from './CatalogProductSize';
import { CatalogOrder } from './CatalogOrder';
import { CatalogOrderItem } from './CatalogOrderItem';
import { CatalogStockMovement } from './CatalogStockMovement';
import { CatalogInvoice } from './CatalogInvoice';
import { CatalogInvoiceImage } from './CatalogInvoiceImage';
import { InvoicePayment } from './InvoicePayment';
import { CatalogInvoicePayment } from './CatalogInvoicePayment';
import { Order } from './Order';
import { OrderItem } from './OrderItem';
import { OrderImage } from './OrderImage';
import { OrderStatusHistory } from './OrderStatusHistory';
import { OrderChecklistCheck } from './OrderChecklistCheck';
import { Invoice } from './Invoice';
import { StockItem } from './StockItem';
import { StockCategory } from './StockCategory';
import { StockMovement } from './StockMovement';
import { GarmentType } from './GarmentType';
import { GarmentCostItem } from './GarmentCostItem';
import { GarmentCost } from './GarmentCost';
import { GarmentCostVersion } from './GarmentCostVersion';
import { GarmentCostVersionItem } from './GarmentCostVersionItem';
import { OrderCostDetail } from './OrderCostDetail';
import { FabricType } from './FabricType';
import { SizeChart } from './SizeChart';
import { PasswordResetToken } from './PasswordResetToken';
import { Settings } from './Settings';
import { CashAccount } from './CashAccount';
import { CashTransactionCategory } from './CashTransactionCategory';
import { CashTransaction } from './CashTransaction';
import { CashAuditEvent } from './CashAuditEvent';

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

// Order ↔ OrderChecklistCheck (tildes de los controles de producción)
Order.hasMany(OrderChecklistCheck, { foreignKey: 'order_id', as: 'checklist_checks', onDelete: 'CASCADE' });
OrderChecklistCheck.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
OrderChecklistCheck.belongsTo(User, { foreignKey: 'checked_by', as: 'checker' });

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

// CatalogStockMovement ↔ CatalogProduct / CatalogProductSize / StoreOrder / CatalogOrder / User
CatalogStockMovement.belongsTo(CatalogProduct, { foreignKey: 'catalog_product_id', as: 'product' });
CatalogProduct.hasMany(CatalogStockMovement, { foreignKey: 'catalog_product_id', as: 'stock_movements' });
CatalogStockMovement.belongsTo(CatalogProductSize, { foreignKey: 'catalog_product_size_id', as: 'size' });
CatalogProductSize.hasMany(CatalogStockMovement, { foreignKey: 'catalog_product_size_id', as: 'stock_movements' });
CatalogStockMovement.belongsTo(StoreOrder, { foreignKey: 'store_order_id', as: 'store_order' });
CatalogStockMovement.belongsTo(CatalogOrder, { foreignKey: 'catalog_order_id', as: 'catalog_order' });
CatalogStockMovement.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// CashTransaction ↔ CashAccount (cuenta origen)
CashTransaction.belongsTo(CashAccount, { foreignKey: 'account_id', as: 'account' });
CashAccount.hasMany(CashTransaction, { foreignKey: 'account_id', as: 'transactions' });

// CashTransaction ↔ CashAccount (cuenta destino de transferencia)
CashTransaction.belongsTo(CashAccount, { foreignKey: 'transfer_account_id', as: 'transfer_account' });

// CashTransaction ↔ CashTransactionCategory
CashTransaction.belongsTo(CashTransactionCategory, { foreignKey: 'category_id', as: 'category' });
CashTransactionCategory.hasMany(CashTransaction, { foreignKey: 'category_id', as: 'transactions' });

// CashTransaction ↔ User
CashTransaction.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
User.hasMany(CashTransaction, { foreignKey: 'created_by', as: 'cash_transactions' });

// CashTransaction ↔ CashTransaction (reversión — self-reference)
CashTransaction.belongsTo(CashTransaction, { foreignKey: 'reversal_of_id', as: 'reversal_of' });
CashTransaction.hasMany(CashTransaction, { foreignKey: 'reversal_of_id', as: 'reversals' });
CashTransaction.belongsTo(User, { foreignKey: 'reversed_by', as: 'reverser' });

// CashAuditEvent ↔ User (responsable del evento)
// Sin `hasMany` inverso a propósito: la auditoría se consulta siempre desde el
// evento hacia el usuario, nunca al revés, y no queremos exponer un accesor que
// invite a traer el historial de auditoría colgado de un User.
CashAuditEvent.belongsTo(User, { foreignKey: 'user_id', as: 'actor' });

// ─── Tipos de prenda por cliente ────────────────────────────────────────────
// client_id NULL = tipo global/legado (compartido por todos).
GarmentType.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Client.hasMany(GarmentType, { foreignKey: 'client_id', as: 'garment_types' });

// ─── Costos de prendas ──────────────────────────────────────────────────────

// GarmentCost ↔ Client / GarmentType
GarmentCost.belongsTo(Client, { foreignKey: 'client_id', as: 'client' });
Client.hasMany(GarmentCost, { foreignKey: 'client_id', as: 'garment_costs' });
GarmentCost.belongsTo(GarmentType, { foreignKey: 'garment_type_id', as: 'garmentType' });
GarmentType.hasMany(GarmentCost, { foreignKey: 'garment_type_id', as: 'garment_costs' });
GarmentCost.belongsTo(User, { foreignKey: 'updated_by', as: 'editor' });

// GarmentCost ↔ GarmentCostVersion (historial)
GarmentCost.hasMany(GarmentCostVersion, { foreignKey: 'garment_cost_id', as: 'versions', onDelete: 'CASCADE' });
GarmentCostVersion.belongsTo(GarmentCost, { foreignKey: 'garment_cost_id', as: 'garment_cost' });
GarmentCost.belongsTo(GarmentCostVersion, { foreignKey: 'current_version_id', as: 'current_version' });
GarmentCostVersion.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

// GarmentCostVersion ↔ GarmentCostVersionItem
GarmentCostVersion.hasMany(GarmentCostVersionItem, { foreignKey: 'version_id', as: 'items', onDelete: 'CASCADE' });
GarmentCostVersionItem.belongsTo(GarmentCostVersion, { foreignKey: 'version_id', as: 'version' });
GarmentCostVersionItem.belongsTo(GarmentCostItem, { foreignKey: 'cost_item_id', as: 'cost_item' });

// Order ↔ OrderCostDetail (snapshot congelado)
Order.hasMany(OrderCostDetail, { foreignKey: 'order_id', as: 'cost_details', onDelete: 'CASCADE' });
OrderCostDetail.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
OrderCostDetail.belongsTo(GarmentType, { foreignKey: 'garment_type_id', as: 'garmentType' });

// ─── Tienda (Ecommerce) ─────────────────────────────────────────────────────

// StoreAddress ↔ StoreCustomer
StoreCustomer.hasMany(StoreAddress, { foreignKey: 'customer_id', as: 'addresses', onDelete: 'CASCADE' });
StoreAddress.belongsTo(StoreCustomer, { foreignKey: 'customer_id', as: 'customer' });

// StoreOrder ↔ StoreCustomer
StoreCustomer.hasMany(StoreOrder, { foreignKey: 'customer_id', as: 'store_orders' });
StoreOrder.belongsTo(StoreCustomer, { foreignKey: 'customer_id', as: 'customer' });

// StoreOrderItem ↔ StoreOrder
StoreOrder.hasMany(StoreOrderItem, { foreignKey: 'store_order_id', as: 'items', onDelete: 'CASCADE' });
StoreOrderItem.belongsTo(StoreOrder, { foreignKey: 'store_order_id', as: 'order' });

// StoreOrder ↔ StoreOrderStatusHistory (traza de cambios de estado)
StoreOrder.hasMany(StoreOrderStatusHistory, { foreignKey: 'store_order_id', as: 'status_history', onDelete: 'CASCADE' });
StoreOrderStatusHistory.belongsTo(StoreOrder, { foreignKey: 'store_order_id', as: 'order' });
StoreOrderStatusHistory.belongsTo(User, { foreignKey: 'changed_by', as: 'changer' });

// StoreOrderItem ↔ CatalogProduct
StoreOrderItem.belongsTo(CatalogProduct, { foreignKey: 'catalog_product_id', as: 'product' });
CatalogProduct.hasMany(StoreOrderItem, { foreignKey: 'catalog_product_id', as: 'store_order_items' });

// StoreOrderItem ↔ CatalogProductSize
StoreOrderItem.belongsTo(CatalogProductSize, { foreignKey: 'catalog_product_size_id', as: 'size' });

// StoreOrder ↔ StoreCoupon
StoreCoupon.hasMany(StoreOrder, { foreignKey: 'coupon_id', as: 'orders' });
StoreOrder.belongsTo(StoreCoupon, { foreignKey: 'coupon_id', as: 'coupon' });

// StoreReturn ↔ StoreOrder / StoreReturnItem / User (2.4)
StoreOrder.hasMany(StoreReturn, { foreignKey: 'store_order_id', as: 'returns' });
StoreReturn.belongsTo(StoreOrder, { foreignKey: 'store_order_id', as: 'order' });
StoreReturn.belongsTo(User, { foreignKey: 'requested_by', as: 'requester' });
StoreReturn.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer' });
StoreReturn.hasMany(StoreReturnItem, { foreignKey: 'store_return_id', as: 'items', onDelete: 'CASCADE' });
StoreReturnItem.belongsTo(StoreReturn, { foreignKey: 'store_return_id', as: 'return' });
StoreReturnItem.belongsTo(StoreOrderItem, { foreignKey: 'store_order_item_id', as: 'orderItem' });

// StoreWishlist ↔ StoreCustomer
StoreCustomer.hasMany(StoreWishlist, { foreignKey: 'customer_id', as: 'wishlist', onDelete: 'CASCADE' });
StoreWishlist.belongsTo(StoreCustomer, { foreignKey: 'customer_id', as: 'customer' });

// StoreCartReminder ↔ StoreCustomer / User
StoreCustomer.hasMany(StoreCartReminder, { foreignKey: 'customer_id', as: 'cart_reminders', onDelete: 'CASCADE' });
StoreCartReminder.belongsTo(StoreCustomer, { foreignKey: 'customer_id', as: 'customer' });
StoreCartReminder.belongsTo(User, { foreignKey: 'sent_by', as: 'sender' });

// StoreWishlist ↔ CatalogProduct
CatalogProduct.hasMany(StoreWishlist, { foreignKey: 'catalog_product_id', as: 'wishlisted_by' });
StoreWishlist.belongsTo(CatalogProduct, { foreignKey: 'catalog_product_id', as: 'product' });

// ─── Catálogo de productos ──────────────────────────────────────────────────

// CatalogProduct ↔ GarmentType
CatalogProduct.belongsTo(GarmentType, { foreignKey: 'garment_type_id', as: 'garmentType' });
GarmentType.hasMany(CatalogProduct, { foreignKey: 'garment_type_id', as: 'catalog_products' });

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
  StoreEvent,
  StoreCustomer,
  StoreAddress,
  StoreCoupon,
  StoreOrder,
  StoreOrderItem,
  StoreOrderStatusHistory,
  StoreReturn,
  StoreReturnItem,
  StoreCartReminder,
  StoreWishlist,
  WebhookEvent,
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
  OrderChecklistCheck,
  Invoice,
  StockItem,
  GarmentType,
  GarmentCostItem,
  GarmentCost,
  GarmentCostVersion,
  GarmentCostVersionItem,
  OrderCostDetail,
  FabricType,
  SizeChart,
  PasswordResetToken,
  Settings,
  StockCategory,
  StockMovement,
  InvoicePayment,
  CatalogInvoicePayment,
  CashAccount,
  CashTransactionCategory,
  CashTransaction,
  CashAuditEvent,
  ProductCategory,
};
