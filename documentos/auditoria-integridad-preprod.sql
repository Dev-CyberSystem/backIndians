-- ============================================================================
--  DIAGNÓSTICOS DE INTEGRIDAD — Sistema Indians
--  Creado:    2026-08-08 (auditoría integral de preproducción)
--  Revisado:  2026-08-08 (revisión adversarial — REV-02, REV-03, REV-06)
--
--  TODAS las consultas son de SOLO LECTURA sobre los datos. Lo único que se
--  escribe es una TEMPORARY TABLE con los resultados, que muere con la sesión.
--
--  Uso:
--    mysql -u <user> -p <base> < auditoria-integridad-preprod.sql
--
--  CRITERIO DE LECTURA — uno solo, sin excepciones:
--    La tabla final tiene una columna `anomalias`. **Todas las filas deben dar
--    0.** Cualquier valor > 0 es una inconsistencia a investigar antes del
--    release, y también después (paso 13 del runbook).
--
--  La última línea de la salida es el veredicto: `INTEGRIDAD OK` o
--  `INTEGRIDAD FALLA: <n> anomalias`.
--
--  PARA USARLO COMO PASO AUTOMATIZABLE (smoke test post-despliegue, CI), el
--  exit code se saca desde el shell — a propósito no se fuerza un error desde
--  SQL, porque hacerlo requeriría CREATE ROUTINE (`SIGNAL` sólo existe dentro
--  de un stored program) y este script tiene que poder correrse contra la base
--  productiva con un usuario de solo lectura:
--
--    mysql -u <user> -p <base> < auditoria-integridad-preprod.sql | tee out.txt
--    grep -q 'INTEGRIDAD OK' out.txt || { echo 'FALLA DE INTEGRIDAD'; exit 1; }
--
--  NOTA sobre la versión anterior: los checks devolvían filas sueltas y el
--  criterio era "0 filas o valor 0", que el check de administradores activos
--  contradecía (ahí 0 es catastrófico, no sano). Ahora todo se normaliza a
--  "cantidad de anomalías", en un solo sentido.
-- ============================================================================

-- Los `ejemplos` se recortan con LEFT(...,500) — alcanza para saber por dónde
-- empezar a mirar sin volcar miles de ids. El límite de GROUP_CONCAT se sube
-- a propósito: si CORTA él, MySQL emite un warning que en modo estricto
-- convierte el INSERT en error y voltea el script entero.
SET SESSION group_concat_max_len = 1000000;

DROP TEMPORARY TABLE IF EXISTS audit_findings;
CREATE TEMPORARY TABLE audit_findings (
  id        VARCHAR(4)   NOT NULL,
  area      VARCHAR(20)  NOT NULL,
  check_name VARCHAR(120) NOT NULL,
  anomalias INT          NOT NULL,
  ejemplos  TEXT         NULL
);

-- ════════════════════════════════════════════════════════════════════════════
--  STOCK DE CATÁLOGO
-- ════════════════════════════════════════════════════════════════════════════

-- 01. Producto SIN talles: su saldo debe coincidir con el último movimiento
--     registrado a nivel producto.
INSERT INTO audit_findings
SELECT '01', 'stock-catalogo', 'Producto sin talles: saldo != ultimo movimiento del ledger',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT p.id
  FROM catalog_products p
  JOIN catalog_stock_movements m ON m.id = (
    SELECT m2.id FROM catalog_stock_movements m2
    WHERE m2.catalog_product_id = p.id AND m2.catalog_product_size_id IS NULL
      AND m2.type NOT IN ('reserve','release')
    ORDER BY m2.id DESC LIMIT 1
  )
  WHERE NOT EXISTS (SELECT 1 FROM catalog_product_sizes s WHERE s.product_id = p.id)
    AND p.stock_quantity <> m.new_quantity
) x;

-- 02. (REV-02) Producto CON talles: el saldo de cada talle vs. su último
--     movimiento. La versión anterior sólo miraba movimientos con
--     `catalog_product_size_id IS NULL`, así que descartaba entero todo
--     producto que vende por talle — es decir, casi todo el catálogo —
--     y devolvía 0 filas pareciendo sano.
INSERT INTO audit_findings
SELECT '02', 'stock-catalogo', 'Talle: saldo != ultimo movimiento del ledger',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT s.id
  FROM catalog_product_sizes s
  JOIN catalog_stock_movements m ON m.id = (
    SELECT m2.id FROM catalog_stock_movements m2
    WHERE m2.catalog_product_size_id = s.id
      AND m2.type NOT IN ('reserve','release')
    ORDER BY m2.id DESC LIMIT 1
  )
  WHERE s.stock_quantity <> m.new_quantity
) x;

-- 03. Reservas huérfanas: pedidos sin pagar, vencidos hace rato, que siguen
--     reteniendo stock. `expireStaleOrders` corre cada hora y libera los de
--     más de ORDER_EXPIRY_HOURS (48 h por defecto); si acá aparece algo, el job
--     no está corriendo o está fallando en silencio, y hay mercadería
--     bloqueada que nadie puede comprar.
--
--     Margen de 24 h sobre el umbral del job para no marcar los que están
--     justo en el borde entre dos corridas.
INSERT INTO audit_findings
SELECT '03', 'stock-catalogo', 'Reservas huerfanas: pedidos vencidos que no expiraron',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT id, order_number FROM store_orders
  WHERE status = 'pending_payment'
    AND stock_reserved_at IS NOT NULL
    AND stock_confirmed_at IS NULL
    AND stock_restored_at IS NULL
    AND createdAt < NOW() - INTERVAL 72 HOUR
) x;

-- NOTA (REV-03a, corregido tras ejecutarlo): acá había dos checks comparando
-- `catalog_products.stock_quantity` / `.stock_reserved` contra la suma de sus
-- talles. **Se quitaron a propósito: no son una invariante del sistema.** El
-- checkout usa el stock del TALLE cuando el ítem trae talle y el del PRODUCTO
-- cuando no (`store.service.ts:721` vs `:733`), y la vitrina filtra por talle
-- (`store.service.ts:274`), así que para un producto con talles el campo a
-- nivel producto no lo mantiene nadie y difiere desde el alta. Marcarlo como
-- anomalía generaba decenas de falsas alarmas permanentes — exactamente el
-- ruido que hace que un script así se deje de mirar.
--
-- La consecuencia real de AUD-15 (reservas perdidas) la detecta el check 06,
-- que compara contra los pedidos y no contra un campo denormalizado.

-- 04. Cupones: el contador de usos vs. los pedidos que realmente lo usaron.
--     El incremento es atómico (`WHERE used_count < max_uses`), así que una
--     diferencia acá significa que se contó un uso que no existe — o al revés,
--     que alguien usó el cupón sin descontarlo del cupo.
INSERT INTO audit_findings
SELECT '04', 'tienda', 'Cupon: used_count != pedidos que lo usaron',
       COUNT(*), LEFT(GROUP_CONCAT(v ORDER BY v), 500)
FROM (
  SELECT CONCAT(c.code,' contado:',c.used_count,' real:',COUNT(o.id)) AS v
  FROM store_coupons c
  LEFT JOIN store_orders o ON o.coupon_id = c.id AND o.status <> 'cancelled'
  GROUP BY c.id, c.code, c.used_count
  HAVING c.used_count <> COUNT(o.id)
) x;

-- 05. Stock negativo o reserva mayor al físico, a nivel producto y a nivel talle.
INSERT INTO audit_findings
SELECT '05', 'stock-catalogo', 'Stock negativo o reserva mayor al fisico',
       COUNT(*), LEFT(GROUP_CONCAT(etiqueta ORDER BY etiqueta), 500)
FROM (
  SELECT CONCAT('producto:', id) AS etiqueta
  FROM catalog_products
  WHERE stock_quantity < 0 OR stock_reserved < 0 OR stock_reserved > stock_quantity
  UNION ALL
  SELECT CONCAT('talle:', id)
  FROM catalog_product_sizes
  WHERE stock_quantity < 0 OR stock_reserved < 0 OR stock_reserved > stock_quantity
) x;

-- 06. (REV-03b) El reservado real de cada producto debe coincidir con lo que
--     realmente tienen comprometido los pedidos pendientes.
--
--     Se compara a nivel PRODUCTO (reservado del producto + el de todos sus
--     talles) a propósito: `store_order_items.catalog_product_size_id` tiene
--     `ON DELETE SET NULL`, así que a nivel talle el dato puede haberse
--     perdido, pero el total por producto se sostiene igual.
--
--     Detecta las dos caras del problema: reservas perdidas (lo que hacía
--     AUD-15, y que habilita vender dos veces las mismas unidades) y reservas
--     huérfanas de pedidos abandonados que nunca expiraron.
INSERT INTO audit_findings
SELECT '06', 'stock-catalogo', 'Reservado real != reservado por pedidos pendientes',
       COUNT(*), LEFT(GROUP_CONCAT(CONCAT(id,' real:',reservado_real,' esperado:',reservado_esperado) ORDER BY id), 500)
FROM (
  SELECT p.id,
         p.stock_reserved + COALESCE((
           SELECT SUM(s.stock_reserved) FROM catalog_product_sizes s WHERE s.product_id = p.id
         ), 0) AS reservado_real,
         COALESCE((
           SELECT SUM(i.quantity)
           FROM store_order_items i
           JOIN store_orders o ON o.id = i.store_order_id
           WHERE i.catalog_product_id = p.id
             AND o.stock_reserved_at IS NOT NULL
             AND o.stock_confirmed_at IS NULL
             AND o.stock_restored_at IS NULL
         ), 0) AS reservado_esperado
  FROM catalog_products p
) x
WHERE reservado_real <> reservado_esperado;

-- 07. (REV-03) Encadenamiento del ledger: el `previous_quantity` de cada
--     movimiento tiene que ser el `new_quantity` del anterior sobre la misma
--     fila y el mismo campo. Los checks 01/02 sólo miran el ÚLTIMO movimiento,
--     así que una manipulación en el medio del historial les pasa por debajo.
INSERT INTO audit_findings
SELECT '07', 'stock-catalogo', 'Ledger desencadenado (previous != new del anterior)',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT m.id
  FROM catalog_stock_movements m
  JOIN catalog_stock_movements prev ON prev.id = (
    SELECT p2.id FROM catalog_stock_movements p2
    WHERE p2.id < m.id
      AND p2.catalog_product_id = m.catalog_product_id
      AND (p2.catalog_product_size_id <=> m.catalog_product_size_id)
      -- Mismo campo: reserve/release mueven stock_reserved, el resto el físico.
      AND (p2.type IN ('reserve','release')) = (m.type IN ('reserve','release'))
    ORDER BY p2.id DESC LIMIT 1
  )
  WHERE m.previous_quantity <> prev.new_quantity
) x;

-- ════════════════════════════════════════════════════════════════════════════
--  STOCK DE MATERIALES
-- ════════════════════════════════════════════════════════════════════════════

-- 08. Saldo del material vs. su último movimiento.
INSERT INTO audit_findings
SELECT '08', 'stock-materiales', 'Material: saldo != ultimo movimiento del ledger',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT i.id
  FROM stock_items i
  JOIN stock_movements m ON m.id = (
    SELECT m2.id FROM stock_movements m2 WHERE m2.stock_item_id = i.id ORDER BY m2.id DESC LIMIT 1
  )
  WHERE i.current_quantity <> m.new_quantity
) x;

-- 09. (REV-03) Material con saldo distinto de 0 y CERO movimientos: el check 08
--     usa un JOIN, así que estos quedaban invisibles. `createStockItem` acepta
--     `current_quantity` en el alta sin generar asiento, así que un saldo
--     inicial legítimo cae acá — no es necesariamente un fraude, pero es stock
--     que no tiene respaldo en el ledger y alguien lo tiene que confirmar.
INSERT INTO audit_findings
SELECT '09', 'stock-materiales', 'Material con saldo != 0 y sin ningun movimiento',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT i.id FROM stock_items i
  WHERE i.current_quantity <> 0
    AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.stock_item_id = i.id)
) x;

-- 10. Movimientos de catálogo sin origen trazable.
INSERT INTO audit_findings
SELECT '10', 'stock-catalogo', 'Movimiento sin origen trazable',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT id FROM catalog_stock_movements
  WHERE source IS NULL
     OR (store_order_id IS NULL AND catalog_order_id IS NULL AND user_id IS NULL)
) x;

-- ════════════════════════════════════════════════════════════════════════════
--  CAJA
-- ════════════════════════════════════════════════════════════════════════════

-- 11. Saldo guardado de la cuenta vs. la suma de sus asientos.
--     Los contraasientos se crean con el tipo OPUESTO al original
--     (`reverseTransactionCore`), así que sumar todo con signo ya los netea:
--     no hay que excluir filas.
INSERT INTO audit_findings
SELECT '11', 'caja', 'Saldo de cuenta != suma de asientos',
       COUNT(*), GROUP_CONCAT(CONCAT(id,' dif:',diferencia) ORDER BY id)
FROM (
  SELECT a.id, a.current_balance - COALESCE(mov.calculado, 0) AS diferencia
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
    ) u GROUP BY acc
  ) mov ON mov.account_id = a.id
) x
WHERE ABS(diferencia) > 0.001;

-- 12. Asientos con monto no positivo o sin cuenta/categoría.
INSERT INTO audit_findings
SELECT '12', 'caja', 'Asiento con monto <= 0 o sin cuenta/categoria',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT id FROM cash_transactions
  WHERE amount <= 0 OR account_id IS NULL OR category_id IS NULL
) x;

-- 13. Reversiones que exceden el monto del asiento original.
INSERT INTO audit_findings
SELECT '13', 'caja', 'Reversiones que exceden el monto original',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT o.id
  FROM cash_transactions o
  JOIN cash_transactions r ON r.reversal_of_id = o.id
  GROUP BY o.id, o.amount
  HAVING SUM(r.amount) > o.amount + 0.001
) x;

-- 14. (REV-03c) DOBLE ASIENTO por el mismo pedido de tienda. Todo el módulo de
--     caja descansa en que el alta desde un pedido sea idempotente, y eso no se
--     verificaba en ningún lado: un doble posteo deja el saldo perfectamente
--     coherente con la suma de asientos (el check 11 pasa) y resulta invisible.
--
--     SÓLO `store_order` a propósito (corregido tras ejecutarlo): un pedido de
--     tienda genera como máximo UN ingreso y `cash_recorded_at` lo garantiza,
--     pero **una factura puede tener varios cobros parciales, cada uno con su
--     propio asiento** — así lo documenta `reverseAllForReference` en
--     `cash.service.ts`. Incluyendo facturas, este check daba 20 falsos
--     positivos en la base de desarrollo.
INSERT INTO audit_findings
SELECT '14', 'caja', 'Doble asiento activo por el mismo pedido de tienda',
       COUNT(*), LEFT(GROUP_CONCAT(ref ORDER BY ref), 500)
FROM (
  SELECT CONCAT(reference_type,':',reference_id) AS ref
  FROM cash_transactions
  WHERE reference_type = 'store_order' AND reference_id IS NOT NULL
    AND reversal_of_id IS NULL AND status = 'active'
  GROUP BY reference_type, reference_id
  HAVING COUNT(*) > 1
) x;

-- 15. (REV-03) Coherencia del status: un asiento marcado `reversed` tiene que
--     tener contraasientos por el monto total, y uno `active` no puede tenerlos
--     por el total sin haber cambiado de estado.
INSERT INTO audit_findings
SELECT '15', 'caja', 'status reversed/active incoherente con sus contraasientos',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT o.id
  FROM cash_transactions o
  LEFT JOIN cash_transactions r ON r.reversal_of_id = o.id
  WHERE o.reversal_of_id IS NULL
  GROUP BY o.id, o.amount, o.status
  HAVING (o.status = 'reversed' AND COALESCE(SUM(r.amount),0) < o.amount - 0.001)
      OR (o.status = 'active'   AND COALESCE(SUM(r.amount),0) > o.amount - 0.001 AND COALESCE(SUM(r.amount),0) > 0)
) x;

-- 16. (REV-03) Contraasiento que apunta a un asiento inexistente.
INSERT INTO audit_findings
SELECT '16', 'caja', 'Contraasiento huerfano (reversal_of_id inexistente)',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT r.id FROM cash_transactions r
  LEFT JOIN cash_transactions o ON o.id = r.reversal_of_id
  WHERE r.reversal_of_id IS NOT NULL AND o.id IS NULL
) x;

-- ════════════════════════════════════════════════════════════════════════════
--  TIENDA ONLINE
-- ════════════════════════════════════════════════════════════════════════════

-- 17. Pedido con stock confirmado (pago acreditado) sin registro en caja.
--     Si `store_cash_account_id`/`store_bank_account_id` no están configurados,
--     el código omite el asiento a propósito y esto se dispara: es el síntoma
--     esperado de esa falta de configuración (condición C2), no un bug.
INSERT INTO audit_findings
SELECT '17', 'tienda', 'Pedido pagado sin registro en caja',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT id, order_number FROM store_orders
  WHERE stock_confirmed_at IS NOT NULL AND cash_recorded_at IS NULL
) x;

-- 18. (REV-03) El inverso del 17, que es el caso PEOR: el pedido dice tener su
--     asiento y no existe la fila. Parece registrado y no lo está.
INSERT INTO audit_findings
SELECT '18', 'tienda', 'cash_recorded_at seteado pero sin asiento en caja',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT o.id, o.order_number FROM store_orders o
  WHERE o.cash_recorded_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM cash_transactions ct
      WHERE ct.reference_type = 'store_order' AND ct.reference_id = o.id
    )
) x;

-- 19. Pedido cancelado sin restitución de stock.
INSERT INTO audit_findings
SELECT '19', 'tienda', 'Pedido cancelado sin restitucion de stock',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT id, order_number FROM store_orders
  WHERE status = 'cancelled' AND stock_reserved_at IS NOT NULL AND stock_restored_at IS NULL
) x;

-- 20. Pago aprobado en MercadoPago pero pedido sin acreditar.
INSERT INTO audit_findings
SELECT '20', 'tienda', 'MP aprobado pero pedido en pending_payment',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT id, order_number FROM store_orders
  WHERE status = 'pending_payment' AND mp_status = 'approved'
) x;

-- 21. Totales del pedido vs. la suma de sus ítems.
INSERT INTO audit_findings
SELECT '21', 'tienda', 'Totales del pedido != suma de items',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT o.id, o.order_number
  FROM store_orders o JOIN store_order_items i ON i.store_order_id = o.id
  GROUP BY o.id, o.order_number, o.subtotal, o.discount_amount, o.shipping_cost, o.total_amount
  HAVING ABS(o.subtotal - SUM(i.subtotal)) > 0.01
      OR ABS(o.total_amount - (o.subtotal - o.discount_amount + o.shipping_cost)) > 0.01
) x;

-- 22. (REV-03) Pedido con importe y CERO ítems. El check 21 usa un INNER JOIN,
--     así que justamente el caso más raro le quedaba invisible.
INSERT INTO audit_findings
SELECT '22', 'tienda', 'Pedido con total > 0 y sin items',
       COUNT(*), LEFT(GROUP_CONCAT(order_number ORDER BY id), 500)
FROM (
  SELECT o.id, o.order_number FROM store_orders o
  WHERE o.total_amount > 0
    AND NOT EXISTS (SELECT 1 FROM store_order_items i WHERE i.store_order_id = o.id)
) x;

-- ════════════════════════════════════════════════════════════════════════════
--  NUMERACIÓN, FACTURACIÓN Y REFERENCIAS
-- ════════════════════════════════════════════════════════════════════════════

-- 23. Números de pedido/comprobante duplicados.
--     El `IS NOT NULL` importa (REV-05): MySQL agrupa todos los NULL juntos, y
--     `orders.order_number` es nullable en el modelo — sin el filtro, dos
--     pedidos sin número daban un falso positivo.
INSERT INTO audit_findings
SELECT '23', 'numeracion', 'Numeros de pedido/comprobante duplicados',
       COUNT(*), LEFT(GROUP_CONCAT(v ORDER BY v), 500)
FROM (
  SELECT CONCAT('orders:', order_number) AS v FROM orders
    WHERE order_number IS NOT NULL GROUP BY order_number HAVING COUNT(*) > 1
  UNION ALL
  SELECT CONCAT('store_orders:', order_number) FROM store_orders
    WHERE order_number IS NOT NULL GROUP BY order_number HAVING COUNT(*) > 1
  UNION ALL
  SELECT CONCAT('invoices:', invoice_number) FROM invoices
    WHERE invoice_number IS NOT NULL GROUP BY invoice_number HAVING COUNT(*) > 1
  UNION ALL
  SELECT CONCAT('catalog_invoices:', invoice_number) FROM catalog_invoices
    WHERE invoice_number IS NOT NULL GROUP BY invoice_number HAVING COUNT(*) > 1
) x;

-- 24. Cobros que exceden el total de la factura, en los DOS circuitos de
--     facturación (antes sólo se miraba `invoices`).
INSERT INTO audit_findings
SELECT '24', 'facturacion', 'Cobros que exceden el total de la factura',
       COUNT(*), LEFT(GROUP_CONCAT(v ORDER BY v), 500)
FROM (
  SELECT CONCAT('invoices:', i.invoice_number) AS v
  FROM invoices i JOIN invoice_payments p ON p.invoice_id = i.id
  GROUP BY i.id, i.invoice_number, i.total_amount
  HAVING SUM(p.amount) > i.total_amount + 0.01
  UNION ALL
  SELECT CONCAT('catalog_invoices:', ci.invoice_number)
  FROM catalog_invoices ci JOIN catalog_invoice_payments cp ON cp.catalog_invoice_id = ci.id
  GROUP BY ci.id, ci.invoice_number, ci.total_amount
  HAVING SUM(cp.amount) > ci.total_amount + 0.01
) x;

-- 25. Filas que apuntan a un padre inexistente.
INSERT INTO audit_findings
SELECT '25', 'referencias', 'Filas huerfanas (padre inexistente)',
       SUM(n), LEFT(GROUP_CONCAT(CONCAT(tabla,':',n) ORDER BY tabla), 500)
FROM (
  SELECT 'order_items' AS tabla, COUNT(*) n FROM order_items oi
    LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL
  UNION ALL
  SELECT 'store_order_items', COUNT(*) FROM store_order_items si
    LEFT JOIN store_orders so ON so.id = si.store_order_id WHERE so.id IS NULL
  UNION ALL
  SELECT 'invoice_payments', COUNT(*) FROM invoice_payments ip
    LEFT JOIN invoices i ON i.id = ip.invoice_id WHERE i.id IS NULL
  UNION ALL
  SELECT 'catalog_invoice_payments', COUNT(*) FROM catalog_invoice_payments cp
    LEFT JOIN catalog_invoices ci ON ci.id = cp.catalog_invoice_id WHERE ci.id IS NULL
  UNION ALL
  SELECT 'cash_transactions(cuenta)', COUNT(*) FROM cash_transactions ct
    LEFT JOIN cash_accounts a ON a.id = ct.account_id WHERE a.id IS NULL
  UNION ALL
  SELECT 'catalog_product_sizes(producto)', COUNT(*) FROM catalog_product_sizes s
    LEFT JOIN catalog_products p ON p.id = s.product_id WHERE p.id IS NULL
) x;

-- ════════════════════════════════════════════════════════════════════════════
--  USUARIOS Y FECHAS
-- ════════════════════════════════════════════════════════════════════════════

-- 26. Rol inválido.
INSERT INTO audit_findings
SELECT '26', 'usuarios', 'Usuarios con rol invalido',
       COUNT(*), LEFT(GROUP_CONCAT(id ORDER BY id), 500)
FROM (
  SELECT id FROM users WHERE role NOT IN ('admin','billing','workshop','seller')
) x;

-- 27. Sin administradores activos. Expresado como anomalía (no como conteo),
--     para que valga el mismo criterio "0 = sano" que todo el resto: acá lo
--     grave es que NO haya ninguno.
INSERT INTO audit_findings
SELECT '27', 'usuarios', 'Sistema sin ningun administrador activo',
       CASE WHEN (SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1) = 0 THEN 1 ELSE 0 END,
       CONCAT('admins activos: ', (SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1));

-- 28. Fechas futuras imposibles (1 día de margen para diferencias de zona
--     horaria entre el servidor de aplicación y el de base).
INSERT INTO audit_findings
SELECT '28', 'fechas', 'Registros con fecha futura imposible',
       SUM(n), LEFT(GROUP_CONCAT(CONCAT(tabla,':',n) ORDER BY tabla), 500)
FROM (
  SELECT 'store_orders' AS tabla, COUNT(*) n FROM store_orders WHERE createdAt > NOW() + INTERVAL 1 DAY
  UNION ALL
  SELECT 'cash_transactions', COUNT(*) FROM cash_transactions WHERE date > CURDATE() + INTERVAL 1 DAY
  UNION ALL
  SELECT 'invoices', COUNT(*) FROM invoices WHERE createdAt > NOW() + INTERVAL 1 DAY
) x;

-- ════════════════════════════════════════════════════════════════════════════
--  RESULTADO
-- ════════════════════════════════════════════════════════════════════════════

SELECT id, area, check_name, anomalias, ejemplos
FROM audit_findings
ORDER BY anomalias DESC, id ASC;

SELECT
  COUNT(*)                                   AS checks_corridos,
  SUM(CASE WHEN anomalias > 0 THEN 1 ELSE 0 END) AS checks_con_anomalias,
  SUM(anomalias)                             AS anomalias_totales
FROM audit_findings;

-- Veredicto en una sola línea, pensado para leer de un vistazo o para grepear.
-- `audit_findings` se referencia UNA sola vez a propósito: MySQL no permite
-- abrir dos veces la misma TEMPORARY TABLE en una misma consulta
-- ("Can't reopen table").
SELECT IF(
  SUM(anomalias) > 0,
  CONCAT('INTEGRIDAD FALLA: ', SUM(anomalias), ' anomalias'),
  'INTEGRIDAD OK'
) AS resultado
FROM audit_findings;

DROP TEMPORARY TABLE IF EXISTS audit_findings;
