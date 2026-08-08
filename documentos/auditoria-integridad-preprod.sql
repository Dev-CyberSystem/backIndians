-- ============================================================================
--  DIAGNÓSTICOS DE INTEGRIDAD — Auditoría integral de preproducción (2026-08-08)
--
--  TODAS las consultas son de SOLO LECTURA. Ninguna modifica datos.
--  Uso:  mysql -u <user> -p <base> < auditoria-integridad-preprod.sql
--
--  Criterio de lectura: toda consulta debe devolver 0 filas / valor 0.
--  Cualquier fila devuelta es una inconsistencia a investigar ANTES del release
--  y también después (correr esto en el smoke test post-despliegue, punto 11
--  del runbook).
-- ============================================================================

SELECT '=== 1. STOCK DE CATÁLOGO: saldo vs. ledger de movimientos ===' AS check_name;
-- Invariante: el último new_quantity registrado debe coincidir con el saldo actual.
SELECT p.id, p.title, p.stock_quantity AS saldo_actual, m.new_quantity AS ultimo_ledger
FROM catalog_products p
JOIN catalog_stock_movements m ON m.id = (
  SELECT m2.id FROM catalog_stock_movements m2
  WHERE m2.catalog_product_id = p.id AND m2.catalog_product_size_id IS NULL
    AND m2.type NOT IN ('reserve','release')
  ORDER BY m2.id DESC LIMIT 1
)
WHERE p.stock_quantity <> m.new_quantity;

SELECT '=== 2. STOCK NEGATIVO O RESERVA MAYOR AL FÍSICO ===' AS check_name;
SELECT 'producto' AS nivel, id, title, stock_quantity, stock_reserved
FROM catalog_products WHERE stock_quantity < 0 OR stock_reserved < 0 OR stock_reserved > stock_quantity
UNION ALL
SELECT 'talle', s.id, CONCAT(p.title,' / ',s.size_name), s.stock_quantity, s.stock_reserved
FROM catalog_product_sizes s JOIN catalog_products p ON p.id = s.product_id
WHERE s.stock_quantity < 0 OR s.stock_reserved < 0 OR s.stock_reserved > s.stock_quantity;

SELECT '=== 2b. STOCK DE MATERIALES: saldo vs. ledger de movimientos ===' AS check_name;
-- Invariante equivalente a la 1 para el stock interno de materiales.
SELECT i.id, i.name, i.current_quantity AS saldo_actual, m.new_quantity AS ultimo_ledger
FROM stock_items i
JOIN stock_movements m ON m.id = (
  SELECT m2.id FROM stock_movements m2 WHERE m2.stock_item_id = i.id ORDER BY m2.id DESC LIMIT 1
)
WHERE i.current_quantity <> m.new_quantity;

SELECT '=== 3. MOVIMIENTOS DE STOCK SIN ORIGEN TRAZABLE ===' AS check_name;
SELECT id, catalog_product_id, type, source, createdAt
FROM catalog_stock_movements
WHERE source IS NULL
   OR (store_order_id IS NULL AND catalog_order_id IS NULL AND user_id IS NULL);

SELECT '=== 4. CAJA: saldo de cuenta vs. suma de asientos ===' AS check_name;
-- current_balance debe ser exactamente ingresos - egresos +/- transferencias.
SELECT a.id, a.name, a.current_balance AS saldo_guardado,
       COALESCE(mov.calculado, 0) AS saldo_calculado,
       a.current_balance - COALESCE(mov.calculado, 0) AS diferencia
FROM cash_accounts a
LEFT JOIN (
  SELECT acc AS account_id, SUM(delta) AS calculado FROM (
    SELECT account_id AS acc,  amount AS delta FROM cash_transactions WHERE type = 'income'
    UNION ALL
    SELECT account_id,        -amount        FROM cash_transactions WHERE type = 'expense'
    UNION ALL
    SELECT account_id,        -amount        FROM cash_transactions WHERE type = 'transfer'
    UNION ALL
    SELECT transfer_account_id, amount       FROM cash_transactions WHERE type = 'transfer' AND transfer_account_id IS NOT NULL
  ) x GROUP BY acc
) mov ON mov.account_id = a.id
WHERE ABS(a.current_balance - COALESCE(mov.calculado, 0)) > 0.001;

SELECT '=== 5. CAJA: asientos con monto no positivo o sin categoría/cuenta ===' AS check_name;
SELECT id, account_id, category_id, type, amount, date
FROM cash_transactions
WHERE amount <= 0 OR account_id IS NULL OR category_id IS NULL;

SELECT '=== 6. CAJA: reversiones que exceden el monto del asiento original ===' AS check_name;
SELECT o.id AS original_id, o.amount AS monto_original,
       SUM(r.amount) AS total_revertido
FROM cash_transactions o
JOIN cash_transactions r ON r.reversal_of_id = o.id
GROUP BY o.id, o.amount
HAVING SUM(r.amount) > o.amount + 0.001;

SELECT '=== 7. TIENDA: pedidos pagados sin registro en caja ===' AS check_name;
SELECT id, order_number, payment_method, status, stock_confirmed_at
FROM store_orders
WHERE stock_confirmed_at IS NOT NULL AND cash_recorded_at IS NULL;

SELECT '=== 8. TIENDA: pedido cancelado sin restitución de stock ===' AS check_name;
SELECT id, order_number, status FROM store_orders
WHERE status = 'cancelled' AND stock_restored_at IS NULL;

SELECT '=== 9. TIENDA: pago aprobado en MP pero pedido sin acreditar ===' AS check_name;
SELECT id, order_number, status, mp_status FROM store_orders
WHERE status = 'pending_payment' AND mp_status = 'approved';

SELECT '=== 10. TIENDA: totales del pedido vs. suma de sus ítems ===' AS check_name;
SELECT o.id, o.order_number, o.subtotal AS subtotal_guardado,
       SUM(i.subtotal) AS subtotal_items,
       o.total_amount,
       o.subtotal - o.discount_amount + o.shipping_cost AS total_recalculado
FROM store_orders o JOIN store_order_items i ON i.store_order_id = o.id
GROUP BY o.id, o.order_number, o.subtotal, o.discount_amount, o.shipping_cost, o.total_amount
HAVING ABS(o.subtotal - SUM(i.subtotal)) > 0.01
    OR ABS(o.total_amount - (o.subtotal - o.discount_amount + o.shipping_cost)) > 0.01;

SELECT '=== 11. DUPLICADOS: números de comprobante / pedido ===' AS check_name;
SELECT 'orders' AS tabla, order_number AS valor, COUNT(*) n FROM orders GROUP BY order_number HAVING n > 1
UNION ALL
SELECT 'store_orders', order_number, COUNT(*) FROM store_orders GROUP BY order_number HAVING COUNT(*) > 1
UNION ALL
SELECT 'invoices', invoice_number, COUNT(*) FROM invoices GROUP BY invoice_number HAVING COUNT(*) > 1
UNION ALL
SELECT 'catalog_invoices', invoice_number, COUNT(*) FROM catalog_invoices GROUP BY invoice_number HAVING COUNT(*) > 1;

SELECT '=== 12. FACTURACIÓN: cobros que exceden el total de la factura ===' AS check_name;
SELECT i.id, i.invoice_number, i.total_amount, SUM(p.amount) AS cobrado
FROM invoices i JOIN invoice_payments p ON p.invoice_id = i.id
GROUP BY i.id, i.invoice_number, i.total_amount
HAVING SUM(p.amount) > i.total_amount + 0.01;

SELECT '=== 13. HUÉRFANOS: filas que apuntan a un padre inexistente ===' AS check_name;
SELECT 'order_items' AS tabla, COUNT(*) n FROM order_items oi
  LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL
UNION ALL
SELECT 'store_order_items', COUNT(*) FROM store_order_items si
  LEFT JOIN store_orders so ON so.id = si.store_order_id WHERE so.id IS NULL
UNION ALL
SELECT 'invoice_payments', COUNT(*) FROM invoice_payments ip
  LEFT JOIN invoices i ON i.id = ip.invoice_id WHERE i.id IS NULL
UNION ALL
SELECT 'cash_transactions(cuenta)', COUNT(*) FROM cash_transactions ct
  LEFT JOIN cash_accounts a ON a.id = ct.account_id WHERE a.id IS NULL;

SELECT '=== 14. USUARIOS: rol inválido o sin administradores activos ===' AS check_name;
SELECT 'roles_invalidos' AS check_item, COUNT(*) AS n FROM users
WHERE role NOT IN ('admin','billing','workshop','seller')
UNION ALL
SELECT 'admins_activos', COUNT(*) FROM users WHERE role = 'admin' AND active = 1;

SELECT '=== 15. FECHAS IMPOSIBLES (futuras) ===' AS check_name;
SELECT 'store_orders' AS tabla, COUNT(*) n FROM store_orders WHERE createdAt > NOW() + INTERVAL 1 DAY
UNION ALL
SELECT 'cash_transactions', COUNT(*) FROM cash_transactions WHERE date > CURDATE() + INTERVAL 1 DAY
UNION ALL
SELECT 'invoices', COUNT(*) FROM invoices WHERE createdAt > NOW() + INTERVAL 1 DAY;
