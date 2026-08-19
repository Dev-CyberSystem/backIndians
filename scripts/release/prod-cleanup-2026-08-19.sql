-- Limpieza de datos de prueba en PRODUCCIÓN antes de empezar a operar con datos
-- reales. Alcance acordado con el cliente el 2026-08-19 — ver conversación /
-- 10-SESSION-HANDOFF.md para el detalle de qué se decidió mantener y por qué.
--
-- REQUISITO: correr backup con `npm run db:backup -- --tag=pre-limpieza` ANTES
-- de ejecutar este script. Es irreversible.
--
-- Uso:
--   npm run db:query -- scripts/release/prod-cleanup-2026-08-19.sql

SET FOREIGN_KEY_CHECKS = 0;

-- ─── Transaccional (se vacía por completo: pedidos, tienda, facturación, caja,
--     stock, logs) ───────────────────────────────────────────────────────────
TRUNCATE order_checklist_checks;
TRUNCATE order_cost_details;
TRUNCATE order_images;
TRUNCATE order_status_history;
TRUNCATE order_items;
TRUNCATE orders;

TRUNCATE store_order_status_history;
TRUNCATE store_order_items;
TRUNCATE store_orders;
TRUNCATE store_return_items;
TRUNCATE store_returns;
TRUNCATE store_addresses;
TRUNCATE store_coupons;
TRUNCATE store_wishlist;
TRUNCATE store_cart_reminders;
TRUNCATE store_withdrawal_requests;
TRUNCATE store_events;

TRUNCATE catalog_order_items;
TRUNCATE catalog_orders;

TRUNCATE invoice_payments;
TRUNCATE invoices;
TRUNCATE catalog_invoice_payments;
TRUNCATE catalog_invoice_images;
TRUNCATE catalog_invoices;

TRUNCATE cash_audit_events;
TRUNCATE cash_transactions;

TRUNCATE catalog_stock_movements;
TRUNCATE stock_movements;
TRUNCATE stock_items;

TRUNCATE webhook_events;
TRUNCATE password_reset_tokens;
TRUNCATE legal_acceptances;

-- ─── Catálogo de prueba (6 catalog_products del cliente "Indians", con precios
--     inconsistentes, más sus imágenes/talles) ─────────────────────────────────
TRUNCATE catalog_product_images;
TRUNCATE catalog_product_sizes;
TRUNCATE catalog_products;

-- ─── Costos de prenda de prueba (los 3 cuelgan enteros del cliente/tipo de
--     prenda de prueba que se borra abajo) ─────────────────────────────────────
TRUNCATE garment_cost_version_items;
TRUNCATE garment_cost_versions;
TRUNCATE garment_costs;

-- ─── Clientes y compradores de tienda: se borran todos ────────────────────────
TRUNCATE clients;
TRUNCATE store_customers;

-- ─── Tipos de prenda de prueba (los 9 reales son globales, client_id NULL, no
--     se tocan) ────────────────────────────────────────────────────────────────
DELETE FROM garment_types WHERE id IN (10, 11, 12);

-- ─── Cuentas de staff con dominio incorrecto (@indians.com; el dominio real es
--     indians.com.ar). Se mantienen diego.olmi@gmail.com, indians.arg@gmail.com,
--     valentincarrillo0@gmail.com y sistema@indians.internal ────────────────────
DELETE FROM users WHERE id IN (2, 3, 4, 6, 7);

-- ─── Residuos de un smoke-test automático (mismo timestamp en ambas filas) ─────
DELETE FROM cash_transaction_categories WHERE name LIKE 'SMOKE-CAT-%';
DELETE FROM cash_accounts WHERE name LIKE 'SMOKE-TEST-%';

-- ─── Las cuentas de caja reales quedan, pero su saldo viene de movimientos que
--     acabamos de borrar: sin este reset "Caja Principal" mostraría -$3.449.985
--     sin un solo movimiento que lo explique ─────────────────────────────────
UPDATE cash_accounts SET current_balance = 0 WHERE id IN (1, 2, 3);

SET FOREIGN_KEY_CHECKS = 1;

-- ─── Verificación rápida post-limpieza ─────────────────────────────────────────
SELECT 'orders' t, COUNT(*) filas FROM orders
UNION ALL SELECT 'store_orders', COUNT(*) FROM store_orders
UNION ALL SELECT 'catalog_products', COUNT(*) FROM catalog_products
UNION ALL SELECT 'clients', COUNT(*) FROM clients
UNION ALL SELECT 'store_customers', COUNT(*) FROM store_customers
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'garment_types', COUNT(*) FROM garment_types
UNION ALL SELECT 'cash_accounts', COUNT(*) FROM cash_accounts
UNION ALL SELECT 'cash_transaction_categories', COUNT(*) FROM cash_transaction_categories;
SELECT id, name, current_balance FROM cash_accounts ORDER BY id;
SELECT id, email FROM users ORDER BY id;
