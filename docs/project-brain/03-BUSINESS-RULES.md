# 03 — Reglas de negocio

> Solo reglas verificadas contra código real o documentación de auditoría existente. Reglas no confirmables se marcan explícitamente `Pendiente de confirmar`. No se inventó ninguna regla.

## Autenticación / sesión

### BR-AUTH-001 — La sesión se invalida por `session_version`, no por blacklist
**Descripción**: cada `User`/`StoreCustomer` tiene un contador `session_version`. Cada JWT lleva ese valor en el payload; en cada request se compara contra el valor actual en DB. Al hacer login, reset de password o (en el caso de tienda) verificaciones específicas, el contador se incrementa, invalidando de golpe todos los tokens emitidos antes — incluso si no expiraron.
**Módulo**: Autenticación (1).
**Fuente**: `backIndians/src/middlewares/auth.ts`, `services/auth.service.ts`, `services/store.auth.service.ts`.
**Consecuencias**: no hay revocación selectiva de un solo dispositivo; revocar siempre invalida todas las sesiones del usuario.
**Excepciones**: ninguna.
**Estado**: Vigente.

### BR-AUTH-002 — El logout no revoca nada del lado servidor
**Descripción**: `POST /auth/logout` es un no-op — responde OK sin invalidar el token. La revocación real depende de que el cliente borre el token, o de un `session_version` incrementado por otra vía.
**Módulo**: Autenticación (1).
**Fuente**: `backIndians/src/controllers/auth.controller.ts` (comentario explícito en el código).
**Consecuencias**: un access token robado sigue siendo válido hasta que expira (máx. 15 min) aunque el usuario haga logout.
**Estado**: Vigente — documentado como limitación conocida, no como bug.

### BR-AUTH-003 — Los tokens de sistema y de tienda no son intercambiables
**Descripción**: el JWT de comprador incluye `type: 'store_customer'`; `verifyStoreToken` rechaza cualquier token sin ese campo, incluso si por configuración `STORE_JWT_SECRET` cayera igual a `JWT_SECRET`.
**Módulo**: Autenticación (1).
**Fuente**: `backIndians/src/services/store.auth.service.ts`.
**Estado**: Vigente.

### BR-AUTH-004 — Google OAuth exige email verificado por Google
**Descripción**: el login social de la tienda solo confía en el email devuelto por Google si `payload.email_verified === true`; si no, se rechaza (previene account-takeover con emails no verificados).
**Módulo**: Autenticación (1) / Tienda (10).
**Fuente**: `backIndians/src/services/store.auth.service.ts`.
**Estado**: Vigente.

---

## Pedidos de fábrica

### BR-ORDER-001 — Un pedido pertenece a un único cliente y tiene ficha técnica por ítem
**Descripción**: `Order` referencia un `Client`; cada `OrderItem` lleva su propia ficha técnica completa (no se comparte entre ítems del mismo pedido).
**Módulo**: Pedidos (3).
**Fuente**: `backIndians/src/models/Order.ts`, `OrderItem.ts`.
**Estado**: Vigente.

### BR-ORDER-002 — Solo `admin` puede eliminar un pedido
**Descripción**: `DELETE /orders/:id` exige rol `admin` exclusivamente (a diferencia de creación/edición, que permite `admin`/`billing`/`seller`).
**Módulo**: Pedidos (3).
**Fuente**: `backIndians/src/routes/order.routes.ts`.
**Estado**: Vigente.

### BR-ORDER-003 — El checklist de un control no admite ítems duplicados
**Descripción**: unique compuesto `(order_id, status, item_key)` en `order_checklist_checks` impide tildar dos veces el mismo ítem para el mismo control del mismo pedido.
**Módulo**: Controles de producción (4).
**Fuente**: migración `20260624-046-production-control-states.js`, modelo `OrderChecklistCheck.ts` (índice también definido a nivel de modelo — ver riesgo de duplicación de índice en [05-DATABASE.md](05-DATABASE.md)).
**Estado**: Vigente.

### BR-ORDER-005 — El checklist de un control es un registro, no un requisito para avanzar
**Descripción**: hasta el 2026-08-10, `updateOrder` (`order.service.ts`) exigía tildar el 100% de los ítems del checklist del control actual para avanzar al siguiente (error 400 `CHECKLIST_INCOMPLETE`). Se sacó ese bloqueo a pedido del cliente: hay ítems que no aplican según la prenda (ej. "Insumos: cierres" en una remera sin cierres), y obligaba a tildar en falso o a no poder avanzar. El checklist se puede seguir tildando ítem por ítem (queda registrado quién y cuándo, vía `OrderChecklistCheck`), pero ya no bloquea la transición de estado. Aplica a los 6 controles (`CONTROL_SEQUENCE` en `orderChecklists.ts`).
**Módulo**: Controles de producción (4).
**Fuente**: `backIndians/src/services/order.service.ts` (`updateOrder`), `backIndians/src/config/orderChecklists.ts`.
**Estado**: Vigente desde 2026-08-11.

### BR-ORDER-004 — El vendedor opera con ficha técnica reducida
**Descripción**: cuando el creador es rol `seller`, el frontend muestra un formulario restringido (tipo de prenda + talles + personalización), sin exponer precio ni campos técnicos completos.
**Módulo**: Pedidos (3).
**Fuente**: memoria previa `project-seller-order-flow.md`; **pendiente de re-confirmar contra el código actual de `OrderItemForm.tsx`** en esta sesión (no se leyó línea por línea el modo `restricted`).
**Estado**: Pendiente de confirmar (alta confianza, no verificado en esta auditoría puntual).

---

## Stock

### BR-STOCK-001 — Stock de insumos y stock de catálogo son sistemas separados
**Descripción**: `StockItem`/`StockMovement` (materia prima, para pedidos de fábrica) es un dominio distinto de `CatalogProduct.stock_quantity`/`CatalogStockMovement` (productos terminados de catálogo/tienda). No hay conversión automática entre ambos.
**Módulo**: Stock (5) / Catálogo (9) / Tienda (10).
**Fuente**: modelos `StockItem.ts` vs `CatalogProduct.ts`, `CatalogStockMovement.ts`.
**Estado**: Vigente.

### BR-STOCK-002 — El stock disponible de catálogo es `stock_quantity - stock_reserved`
**Descripción**: cada `CatalogProduct`/`CatalogProductSize` tiene una cantidad física y una cantidad reservada; el disponible para nueva venta es la resta. La UI pública de la tienda, según la auditoría de avance, todavía muestra la cantidad física en algunos puntos (deuda técnica, no bug de backend) — ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md).
**Módulo**: Tienda (10) / Catálogo (9).
**Fuente**: migraciones 079-080, `services/stockLedger.service.ts`.
**Estado**: Vigente (backend); UI parcial.

### BR-STOCK-003 — Todo movimiento de stock de catálogo queda auditado en el ledger
**Descripción**: cualquier cambio de `CatalogProduct.stock_quantity`/`stock_reserved` debería generar un `CatalogStockMovement` con `type` (`sale`/`return`/`cancel`/`adjustment`/`in`/`out`/`transfer`/`reserve`/`release`) y `source` (`store`/`catalog`/`manual`/`system`).
**Módulo**: Catálogo (9) / Tienda (10).
**Fuente**: modelo `CatalogStockMovement.ts`, `services/stockLedger.service.ts`.
**Excepción conocida**: `saveProductSizes` (editor de talles desde el panel admin) **no pasa por el ledger** — exclusión consciente documentada en la auditoría (tareas 1.2 y 2.1 de `AUDITORIA_TIENDA_ONLINE_AVANCE.md`), no un olvido.
**Estado**: Vigente, con excepción documentada.

### BR-STOCK-004 — La reserva de stock de un pedido de tienda vence
**Descripción**: al hacer checkout, el stock se reserva (no se resta aún) con una marca `stock_reserved_at`; si el pedido no se confirma (pago) en el plazo definido, expira automáticamente vía job programado y el stock se libera.
**Módulo**: Tienda (10).
**Fuente**: migración `20260804-081-store-orders-stock-reservation-columns.js`, commit `02a969c` (2.1), `backIndians/src/jobs/` (job de expiración, commit `c140540`, 2.2).
**Estado**: Vigente.

---

## Facturación (interna) y AFIP

### BR-INVOICE-001 — Solo `admin`/`billing` pueden editar facturas o registrar pagos
**Descripción**: `PUT /invoices/:id` y `POST /invoices/:id/payments` exigen `authorize('admin','billing')`; la lectura está abierta a cualquier rol autenticado.
**Módulo**: Facturación (6).
**Fuente**: `backIndians/src/routes/invoice.routes.ts`.
**Estado**: Vigente.

### BR-AFIP-001 — El envío a AFIP está bloqueado a nivel de servidor si `afip_enabled != 'true'`
**Descripción**: `assertAfipEnabled()` corta antes de cualquier llamado real a WSAA/WSFEv1 si el setting no está en `'true'`. Es un fix explícito: antes, el toggle de UI no bloqueaba nada del lado servidor (hallazgo de la propia auditoría, corregido en el commit `d49ff4d`).
**Módulo**: AFIP (12).
**Fuente**: `backIndians/src/services/afip.service.ts`.
**Consecuencias**: sin este setting en `'true'` y sin certificado real cargado, ningún endpoint de AFIP puede emitir un comprobante real, sin importar lo que muestre la UI.
**Estado**: Vigente.

### BR-AFIP-002 — El envío a AFIP es siempre manual, nunca automático
**Descripción**: ni facturas de fábrica, ni de catálogo, ni pedidos de tienda se envían a AFIP automáticamente al pagarse/facturarse — requiere acción explícita de `admin`/`billing` desde la UI (`AfipButton`).
**Módulo**: AFIP (12).
**Fuente**: rutas `afip.routes.ts` (todas `POST` disparadas por acción de usuario, no hay ningún job/hook que las llame), confirmado también en `AUDITORIA_TIENDA_ONLINE_AVANCE.md` sección 2.5.
**Estado**: Vigente — decisión de negocio explícita, no limitación técnica.

### BR-INVOICE-002 — El "comprobante" de tienda no es una factura fiscal válida por sí solo
**Descripción**: el PDF que se genera para pedidos de tienda (`generateInvoicePdf` en `store.pdf.ts`) es un comprobante comercial sin CAE; se renombró explícitamente de "factura" a "comprobante de compra" en la UI y en el código para no inducir a error, salvo que además se haya enviado a AFIP y tenga CAE real.
**Módulo**: Tienda (10) / AFIP (12).
**Fuente**: commits `35ae47d` (backend) y `0819968` (frontend), hallazgo C-4 de `AUDITORIA_TIENDA_ONLINE_DIAGNOSTICO.md`.
**Estado**: Vigente.

### BR-CATALOG-001 — Un pago de MercadoPago aprobado se acredita solo en la factura de catálogo
**Descripción**: cuando MercadoPago informa un pago `approved` de una venta de catálogo (por webhook o por el job de reconciliación), el sistema registra un `CatalogInvoicePayment` con `payment_method='mercadopago'`, actualiza `payment_amount` de la factura, la pasa a `paid` si quedó saldada y genera el asiento de caja (BR-CASH-016). Es idempotente por `idempotency_key = mp-<paymentId>`, así que el webhook y el job pueden aplicar el mismo pago sin duplicarlo. Un pago **parcial** (pedido con `payment_type='half'` o monto personalizado en el QR) es un caso normal: se registra y la factura queda `issued` con saldo. Un pago aprobado que **no se puede imputar** (factura anulada, moneda distinta de ARS) no se acredita a ciegas: se loguea como error y dispara `sendAlert`.
**Módulo**: Catálogo mayorista (7) / Caja (9).
**Fuente**: `catalog.service.ts` (`applyCatalogPaymentResult`, `handleMPWebhook`, `confirmCatalogPayment`, `refreshCatalogPayment`), `jobs/reconcileCatalogPayments.ts`, `DEC-020`. Hay **tres** caminos que llegan a `applyCatalogPaymentResult`: el webhook, el job cada 10 min y el refresco a demanda del panel (`POST /catalog/orders/:id/payment/refresh`, agregado el 2026-08-21). Los tres son el mismo código y la misma idempotencia.
**Estado**: Vigente desde 2026-08-19. Antes de esa fecha el webhook sólo estampaba `mp_payment_status` en el pedido, y ni siquiera lo llamaban (la preference iba sin `notification_url`).

---

### BR-CATALOG-002 — En las métricas de catálogo, facturado y cobrado son magnitudes distintas
**Descripción**: la "Facturación catálogo" del dashboard es `SUM(catalog_invoices.total_amount)` de las facturas `issued`/`paid` del período (por `issue_date`) — una factura emitida suma aunque todavía no se haya cobrado, igual que en fábrica. Lo "Cobrado" sale de las filas de `catalog_invoice_payments` (por `paid_at`) y se desglosa por medio de pago. El "Pendiente de cobro" es el saldo `total_amount − payment_amount` de las facturas no anuladas. `catalog_orders.mp_payment_status` **no** es fuente de ninguna métrica de dinero.
**Módulo**: Catálogo mayorista (7) / Dashboard.
**Fuente**: `dashboard.service.ts` (bloque "Catálogo: queries paralelas", `getSellerPerformance`), `DEC-019`.
**Estado**: Vigente desde 2026-08-19. Antes, las seis métricas sumaban `payment_amount`, que sólo se llena al registrar un cobro explícito — una venta cobrada mostraba $0 facturado.

---

## Costos de prendas

### BR-COST-001 — El nombre de un tipo de prenda es único por cliente, no globalmente
**Descripción**: `garment_types` tiene unique compuesto `(client_id, name)` (migración 065), reemplazando un unique global anterior sobre `name` (migración 064 lo eliminó). Dos clientes distintos pueden tener un tipo de prenda con el mismo nombre.
**Módulo**: Costos (8).
**Fuente**: migraciones `20260724-064` y `-065`, commit `4c8e336`/`c452f22`.
**Estado**: Vigente.

### BR-COST-002 — El costo de un pedido queda congelado al momento de crearlo (snapshot)
**Descripción**: `OrderCostDetail` copia el costo vigente (`garment_type_name`, `unit_cost`, etc.) al crear el pedido; si luego se edita la hoja de costos (`GarmentCost`), los pedidos ya creados no cambian su costo histórico.
**Módulo**: Costos (8) / Pedidos (3).
**Fuente**: migración `20260724-062-create-order-cost-details.js`.
**Estado**: Vigente.

---

## Caja

### BR-CASH-001 — Las categorías de sistema no son editables desde el panel
**Descripción**: `CashTransactionCategory.is_system = true` marca categorías creadas por el sistema (ej. "Ventas tienda online", sembrada en migración 085) como no editables/borrables desde la UI de administración.
**Módulo**: Caja (7).
**Fuente**: migración `20260605-018-create-cash-flow.js` (campo `is_system`), migración `20260804-085-seed-store-cash-category.js`.
**Estado**: Vigente.

### BR-CASH-002 — El registro automático de caja al confirmarse un pago de tienda requiere configuración manual previa
**Descripción**: existe el mecanismo (`cash_recorded_at`, categoría de sistema), pero necesita que `admin` configure qué `CashAccount` usar (setting `store_cash_account_id`). Sin esa configuración, el job de reporte de inconsistencias sigue marcando pedidos pagados sin registro en caja.
**Módulo**: Caja (7) / Tienda (10).
**Fuente**: `AUDITORIA_TIENDA_ONLINE_AVANCE.md` (sección de acciones pendientes del usuario).
**Estado**: Vigente — acción de configuración pendiente, no de código.

### BR-CASH-003 — Los movimientos de caja confirmados no se editan ni se eliminan: se revierten
**Descripción**: hasta el 2026-08-06, `updateTransaction`/`deleteTransaction` (`cash.service.ts`) permitían cambiar monto/cuenta/fecha o borrar cualquier `CashTransaction` sin motivo ni rastro del valor anterior (hallazgo CASH-MUT-001 de la auditoría, confirmado por prueba real). **Corregido en la Fase 2 del plan de corrección**: `PUT`/`DELETE` de `/cash/transactions/:id` fueron eliminados de la API. La única vía de corrección es `POST /cash/transactions/:id/reverse` (motivo obligatorio ≥10 caracteres), que crea un contraasiento de tipo/cuenta invertidos y deja el original intacto en sus campos financieros — solo se le marca `status='reversed'` cuando queda completamente cubierto (soporta reversión parcial, para devoluciones no totales). `PATCH /cash/transactions/:id` permite editar únicamente `description`/`notes`/`category_id`, nunca campos financieros, aunque el body los traiga.
**Módulo**: Caja (7).
**Fuente**: migración `20260806-091-cash-transactions-reversal.js`, `cash.service.ts` (`reverseTransaction`, `patchTransaction`), `backIndians/documentos/PLAN_CORRECCION_CAJA_2026-08-06.md` (Fase 2).
**Estado**: Corregida (backend + frontend), validada con 13 tests nuevos (`cash-reversal.test.ts`) y prueba manual en navegador. No repetir el patrón de mutación in-place de movimientos financieros confirmados en código nuevo — cualquier corrección de importe pasa por `reverseTransaction`.

### BR-CASH-004 — El ingreso de caja por pago de tienda usa la cuenta que corresponde al medio de pago
**Descripción**: hasta el 2026-08-06, `recordStoreOrderCashIncome` (`store.service.ts`) registraba el `total_amount` completo como ingreso sin condicionar por `payment_method`, mezclando MercadoPago/transferencia con efectivo real en la misma cuenta (hallazgo CASH-PAY-002, confirmado por prueba). **Corregido en la Fase 3 del plan de corrección**: la función (renombrada `recordStoreOrderIncome`) elige la cuenta según `payment_method` — `cash` → setting `store_cash_account_id` (una cuenta `type:'cash'`); `mercadopago`/`bank_transfer` → setting `store_bank_account_id` (una cuenta `type:'bank'`). `updateSettings` (`settings.service.ts`) **rechaza** con 400 cualquier intento de configurar una cuenta del tipo incorrecto en cualquiera de los dos settings — no es solo una advertencia. Si la cuenta que corresponde no está configurada, el pago se confirma igual (no se bloquea la venta) y solo se loguea un warning con el `settingKey` faltante.
**Módulo**: Caja (7) / Tienda (10).
**Fuente**: `store.service.ts` (`recordStoreOrderIncome`, `cashSettingKeyFor`), `settings.service.ts` (`ACCOUNT_SETTING_TYPE`), `backIndians/documentos/PLAN_CORRECCION_CAJA_2026-08-06.md` (Fase 3).
**Estado**: Corregida, validada con 6 tests (`store-cash-income.test.ts`, incluye el caso que antes fallaba: MercadoPago ya no toca la cuenta `cash`) y prueba manual en navegador (los dos selectores de `EcommerceSettingsPage` filtran por tipo de cuenta).

### BR-CASH-005 — Cancelar un pedido pagado o registrar una devolución revierte el ingreso de caja ya registrado, por el monto correspondiente
**Descripción**: hasta el 2026-08-06, al cancelar un pedido de tienda se liberaba stock y cupón (`restoreStoreOrderStock`) pero no se tocaba el asiento de caja creado al confirmarse el pago; `storeReturns.service.ts` no tenía ninguna referencia a caja — el saldo quedaba sobrestimado indefinidamente (hallazgo CASH-SALE-002). **Corregido en la Fase 4 del plan de corrección**: la rama `newStatus === 'cancelled'` de `recordStoreOrderStatusChange` (`store.service.ts`) revierte el ingreso por el **total remanente** (reutiliza `reverseTransaction` de la Fase 2, vía `reverseSystemTransaction`); `updateStoreReturnRefund` (`storeReturns.service.ts`), al pasar `refund_status` a `'refunded'`, revierte por **`refunded_amount`** (no por el total — la devolución puede ser parcial). Idempotencia con **dos columnas separadas**, no una: `store_orders.cash_reversed_at` (cancelación total) y `store_returns.cash_reversed_at` (cada devolución) — una sola marca en `store_orders` haría que la segunda devolución parcial sobre el mismo pedido se saltee en silencio. `refunded_amount` pasa a ser obligatorio (400) cuando se marca `refund_status: 'refunded'`.
**Módulo**: Caja (7) / Tienda (10).
**Fuente**: migración `20260806-092-cash-reversal-marks.js`, `cash.service.ts` (`reverseTransactionCore`, `reverseSystemTransaction`), `store.service.ts` (`reverseStoreOrderCashIncome`), `storeReturns.service.ts` (`updateStoreReturnRefund`), `backIndians/documentos/PLAN_CORRECCION_CAJA_2026-08-06.md` (Fase 4).
**Estado**: Corregida, validada con 7 tests nuevos (`cash-reversal-automatic.test.ts`: cancelación total, reintento idempotente, cancelación sin pago previo, devolución parcial, dos devoluciones parciales sobre el mismo pedido, reintegro con reintento idempotente, monto obligatorio) y prueba manual en navegador con datos reales.

### BR-CASH-006 — Revertir un movimiento de caja confirmado está reservado a `admin`; `billing` puede crear y corregir campos no financieros, pero no revertir
**Descripción**: hasta el 2026-08-06, todo el router de `/cash` distinguía un único nivel de permiso (`admin`+`billing` para casi todo, `admin` solo para `GET /audit`) — `billing` podía revertir cualquier movimiento sin distinción de sensibilidad (hallazgo CASH-SEC-002 de la auditoría, "Autorización granular por acción... NO CUMPLE"). **Corregido en la Fase 6 del plan de corrección**, decisión de negocio confirmada con el usuario: `POST /cash/transactions/:id/reverse` ahora exige `authorize('admin')` además del `admin`/`billing` del router. `billing` conserva `POST /cash/transactions` (alta) y `PATCH /cash/transactions/:id` (descripción/notas/categoría) sin cambios. El frontend (`CashFlowPage.tsx`) oculta el formulario de reversión (`canReverse`) para cualquier rol que no sea `admin`.
**Módulo**: Caja (7).
**Fuente**: `cash.routes.ts` (`POST /transactions/:id/reverse`), `CashFlowPage.tsx` (`canReverse`), `backIndians/documentos/PLAN_CORRECCION_CAJA_2026-08-06.md` (Fase 6).
**Estado**: Corregida, validada con test nuevo en `cash-reversal.test.ts` (billing recibe 403 al intentar revertir, sigue pudiendo crear/patchear; admin sí puede) y prueba manual en navegador (el modal de detalle para `billing` ya no muestra la sección de reversión).

### BR-CASH-007 — Una cuenta desactivada no admite movimientos nuevos, pero conserva su saldo y sigue visible si lo tiene
**Descripción**: hasta el 2026-08-07, `createTransactionCore` solo validaba que la cuenta **existiera**, así que el "Desactivar" del panel no impedía nada: se seguían cargando movimientos contra cuentas dadas de baja. Y como `getSummary` filtraba por `active: true`, al desactivar una cuenta con saldo ese dinero **desaparecía del "Saldo total"** aunque siguiera en la base — juntos permitían mover plata a una cuenta invisible en el panel (hallazgo `CASH-VAL-004`). **Corregido**: el alta rechaza con 400 las cuentas inactivas, tanto la de origen como la de destino de una transferencia; y el resumen incluye las cuentas inactivas **con saldo distinto de cero**, marcadas con `active: false` para que la UI las distinga. **Las reversiones quedan exentas a propósito**: un movimiento siempre se tiene que poder corregir aunque su cuenta se haya dado de baja después. El registro automático de ingresos de tienda (`recordStoreOrderIncome`) chequea la cuenta antes de crear el asiento y sigue de largo con un warning si no sirve, para no bloquear el cobro.
**Módulo**: Caja (7).
**Fuente**: `cash.service.ts` (`createTransactionCore`, `getSummary`), `store.service.ts` (`recordStoreOrderIncome`), `backIndians/documentos/AUDITORIA_FLUJO_CAJA_VERIFICACION_2026-08-07.md`.
**Estado**: Corregida, validada con 8 tests (`cash-validation-reporting.test.ts`) y re-sondeo adversarial contra el servidor vivo.

### BR-CASH-008 — El registro de una devolución nunca lo puede vetar la caja
**Descripción**: la Fase 4 conectó `refund_status: 'refunded'` a la reversión automática del asiento de caja, pero sin prever los casos en que la caja no puede absorber el monto — un reintegro de $0, mayor al total del pedido, o una segunda devolución cuya suma excede lo cobrado devolvían **400 y no dejaban registrar la devolución** (hallazgo `CASH-REF-003`). El operador ya había devuelto la plata por fuera del sistema y el registro quedaba divergido de la realidad. **Corregido**: `reverseStoreOrderCashIncome` es best-effort — acota el monto al remanente reversible y devuelve `{ reversed, applied, shortfall }`; nunca lanza por "no puedo absorber esto". El registro de la devolución **siempre** se persiste, y el desvío se loguea (`storeReturns.refund.cashShortfall`) para conciliación. Mismo criterio que ya usaba `recordStoreOrderIncome`, que no bloquea el cobro si falta configurar la cuenta.
**Módulo**: Caja (7) / Tienda (10) / Devoluciones (11).
**Fuente**: `store.service.ts` (`reverseStoreOrderCashIncome`, `CashReversalOutcome`), `storeReturns.service.ts` (`updateStoreReturnRefund`).
**Estado**: Corregida, validada con 3 tests de casos borde en `cash-reversal-automatic.test.ts`. **Principio general a respetar en código nuevo: una regla contable interna no puede impedir registrar un hecho de negocio ya consumado.**

### BR-CASH-009 — `by_category` del resumen es un NETO de egresos, no una suma bruta
**Descripción**: `getSummary` calculaba `by_category` con `SUM(amount)` sin distinguir signo, así que ingresos y egresos de la misma categoría se **sumaban** en vez de netearse. Como toda reversión crea un contraasiento en la **misma categoría**, revertir un movimiento **duplicaba** su valor en el gráfico "Egresos por categoría" en lugar de anularlo (hallazgo `CASH-RPT-001`: $7.000 revertidos se mostraban como $14.000 de egresos inexistentes). **Corregido**: `SUM(CASE WHEN type = 'income' THEN -amount ELSE amount END)`. Un movimiento revertido da 0. El frontend además filtra `total > 0` en el gráfico.
**Módulo**: Caja (7).
**Fuente**: `cash.service.ts` (`getSummary`), `CashFlowPage.tsx` (`expenseCategories`).
**Estado**: Corregida y validada con tests. Ver [BR-CASH-013](#br-cash-013--total_income-y-total_expense-del-resumen-son-neto-de-reversiones-compensando-por-signo) para el cierre del pendiente relacionado (`CASH-RPT-002`).

### BR-CASH-013 — `total_income` y `total_expense` del resumen son neto de reversiones, compensando por signo
**Descripción**: `getSummary` sumaba `amount` de todo lo que tuviera `type='income'`/`'expense'` sin distinguir el original del contraasiento — y como una reversión de un ingreso se crea como movimiento `expense` (y viceversa), un ingreso de $5.000 revertido inflaba +$5.000 a ingresos **y** +$5.000 a egresos, aunque `net_balance` diera bien por cancelarse entre sí (hallazgo `CASH-RPT-002`). El resumen quedaba internamente inconsistente: `by_category` ya neteaba desde `BR-CASH-009`, los totales del período no. **Decisión de producto (`DEC-013`, 2026-08-07): neto, compensando por signo, no excluyendo filas.** Se restó el contraasiento en vez de excluir la fila (`reversal_of_id IS NOT NULL`) a propósito: en una reversión **parcial**, excluir la fila entera haría desaparecer el movimiento completo del reporte en vez de dejarlo en su remanente vigente (ej. $1.000 revertido en $400 → debe quedar $600, no $0). El mismo criterio se aplicó a `daily_evolution`, día por día — el contraasiento se fecha en el día en que se hizo la corrección (`businessDate()`), no en el día del original, así que una reversión en otra jornada muestra la corrección ese día, no reescribe retroactivamente el día original (igual que un libro contable real). `by_category` ya cumplía este criterio sin necesitar `reversal_of_id`: como una reversión siempre se crea con el tipo opuesto al original, sumar por tipo con signo ya compensa el contraasiento automáticamente.
**Módulo**: Caja (7).
**Fuente**: `cash.service.ts` (`getSummary`), `CashFlowPage.tsx` (tooltip "Neto de reversiones" en las tarjetas de Ingresos/Egresos del período).
**Estado**: Corregida, validada con 4 tests nuevos en `cash-validation-reporting.test.ts` — el decisivo es el de reversión parcial ($1.000 revertido en $400 → $600 en totales y en la evolución diaria), que es el único caso que distingue este criterio de "excluir filas revertidas".

### BR-CASH-010 — El saldo de una cuenta solo se mueve por asientos: nunca se escribe directo
**Descripción**: `current_balance` es un valor **derivado** del libro de movimientos y solo lo tocan `applyBalanceEffect`/`revertBalanceEffect` dentro de una transacción. Hasta el 2026-08-07, `updateAccount` hacía `acc.update(req.body)` con el body crudo: `express-validator` valida los campos declarados pero **no descarta los demás**, así que un `PUT /cash/accounts/:id {"current_balance": 999999}` reescribía el saldo directamente, sin asiento y sin pasar por el libro — el mismo agujero que la Fase 2 había cerrado del lado de las transacciones, abierto por el lado de las cuentas (hallazgo `CASH-MA-001`, CRÍTICO). Lo mismo con `{"active": false}` (esquivaba el `/toggle`) y, en categorías, con `{"is_system": true}` (convertía una categoría común en categoría del sistema, inmodificable para siempre). **Corregido**: ambos servicios arman el patch campo por campo. **Una sobreescritura de saldo es irreparable desde la API** —cualquier asiento nuevo mueve saldo y libro por igual, así que la divergencia no se puede cerrar—; por eso `scripts/cash-integrity-check.ts` recalcula el saldo de cada cuenta desde su libro y falla si no cuadran.
**Módulo**: Caja (7).
**Fuente**: `cash.service.ts` (`updateAccount`, `updateCategory`), `scripts/cash-integrity-check.ts`.
**Estado**: Corregida, validada con 4 tests en `cash-integrity-hardening.test.ts` y re-sondeo adversarial. **Patrón a no repetir en código nuevo: nunca `instance.update(req.body)` — siempre whitelist campo por campo** (el mismo patrón vive todavía en `client.service.ts`, `master.service.ts`, `product.service.ts` y `stock.service.ts`, fuera del alcance de caja).

### BR-CASH-011 — Un movimiento cerrado no se modifica, y la categoría se valida contra el tipo
**Descripción**: dos reglas que faltaban en el backend. (a) `patchTransaction` no miraba el `status`: un movimiento ya revertido por completo —registro histórico cerrado— y hasta el propio contraasiento seguían aceptando cambios de `category_id`, lo que **reescribe retroactivamente los reportes** (el original y su contraasiento dejan de cancelarse en `by_category`); ahora ambos devuelven 400, mientras que un movimiento con reversión **parcial** sigue siendo editable porque no está cerrado (hallazgo `CASH-MUT-003`). (b) `createTransactionCore` no validaba la categoría en absoluto: aceptaba categorías desactivadas, inexistentes (500 por FK) y de tipo incompatible con el movimiento; ahora `assertCategoryUsable` exige que exista, esté activa y que su tipo sea `both` o coincida con el del movimiento (`transfer` acepta cualquiera, igual que el formulario del panel) — hallazgo `CASH-VAL-005`. Las reversiones quedan exentas a propósito: el contraasiento es del tipo **opuesto** al original y reusa su misma categoría.
**Módulo**: Caja (7).
**Fuente**: `cash.service.ts` (`patchTransaction`, `assertCategoryUsable`), `CashFlowPage.tsx` (modal de detalle).
**Estado**: Corregida, validada con 7 tests en `cash-integrity-hardening.test.ts`.

### BR-CASH-012 — Los asientos automáticos se fechan en la jornada del negocio, no en UTC
**Descripción**: el ingreso de un pedido de tienda y el contraasiento de una reversión tomaban la fecha de `new Date().toISOString().slice(0, 10)`, que es la fecha **UTC**. Tucumán es UTC−3, así que todo lo registrado entre las 21:00 y la medianoche local quedaba fechado **al día siguiente**: el movimiento caía en la jornada equivocada y descuadraba el resumen diario, la evolución por fecha y cualquier corte por período. **Corregido**: `businessDate()` (en `utils/helpers.ts`) formatea en `America/Argentina/Tucuman` y no depende de la zona horaria del proceso (Railway corre en UTC, las máquinas de desarrollo no).
**Módulo**: Caja (7) / Tienda (10).
**Fuente**: `utils/helpers.ts` (`businessDate`, `BUSINESS_TIMEZONE`), `cash.service.ts` (`reverseTransactionCore`), `store.service.ts` (`recordStoreOrderIncome`).
**Estado**: Corregida, validada con 7 tests de instantes fijos en `src/__tests__/unit/businessDate.test.ts` (con la hora del reloj el test pasaría el 90% del día aun con el defecto vivo).

### BR-CASH-016 — Cobrar una factura (fábrica o catálogo) asienta automáticamente en caja
**Descripción**: hasta el 2026-08-07, `addPaymentToInvoice`/`addPaymentToCatalogInvoice` registraban el cobro (`InvoicePayment`/`CatalogInvoicePayment`) sin ninguna referencia a caja — la conciliación era 100% manual (hallazgo `CASH-INV-001`, bloqueante de producción). **Decisión de negocio (`DEC-012`, 2026-08-07): automatizar, a las mismas cuentas que ya usa la tienda** (`store_cash_account_id`/`store_bank_account_id` — no hay cajas separadas por origen del ingreso). El medio de pago ahora se captura en el propio cobro (`payment_method`, mismo vocabulario que `store_orders.payment_method`) y determina la cuenta destino vía `cashSettingKeyFor` (`cash.service.ts`, antes privada de `store.service.ts`, ahora compartida). Cada cobro genera su propio asiento (`reference_type='invoice'` para fábrica, `'catalog_invoice'` para catálogo — este último nuevo en el ENUM), a diferencia de un pedido de tienda que genera uno solo por el total. Best-effort, mismo criterio que `recordStoreOrderIncome` (`BR-CASH-008`): si la cuenta no está configurada o está inactiva, se loguea y se sigue — el cobro nunca queda bloqueado por un problema de caja.

**Los dos circuitos comparten el mismo código de conexión** (`recordInvoiceCollectionCashIncome` en `cash.service.ts`) porque `addPaymentToCatalogInvoice` es una copia funcional de `addPaymentToInvoice` con el mismo defecto original — arreglarlo en uno solo habría dejado la otra mitad del sistema sin cerrar.
**Módulo**: Caja (7) / Facturación (6) / Catálogo (9).
**Fuente**: `cash.service.ts` (`recordInvoiceCollectionCashIncome`, `cashSettingKeyFor`, `INVOICE_COLLECTIONS_CASH_CATEGORY_NAME`), `invoice.service.ts` (`addPaymentToInvoice`), `catalog.service.ts` (`addPaymentToCatalogInvoice`), migraciones `093`-`095`.
**Estado**: Corregida, validada con 13 tests en `invoice-collections-cash.test.ts` (ambos circuitos, medios de pago, cuenta sin configurar).

### BR-CASH-017 — Un cobro de factura es transaccional e idempotente
**Descripción**: `addPaymentToInvoice`/`addPaymentToCatalogInvoice` hacían `create` + `findAll` + `update` de la factura **fuera de toda transacción y sin ninguna clave de idempotencia** (hallazgo `CASH-INV-002`). Dos cobranzas concurrentes sobre la misma factura podían dejar `payment_amount` subvaluado (lost update) y la factura sin pasar a `paid` aunque estuviera cobrada por completo; un doble clic generaba dos pagos. **Corregido**: `LOCK.UPDATE` sobre la factura dentro de la misma transacción que crea el pago y el asiento (mismo patrón que `createTransactionCore`); `idempotency_key` opcional con índice único en `invoice_payments`/`catalog_invoice_payments` (mismo patrón que `cash_transactions.idempotency_key`, migración `091` — **sin `unique: true` en el modelo**, solo en la migración, para no duplicar el índice bajo `sync()`).
**Módulo**: Caja (7) / Facturación (6) / Catálogo (9).
**Fuente**: `invoice.service.ts`, `catalog.service.ts`, migraciones `093`/`094`.
**Estado**: Corregida, validada con tests de concurrencia real (`Promise.all`) y de reintento con la misma `Idempotency-Key`.

### BR-CASH-018 — Anular una factura con cobros ya asentados revierte todos sus ingresos de caja
**Descripción**: una factura de fábrica o catálogo puede tener **varios cobros parciales**, cada uno con su propio asiento — a diferencia de un pedido de tienda, que genera como máximo uno. `reverseAllForReference` (`cash.service.ts`, nueva) busca y revierte TODOS los asientos activos o con remanente asociados a una referencia, no solo el primero. Se dispara al anular una factura (`updateInvoice` con `status: 'cancelled'`, o `updateCatalogInvoiceStatus` con el mismo status) dentro de la MISMA transacción del cambio de estado. Best-effort (mismo criterio que `CASH-REF-003`/`reverseStoreOrderCashIncome`): nunca bloquea la anulación por un problema de caja. Naturalmente idempotente: como solo busca movimientos con `status='active'` y remanente > 0, una segunda anulación (o un reintento) no encuentra nada que revertir y no hace nada — verificado con test explícito en el circuito de catálogo (`updateCatalogInvoiceStatus`, que a diferencia de `updateInvoice` no tenía guard previo contra re-anular).

**Alcance deliberadamente acotado**: la reversión solo cubre la transición HACIA `'cancelled'`. Un cambio manual de `'paid'` a `'issued'`/`'draft'` sin pasar por `'cancelled'` no revierte caja — es edición administrativa, no tratada como anulación. No es un caso cubierto ni se está decidiendo una regla nueva sobre él acá.
**Módulo**: Caja (7) / Facturación (6) / Catálogo (9).
**Fuente**: `cash.service.ts` (`reverseAllForReference`), `invoice.service.ts` (`updateInvoice`), `catalog.service.ts` (`updateCatalogInvoiceStatus`).
**Estado**: Corregida, validada con 4 tests (fábrica, catálogo, sin cobros previos, doble anulación).

---

## Tienda online (Store)

### BR-STORE-001 — El checkout es idempotente
**Descripción**: el frontend envía un header `Idempotency-Key`; el backend persiste `store_orders.idempotency_key` (unique) para que un doble clic o un reintento de red no genere dos pedidos.
**Módulo**: Tienda (10).
**Fuente**: migración `20260804-069-store-orders-idempotency-key.js`, commits `5a44a12`/`04fdc6a`.
**Estado**: Vigente. Ver `BR-INFRA-001` — hasta 2026-08-07 esta idempotencia **no funcionaba en un navegador real**, solo en tests de API.

### BR-LEGAL-001 — Ninguna alta de cuenta ni compra se concreta sin constancia de aceptación
**Descripción**: `POST /store/auth/register` y `POST /store/checkout` exigen `accept_terms` (booleano `true` o la cadena `'true'`); sin él responden 422. Al concretarse, se escribe **una fila por documento** en `legal_acceptances` (T&C y Privacidad) con la versión vigente, fecha, IP y user-agent. En el checkout la constancia se escribe **dentro de la misma transacción** que crea el pedido: no puede existir un pedido sin su constancia. En el alta de cuenta se escribe después de crear el cliente y, si falla, **no voltea el alta** (queda `legal.acceptance.failed` en el log).
**Por qué importa**: el comprador invitado nunca pasa por el registro; si la aceptación se pidiera solo al crear cuenta, la mayoría de las compras quedaría sin respaldo ante un reclamo de Defensa del Consumidor.
**Módulo**: Legales de tienda (11b) / Tienda (10).
**Fuente**: `src/routes/store.routes.ts` (`acceptTermsRule`), `src/services/legal.service.ts`, `src/services/store.service.ts` (`createStoreOrder`), `src/services/store.auth.service.ts`.
**Estado**: Vigente desde 2026-08-19. **Ojo al desplegar**: es un cambio de contrato de API — el frontend viejo contra el backend nuevo no puede comprar. Hay que desplegar backend y frontend juntos.

### BR-LEGAL-002 — La versión del texto aceptado se estampa desde el backend
**Descripción**: la versión vigente de cada documento vive en `backIndians/src/config/legalDocs.ts` y es la que se guarda en `legal_acceptances.version` — el cliente no la elige. Si un texto cambia **de fondo** (qué se cobra, cómo se devuelve, qué datos se tratan), hay que subir `version` y `effective_date` ahí y en el texto del frontend; las correcciones de redacción no suben versión.
**Módulo**: Legales de tienda (11b).
**Fuente**: `src/config/legalDocs.ts`, `GET /api/v1/store/legal`.
**Estado**: Vigente.

### BR-LEGAL-003 — El botón de arrepentimiento no puede exigir ningún trámite previo
**Descripción**: `POST /store/legal/withdrawal` es público: sin login, sin captcha y sin verificación del pedido. El número de pedido es un dato **declarado**: si coincide con uno real se vincula (`store_order_id`), y si no coincide la solicitud se registra igual. La respuesta devuelve en el acto el código `ARR-AAAA-NNNNNN`, que además se manda por mail junto con el aviso interno al negocio.
**Por qué así**: la Resolución 424/2020 (arts. 1 y 2) prohíbe exigir registración previa o cualquier otro trámite, y obliga a informar el código dentro de las 24 h. Un formulario que rechace por "no encontramos ese pedido" incumple.
**Módulo**: Legales de tienda (11b).
**Fuente**: `src/services/legal.service.ts` (`createWithdrawalRequest`), `src/routes/store.routes.ts`, tests `src/__tests__/api/legal.test.ts`.
**Estado**: Vigente.

### BR-LEGAL-004 — El derecho de revocación no aplica a prendas personalizadas
**Descripción**: los 10 días corridos de arrepentimiento (art. 34 Ley 24.240, arts. 1110/1111 CCyCN) **no** se aplican a productos confeccionados según especificaciones del comprador o claramente personalizados (nombre, número, escudo, diseño a pedido), conforme al art. 1116 CCyCN. Esa excepción está informada en los T&C, en la página del botón de arrepentimiento y en el aviso destacado del checkout. La excepción **no** alcanza a la garantía legal por defectos de fabricación.
**Módulo**: Legales de tienda (11b).
**Fuente**: `frontIndians/src/pages/store/legal/TermsPage.tsx` (sección 10), `WithdrawalPage.tsx`.
**Estado**: Vigente. Es una regla de negocio con efecto real: define qué devoluciones se pueden rechazar.

### BR-INFRA-001 — El header `Idempotency-Key` tiene que estar en `allowedHeaders` del CORS
**Descripción**: cualquier endpoint que espere un header custom (`Idempotency-Key`, o el que sea a futuro) tiene que declararlo en `allowedHeaders` de la config de `cors()` en `app.ts` — si no, el preflight `OPTIONS` del navegador lo rechaza (`Access-Control-Allow-Headers` no lo incluye) y la request real **nunca sale**, sin que el backend vea nada ni loguee nada. Hasta el 2026-08-07, `allowedHeaders` solo tenía `['Content-Type', 'Authorization']`: el checkout de la tienda (`BR-STORE-001`, desde su introducción) y el cobro de facturas recién conectado a caja (`BR-CASH-016`/`017`) enviaban `Idempotency-Key` desde el frontend, pero el navegador bloqueaba silenciosamente la request antes de que llegara al servidor.
**Por qué no se detectó antes**: los tests de API (supertest, tanto backend como los E2E "de API") no pasan por CORS de navegador — `request.post(...)` no dispara un preflight real. Solo un E2E real contra Chromium lo mostró (Fase 3 del plan de GO de caja).
**Módulo**: Infraestructura / transversal (Tienda, Caja, Facturación, Catálogo).
**Fuente**: `backIndians/src/app.ts` (bloque `cors({...})`).
**Estado**: Corregida. **Regla para código nuevo**: cualquier header custom nuevo que un cliente vaya a enviar necesita agregarse acá explícitamente, y verificarse con un E2E real (no alcanza con un test de API) — de lo contrario queda roto en producción sin que ningún test lo note.

### BR-STORE-002 — Un cupón es válido una sola vez por cliente
**Descripción**: la validación de cupón en checkout verifica que el mismo `StoreCustomer` no lo haya usado antes, además del límite global `max_uses`/`used_count`.
**Módulo**: Tienda (10).
**Fuente**: commit `be5124c` (feat 2.8), `backIndians/src/__tests__/api/coupon-per-customer.test.ts`.
**Estado**: Vigente.

### BR-STORE-003 — Cancelar un pedido de tienda restituye stock y libera el cupón usado
**Descripción**: al cancelar (por el cliente o por expiración automática), se revierte la reserva/confirmación de stock (según en qué etapa estaba) y se libera el cupón para que pueda reutilizarse.
**Módulo**: Tienda (10).
**Fuente**: commit `0e40c6c` (1.3), hallazgo crítico C-1 de `AUDITORIA_TIENDA_ONLINE_DIAGNOSTICO.md` (antes NO se restituía — corregido).
**Estado**: Vigente (corregido respecto al estado pre-auditoría).

### BR-STORE-004 — Un pedido impago expira automáticamente a las 48hs
**Descripción**: job programado (`ORDER_EXPIRY_HOURS`, default relacionado a 48hs) cancela pedidos en `pending_payment` que superan el plazo, liberando stock reservado.
**Módulo**: Tienda (10).
**Fuente**: commit `c140540` (2.2), variable de entorno `ORDER_EXPIRY_HOURS`.
**Estado**: Vigente.

### BR-STORE-005 — El total del checkout incluye el costo de envío antes de confirmar el pago
**Descripción**: corrección de un hallazgo (C-6) donde el total mostrado/cobrado no incluía envío; ahora `checkout/quote` devuelve el total real con envío antes de que el cliente confirme.
**Módulo**: Tienda (10).
**Fuente**: commit `98f0f41`/`61c5f58` (1.6).
**Estado**: Vigente (corregido).

### BR-STORE-006 — Los webhooks de pago se procesan una sola vez por evento
**Descripción**: `webhook_events` tiene unique compuesto `(provider, event_id)`; un webhook duplicado (reenvío de MP) no se reprocesa dos veces.
**Módulo**: Tienda (10).
**Fuente**: migración `20260804-072-create-webhook-events.js`, commit `a8b87d9` (1.5).
**Estado**: Vigente.

### BR-STORE-007 — La firma de los webhooks de MercadoPago se valida obligatoriamente en producción
**Descripción**: `verifyWebhookSignature()` valida HMAC-SHA256 del header `x-signature`; en producción, si falta `MP_WEBHOOK_SECRET`, **rechaza todo** (fail-closed); fuera de producción, deja pasar con warning (fail-open) para no bloquear desarrollo local.
**Módulo**: Tienda (10).
**Fuente**: `backIndians/src/services/mercadopago.service.ts`, commit `5ea6ef2` (1.1), hallazgo C-3.
**Estado**: Vigente.

### BR-STORE-009 — El checkout de la tienda no acepta pago en efectivo (desactivación temporal)
**Descripción**: `POST /store/checkout` sólo acepta `mercadopago` y `bank_transfer`; `'cash'` devuelve **422**. La desactivación es temporal y el manejo de `'cash'` sigue vivo en el resto del sistema para los **pedidos históricos**: su asiento sigue yendo a `store_cash_account_id` (nunca a la cuenta bancaria, ver `BR-CASH-...`/`CASH-PAY-002`) y siguen sin expirar automáticamente (`BR-STORE-004` excluye efectivo a propósito: implica pago/retiro en persona, no es un pago online abandonado).
**Módulo**: Tienda (10).
**Fuente**: `backIndians/src/routes/store.routes.ts` (`checkoutValidators`), commit `4714458`; contrato fijado por `src/__tests__/api/store-payment-methods.test.ts`. Decisión [DEC-015](08-DECISIONS.md).
**Cómo revertirla**: primero el validador del backend, después `PAYMENT_OPTIONS` en `frontIndians/src/pages/store/StoreCheckoutPage.tsx`, y actualizar ese test en el mismo cambio. Tocar un solo lado deja la UI y el validador desincronizados sin que nada avise.
**Estado**: Vigente (temporal).

### BR-STORE-010 — La transferencia bancaria no se ofrece ni se acepta sin CBU o alias configurados
**Descripción**: si `bank_transfer_cbu` y `bank_transfer_alias` están ambos vacíos, el checkout **rechaza con 400** un pedido con `payment_method: 'bank_transfer'`, y el frontend no ofrece la opción. Alcanza con uno de los dos: el titular solo no sirve, no se puede transferir a un nombre. Si eso deja **cero** medios de pago disponibles, la tienda avisa que no puede procesar pagos y deshabilita el botón de confirmar. La validación del backend corre **antes** de calcular totales, para no reservar stock de un pedido que se va a rechazar.
**Módulo**: Tienda (10).
**Fuente**: `hasBankTransferConfigured` en `backIndians/src/services/store.service.ts` y su gemelo en `frontIndians/src/pages/store/StoreCheckoutPage.tsx` (los dos predicados tienen que quedar iguales). Hallazgo B-02, decisión [DEC-016](08-DECISIONS.md).
**Estado**: Vigente.

### BR-STORE-011 — El endpoint público de settings sólo devuelve una allowlist explícita
**Descripción**: `GET /store/settings` es público, sin autenticación y cacheado 60s como `public`. Devuelve **sólo** las claves de `PUBLIC_SETTING_KEYS` (`settings.service.ts`), no la tabla entera. Quedan afuera `afip_*`, `store_cash_account_id`, `store_bank_account_id`, `invoice_*`, `company_website` y `company_activity_start`. Siguen públicas —por obligación normativa, no por descuido— las `company_*` que identifican al titular en los textos legales (Res. 104/2005), `store_data_fiscal_url` (RG 4004-E) y `bank_transfer_*` (sin ellas el comprador no puede transferir).
**Módulo**: Tienda (10) / Configuración.
**Fuente**: `backIndians/src/services/settings.service.ts` (`PUBLIC_SETTING_KEYS`), `store.service.ts` (`getPublicStoreSettings`). Hallazgo S-01. Test de regresión: `src/__tests__/api/store-public-settings.test.ts`.
**Por qué es una allowlist y no una lista de exclusiones**: antes hacía `Settings.findAll()` sin `where` y publicaba las 75 claves. El defecto no era el contenido: agregar una clave nueva a `VALID_KEYS` —una credencial de courier, por ejemplo— la publicaba en internet sin que nadie tocara el endpoint.
**Estado**: Vigente.

### BR-STORE-008 — Todos los precios de la tienda son en pesos argentinos (ARS), sin soporte multi-moneda
**Descripción**: la moneda está hardcodeada tanto al mostrar precios como al crear la preferencia de pago de MercadoPago.
**Módulo**: Tienda (10).
**Fuente**: `backIndians/src/services/store.service.ts` (comentario explícito citando esta decisión).
**Estado**: Vigente — decisión de diseño, no limitación accidental.

---

## Devoluciones

### BR-RETURN-001 — Ninguna devolución se resuelve automáticamente
**Descripción**: toda `StoreReturn` nace en `pending_review`; el reintegro de stock y de dinero siempre requiere revisión y decisión explícita de `admin`/`billing`.
**Módulo**: Devoluciones (11).
**Fuente**: `backIndians/src/services/storeReturns.service.ts`, migración 088.
**Estado**: Vigente — decisión de negocio explícita.

### BR-RETURN-002 — Solo los ítems marcados como "resellable" restituyen stock
**Descripción**: `StoreReturnItem.condition` (`resellable`/`not_resellable`) determina si, al aprobar la devolución, esa cantidad vuelve al stock disponible.
**Módulo**: Devoluciones (11).
**Fuente**: modelo `StoreReturnItem.ts`, migración 089.
**Estado**: Vigente.

---

## Reglas pendientes de confirmar (no verificadas en profundidad en esta auditoría)

- **BR-ORDER-PENDING-001**: reglas exactas de qué ocurre cuando un pedido es "observado" en un control de producción (¿vuelve al control anterior? ¿queda un estado paralelo?) — requiere lectura línea por línea de `order.service.ts`.
- **BR-INVOICE-PENDING-001**: si el pago de una factura interna (no de tienda) impacta automáticamente en Caja, o si es siempre manual — no confirmado en esta auditoría.
- **BR-CATALOG-PENDING-001**: reglas exactas de decremento de stock en pedidos de catálogo mayorista (¿reserva igual que la tienda, o descuenta directo?) — no confirmado línea por línea.

## Actualizar este documento cuando…

Se agregue, cambie o derogue una regla de negocio verificable en código. Si una regla deja de cumplirse, moverla a "Histórica" con la fecha y el motivo, no borrarla.
