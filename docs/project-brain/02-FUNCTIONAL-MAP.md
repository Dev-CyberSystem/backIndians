# 02 — Mapa funcional por módulo

> Nivel de implementación reportado por módulo según evidencia real de código (rutas, controllers, services, modelos, tests), no por nombres de archivo o documentación de intención.

## Índice de módulos

1. [Autenticación y sesiones](#1-autenticación-y-sesiones)
2. [Usuarios y clientes](#2-usuarios-y-clientes)
3. [Pedidos de fábrica (Orders)](#3-pedidos-de-fábrica-orders)
4. [Controles de producción / checklist](#4-controles-de-producción--checklist)
5. [Stock de insumos](#5-stock-de-insumos)
6. [Facturación interna (Invoices)](#6-facturación-interna-invoices)
7. [Caja (Cash)](#7-caja-cash)
8. [Costos de prendas](#8-costos-de-prendas)
9. [Catálogo mayorista (Catalog)](#9-catálogo-mayorista-catalog)
10. [Tienda online (Store)](#10-tienda-online-store)
11. [Devoluciones de tienda](#11-devoluciones-de-tienda)
11b. [Legales de la tienda](#11b-legales-de-la-tienda-textos-aceptación-y-arrepentimiento)
11c. [Centro de ayuda de la tienda](#11c-centro-de-ayuda-de-la-tienda)
12. [Facturación electrónica AFIP/ARCA](#12-facturación-electrónica-afipARCA)
13. [Dashboard y analítica](#13-dashboard-y-analítica)
14. [Settings](#14-settings)
15. [Logging](#15-logging)

---

## 1. Autenticación y sesiones

**Objetivo**: dar acceso seguro a dos poblaciones de usuario totalmente separadas (staff interno vs. compradores) sin compartir secretos ni sesiones.

**Usuarios**: todos (staff vía sistema, compradores vía tienda).

**Flujo principal (staff)**: login con email+password → JWT access (15 min) + refresh (7 días) → cada request valida el JWT y revalida `User.active`+`session_version` contra la DB → refresh silencioso desde el frontend cuando expira.

**Flujo principal (tienda)**: registro con verificación de email (o Google OAuth con `email_verified` obligatorio) → login → JWT propio (`type: 'store_customer'` en el payload, para que un token de staff nunca autentique como comprador) → access 15 min / refresh 30 días, con opción "recordarme" que decide si el refresh se persiste.

**Flujos alternativos**: forgot/reset password (ambos sistemas, con token de un solo uso y expiración), reset incrementa `session_version` (revoca sesiones viejas).

**Validaciones/restricciones**: rate limiting en login (10/15min), en forgot-password (5/h); logout es un no-op del lado servidor (ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md)).

**Estados**: no aplica (no hay máquina de estados, es sesión válida/inválida).

**Efectos sobre otros módulos**: todo módulo protegido depende de este.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/middlewares/auth.ts`, `authorize.ts`, `storeAuth.ts`, `services/auth.service.ts`, `services/store.auth.service.ts`.

---

## 2. Usuarios y clientes

**Objetivo**: administrar el staff interno (`User`) y las entidades para las que se fabrica (`Client`, B2B).

**Usuarios**: `admin` (CRUD completo de `User`); `admin`/`billing`/`seller` (lectura/escritura de `Client`, borrado solo `admin`).

**Flujo principal**: alta de usuario interno → mail de bienvenida (Resend/SMTP) → el usuario puede loguearse. Alta de cliente → queda disponible para crear pedidos y asignarle catálogo/costos.

**Validaciones**: password con política validada (`utils/validations.ts` en frontend, regex compartida documentada en `README.md` del backend); `Client.cuit`/`condicion_iva` usados por AFIP.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/user.routes.ts`, `client.routes.ts`.

---

## 3. Pedidos de fábrica (Orders)

**Objetivo**: registrar y seguir un pedido de producción textil desde su creación hasta la entrega, con ficha técnica detallada.

**Usuarios**: `admin`/`billing`/`seller` crean; `workshop` opera el flujo de producción; todos los roles autenticados pueden leer.

**Flujo principal**: crear pedido (cliente + uno o más `OrderItem` con ficha técnica) → estado inicial → avanza por los controles de producción (ver módulo 4) → factura (opcional, ver módulo 6).

**Flujos alternativos**: edición de pedido, carga/borrado de imágenes de referencia, carga de imagen de tabla de talles por ítem, historial de cambios de estado (`OrderStatusHistory`), export a PDF de la ficha técnica.

**Validaciones**: `OrderItem` exige `sizes` (JSON) no vacío; ficha técnica con múltiples campos condicionales (cuello/manga, marca/escudo con material+dimensiones, tela con composición/gramaje, sponsors, personalización de jugadores).

**Restricciones**: borrado de pedido solo `admin`. El rol `seller` opera con ficha **reducida** (modo `restricted` en frontend: solo tipo de prenda + talles + personalización, precio oculto) — ver `project-seller-order-flow` en memoria previa, confirmar vigencia si se toca este flujo.

**Estados**: ENUM amplio en `Order.status` (`orders` en DB) — incluye estados legados (`pending`, `under_review`, `workshop_review`, `observed`, `in_production`, `quality_check`, `sewing`, `stamping`, `ready`, `cancelled`) **y** los 6 controles de producción nuevos (`raw_material_control`, `cutting_control`, `printing_control`, `sewing_control`, `quality_control`, `packaging_control`). Después del último control el pedido pasa a `ready` ("Listo para despacho") y luego, ya sin checklist, a **`shipped`** ("Enviado") y **`delivered`** ("Entregado") — ver [BR-ORDER-007](03-BUSINESS-RULES.md). Los legados se conservan por compatibilidad de historial, el flujo activo real usa los controles — ver [03-BUSINESS-RULES.md](03-BUSINESS-RULES.md) y memoria previa `production-control-flow.md`.

**Efectos sobre otros módulos**: genera `Invoice` (facturación), consume `StockItem` (tela) y `GarmentCost` (costeo, snapshot en `OrderCostDetail`).

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/order.routes.ts`, `models/Order.ts`, `models/OrderItem.ts`, `frontIndians/src/pages/billing/`, `components/orders/OrderItemForm.tsx`.

---

## 4. Controles de producción / checklist

**Objetivo**: que cada pedido pase por 6 controles de calidad, cada uno con una checklist de ítems que queda como registro (quién tildó qué y cuándo). **Desde 2026-08-11, tildar el checklist NO es requisito para avanzar** (antes sí lo era) — hay ítems que no aplican según la prenda (ej. "insumos: cierres" en una remera sin cierres).

**Usuarios**: `workshop` (tilda ítems, avanza estado), `admin` (también puede operar).

**Flujo principal**: por cada estado de control, el taller puede tildar cada `item_key` del checklist definido (config estática en `src/config/orderChecklists.ts`, no en DB); avanzar al siguiente control no depende de cuántos ítems estén tildados.

**Restricciones**: `OrderChecklistCheck` tiene unique compuesto `(order_id, status, item_key)` — no se puede tildar el mismo ítem dos veces para el mismo estado del mismo pedido.

**Estados**: los 6 controles listados en el módulo 3, más "observado" (reinicio de control) — reglas exactas de qué pasa al observar/reiniciar: **pendiente de confirmar contra el código de `order.service.ts`**, no se relevó línea por línea en esta auditoría.

**Nivel de implementación**: **Implementado y verificado** (estructura y persistencia); reglas finas de transición **parcialmente verificadas** (confirmar antes de modificarlas). Fuente: `backIndians/src/models/OrderChecklistCheck.ts`, `config/orderChecklists.ts`, migración `20260624-046-production-control-states.js`, memoria previa `production-control-flow.md`.

---

## 5. Stock de insumos

**Objetivo**: llevar inventario de materia prima (telas/materiales) usada en pedidos de fábrica, separado del stock de catálogo.

**Usuarios**: `admin`/`billing`/`workshop`.

**Flujo principal**: alta de `StockCategory` → alta de `StockItem` (con `min_quantity`) → movimientos (`in`/`out`/`adjustment`) que actualizan `current_quantity` → alerta de stock bajo (`/stock/metrics`, usado en dashboard).

**Efectos sobre otros módulos**: `OrderItem` puede referenciar `StockItem` como tela (single o multi-tela vía `stock_fabric_ids` JSON).

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/stock.routes.ts`, `models/StockItem.ts`, `models/StockMovement.ts`.

---

## 6. Facturación interna (Invoices)

**Objetivo**: emitir y cobrar facturas internas asociadas a pedidos de fábrica, con posibilidad de pagos parciales.

**Usuarios**: `admin`/`billing` (escritura); todos los roles autenticados (lectura, PDF).

**Flujo principal**: crear factura desde un pedido → estado `draft` → `issued` → registrar `InvoicePayment`(s) → `paid` cuando el saldo llega a 0 (o marcado manualmente); `cancelled` en cualquier momento antes de pagar.

**Validaciones/restricciones**: `discount_amount`, `extra_items` (JSON, ítems adicionales fuera del pedido).

**Estados**: `draft` / `issued` / `paid` / `cancelled`.

**Efectos sobre otros módulos**: opcionalmente se envía a AFIP (módulo 12) para obtener CAE; pagos pueden reflejarse en Caja (confirmar automatismo, no relevado en detalle).

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/invoice.routes.ts`, `models/Invoice.ts`, `models/InvoicePayment.ts`.

---

## 7. Caja (Cash)

**Objetivo**: llevar el flujo de caja de la empresa (ingresos, egresos, transferencias entre cuentas), con trazabilidad hacia su origen (factura, pedido, pedido de tienda).

**Usuarios**: `admin`/`billing` únicamente (todo el router exige ambos roles).

**Flujo principal**: alta de `CashAccount` (caja/caja chica/banco) → alta de `CashTransactionCategory` (algunas `is_system`, no editables) → registrar `CashTransaction` (income/expense/transfer) con `reference_type` opcional (`invoice`/`order`/`store_order`).

**Efectos sobre otros módulos**: la tienda online registra automáticamente un ingreso en caja al confirmarse el pago de un pedido (`cash_recorded_at` en `StoreOrder`, categoría de sistema "Ventas tienda online" sembrada en migración 085) — requiere que el admin configure qué cuenta de caja usar (setting `store_cash_account_id`, ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md), pendiente de configuración manual).

**Nivel de implementación**: **Implementado y verificado** para el módulo base; la conexión automática tienda→caja está **implementada pero requiere configuración manual de negocio** para funcionar realmente. Fuente: `backIndians/src/routes/cash.routes.ts`, `models/CashTransaction.ts`, migraciones 084-087.

**⚠️ Importante — no confundir con una "caja operativa de turnos"**: el módulo es un **libro contable simple** (cuentas + transacciones + categorías), sin ningún concepto de turno, jornada comercial, apertura/cierre, conteo físico, arqueo ciego ni traspaso entre turnos (verificado por búsqueda exhaustiva, cero resultados en todo el repo). Auditoría integral realizada el 2026-08-06 (`backIndians/documentos/AUDITORIA_FLUJO_CAJA_2026-08-06.md`), con corrección en curso según `backIndians/documentos/PLAN_CORRECCION_CAJA_2026-08-06.md`:

- **Fase 1 (✅ corregida)**: no existía ninguna auditoría de dominio de las acciones de caja. Ahora `cash_audit_events` (migración 090, append-only) registra toda mutación con valores antes/después — ver `BR-CASH-*` en `03-BUSINESS-RULES.md`.
- **Fase 2 (✅ corregida)**: los movimientos confirmados se podían editar/borrar sin restricción (`BR-CASH-003`). Ahora `PUT`/`DELETE` de transacciones no existen; la única corrección posible es `POST /cash/transactions/:id/reverse` (contraasiento auditado, motivo obligatorio, soporta reversión parcial).
- **Fase 3 (✅ corregida)**: el ingreso automático de la tienda online no distinguía medio de pago (`BR-CASH-004` — MercadoPago se registraba igual que efectivo). Ahora hay dos cuentas separadas por `payment_method` (`store_cash_account_id` para efectivo, `store_bank_account_id` para MercadoPago/transferencia), con rechazo (400) si se configura el tipo de cuenta incorrecto en cualquiera de las dos.
- **Fase 4 (✅ corregida)**: las cancelaciones/devoluciones no revertían el ingreso de caja ya generado (`BR-CASH-005`). Ahora cancelar un pedido pagado revierte el ingreso por el total remanente (migración 092, `store_orders.cash_reversed_at`); marcar una devolución como `refund_status: 'refunded'` revierte por `refunded_amount` (parcial, no el total — `store_returns.cash_reversed_at`, marca propia porque puede haber varias devoluciones sobre el mismo pedido). Reutiliza `reverseTransaction` de la Fase 2 (`reverseSystemTransaction`, participa de la transacción externa del cambio de estado).
- **Fase 5 (✅ corregida)**: `CashAccount.current_balance` ahora tiene getter DECIMAL→number (antes enviaba `string`, CASH-TYPE-001); los botones "Desactivar"/"Activar" cuenta/categoría ahora piden confirmación (antes ejecutaban directo, CASH-UX-002).
- **Fase 6 (✅ corregida)**: revertir un movimiento queda reservado a `admin` (`BR-CASH-006`, CASH-SEC-002 — antes `billing` también podía). Exportación CSV: decisión de negocio confirmada de NO implementarla por ahora (nunca existió, sin pedido real).
- **Fase 7 (✅ completa)**: validación integral — reset real de la base (drop+create+migrate desde cero, valida las 92 migraciones sobre un esquema vacío), 238 tests en verde, los 4 escenarios que la auditoría original marcó como críticos re-confirmados por HTTP, prueba manual en navegador del flujo completo. Encontrado (no corregido, ver `05-DATABASE.md`) un bug preexistente en el `down()` de la migración 091 que solo afecta rollback, nunca producción.
- **Pendiente**: solo la puerta de decisión sobre el dominio de turnos/arqueo (Fase 8, no comprometida) y confirmar si hay datos reales en la base de producción antes de desplegar ahí las migraciones 090-092.

Estado global: **las siete brechas de la auditoría original con corrección planificada** (CASH-MUT-001, CASH-PAY-002, CASH-AUDIT-001, CASH-SALE-002, CASH-TYPE-001, CASH-UX-002, CASH-SEC-002 — Fases 1-6) están corregidas y validadas integralmente (Fase 7). Sigue **NO APTO** como caja operativa de turnos (ese dominio no existe y es una decisión de producto pendiente, ver sección L del informe de auditoría) — pero como libro contable simple ya es íntegro, auditable y con permisos coherentes.

---

## 8. Costos de prendas

**Objetivo**: mantener una hoja de costos versionada por cliente + tipo de prenda, para calcular precio de venta con margen de ganancia, y congelar el costo real usado en cada pedido.

**Usuarios**: `admin`/`billing` (todo el router).

**Flujo principal**: definir `GarmentCostItem` (maestro de ítems por categoría `jersey`/`shorts`) → armar `GarmentCost` (hoja vigente por cliente+prenda) → cada edición crea una `GarmentCostVersion` inmutable con sus `GarmentCostVersionItem` → al crear un pedido, se congela un snapshot en `OrderCostDetail` (no cambia si luego se edita la hoja de costos).

**Restricciones**: `GarmentType` tiene unique compuesto `(client_id, name)` — mismo nombre de prenda permitido para clientes distintos, no duplicado para el mismo cliente.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/cost.routes.ts`, `services/cost.service.ts`, migraciones 059-065, `frontIndians/src/pages/costs/CostsPage.tsx`.

---

## 9. Catálogo mayorista (Catalog)

**Objetivo**: venta de productos de catálogo a clientes B2B a través de un vendedor, con stock propio y pago por MercadoPago o factura.

**Usuarios**: `admin`/`billing` (gestión completa); `seller` (crea pedidos de catálogo para su cliente asignado).

**Flujo principal**: alta de `CatalogProduct` (con talles `CatalogProductSize`, imágenes, stock) → vendedor arma `CatalogOrder` con `CatalogOrderItem`(s) → pago (`full`/`half`, MercadoPago Checkout Pro con QR renderizado del link) → `CatalogInvoice` con posibles `CatalogInvoicePayment`(s) → estado `created` → `invoice_created` → `delivered`.

**Efectos sobre otros módulos**: mismo `CatalogProduct` que puede exponerse en la tienda online (`show_in_store=true`); movimientos de stock se auditan en `CatalogStockMovement` (ledger compartido con la tienda).

**Ficha técnica del producto + código interno (migración 099)**: `CatalogProduct` guarda, además de los datos comerciales, una plantilla de ficha técnica (telas, colores, cuello/manga, marca/escudo, detalle de tela, sponsors, bordado, puño, accesorios — los mismos campos que `OrderItem`) y un `internal_code` de texto libre. Se cargan una vez al crear/editar el producto en `CatalogPage.tsx` (componente compartido `TechnicalSheetFields`, también usado por `OrderItemForm.tsx` para no duplicar esos ~300 líneas de JSX). Al presionar "Pedido" en la tarjeta del producto, `NewOrderPage.tsx` recibe esos valores por `location.state.prefillItem` y los precarga en el primer `OrderItem` del pedido nuevo — **quedan editables**, es solo el punto de partida; lo único que no se precarga es talles, personalización y notas del pedido. `internal_code` y toda esta ficha técnica están **excluidos** de la API pública de la tienda (`store.service.ts`, `PUBLIC_PRODUCT_ATTRIBUTES`) — no viajan en `listStoreProducts`/`getStoreProduct`.

**Código de barras único por producto (migración 103, 2026-09-04)**: `CatalogProduct.barcode` — Code128, formato `PRD-NNNNNN` con el `id` del producto, generado por el sistema (nunca lo carga el usuario). Productos nuevos lo reciben en `createProduct` (`catalog.service.ts`) justo después del insert, dentro de la misma transacción (necesita el `id` autogenerado). Productos preexistentes se completaron en la propia migración con backfill determinístico (`CONCAT('PRD-', LPAD(id, 6, '0'))`). El índice único se crea con `addIndex` explícito, no con `unique: true` en el atributo del modelo — mismo patrón que `cash_transactions.idempotency_key`, para no duplicar el índice bajo `sync()` en desarrollo (ver la regla de `OrderChecklistCheck` en `CLAUDE.md`). En el panel, botón "Código de barras" en `ProductCard` (junto a "Ver ficha técnica") abre `ProductBarcodeModal.tsx` (`frontIndians/src/components/catalog/`): renderiza el código una vez con `jsbarcode` sobre un `<canvas>` oculto y reutiliza esa imagen (`toDataURL`) para una grilla de N etiquetas (input "Cantidad de etiquetas", 1–200) — 3 columnas, alineadas, cada una con el título del producto y el código. Botón Imprimir (`window.print()` + CSS `@media print` que aísla `#barcode-print-area`, con `break-inside: avoid` por etiqueta para no cortarlas entre hojas) y botón Compartir (Web Share API con la imagen PNG de una sola unidad, no de la grilla completa; fallback desktop: descarga el PNG). El cuerpo del modal (`BarcodeModalBody`) se remonta con `key={product.id}` para resetear cantidad/imagen al cambiar de producto sin usar un `setState` síncrono dentro de un efecto. Igual que `internal_code`, queda **excluido** de la API pública de la tienda por ser `PUBLIC_PRODUCT_ATTRIBUTES` una allowlist explícita.

**Listado imprimible de fichas técnicas (2026-09-05/06)**: pantalla nueva `/catalog/technical-sheets` (botón "Fichas técnicas" en `CatalogBrowserPage.tsx`), con filtros **Cliente** (`SearchCombobox`) y **Tipo de prenda** (`Select`, scopeado al cliente elegido vía `useGarmentTypes(clientId)`). Tabla en pantalla + PDF (`jspdf` + `jspdf-autotable`, nueva dependencia) con columnas: código interno, producto, talles, **código de barras (imagen Code128 escaneable, no solo texto)**, cliente, tipo de tela. La imagen del código se genera una sola vez por producto (`buildBarcodeImages`, un único `<canvas>` reutilizado + `JsBarcode`) y se reutiliza tal cual tanto en la tabla en pantalla (`<img>`) como en el PDF (`doc.addImage` dentro de `didDrawCell` de `jspdf-autotable`, columna a ancho fijo 30mm). Dos detalles no obvios, encontrados al probar con catálogos grandes (1112 productos de datos de QA en dev): (1) el `width` del módulo de `JsBarcode` tiene que ser un **entero** — con un valor fraccionario cada barra cae en un límite de píxel no entero y el canvas la antialiasea, generando un PNG casi incompresible; (2) `doc.addImage(...)` **sin** el parámetro `compression` embebe el bitmap sin comprimir — con ~1000 códigos eso infla el PDF a 34-40MB. Con `width` entero + `compression: 'FAST'`, el mismo PDF pesa ~4.5MB (97 páginas) y un caso normal de 49 productos pesa ~200KB. El logo también lleva `alias` fijo para no reembeberlo en cada página. El PDF repite en cada página una cabecera negra con el logo (`frontIndians/src/assets/indians-logo.png`, copiado del mismo PNG que usa el backend en `indiansLogoImage.ts` para pdfkit — dos copias del mismo asset, uno por motor de PDF) y un título dinámico (`FICHAS TÉCNICAS · <CLIENTE>` si hay un solo cliente filtrado, genérico si no); el pie de página (nota itálica) va solo en la última página. Botón "Imprimir" genera el mismo PDF y lo abre en una pestaña con `doc.autoPrint()` — no hay una versión HTML paralela para imprimir, para no mantener dos diseños del mismo documento. Trae **todos** los productos que matchean el filtro (sin paginar en la UI): pagina contra `GET /catalog/products` en paralelo (`Promise.all`) hasta agotar `total_pages`, con de-duplicación por `id` como salvaguarda. Nombres de tela se resuelven en el cliente contra `useFabricTypes()` (catálogo completo de `fabric_types`, no el endpoint de stock disponible — así no faltan telas sin stock actual). De paso se corrigió un bug real de paginación en `listAllProducts` (`catalog.service.ts`): el `ORDER BY` solo tenía `createdAt DESC` sin desempate, así que filas con el mismo timestamp (común en datos cargados en lote) podían aparecer duplicadas entre dos páginas u omitirse — se agregó `id DESC` como criterio secundario.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/catalog.routes.ts`, `models/CatalogOrder.ts`, `frontIndians/src/pages/catalog/`.

---

## 10. Tienda online (Store)

**Objetivo**: venta B2C directa al público de productos de catálogo, con experiencia de e-commerce completa (carrito, checkout, cupones, seguimiento, cuenta de cliente).

**Usuarios**: `StoreCustomer` (comprador, autenticado u opcional según endpoint); `admin`/`billing` (panel de administración de pedidos/devoluciones/cupones/configuración).

**Flujo principal**: navegación de catálogo público (con filtros, búsqueda, trending, "también visto") → carrito (zustand persistido) → checkout (`checkout/quote` para presupuesto en vivo con envío incluido → `POST /checkout` con `Idempotency-Key`) → reserva de stock con vencimiento → pago (MercadoPago Checkout Pro; **efectivo y transferencia ya no se ofrecen en el checkout** — el efectivo además está desactivado en el backend desde el 2026-08-19, la transferencia sólo oculta en el front desde el 2026-08-24, con su pantalla de comprobante todavía viva para pedidos existentes) → confirmación (webhook MP con verificación de firma, o carga manual del comprobante) → confirmación de stock (resta real) + registro en caja + mail de confirmación → seguimiento por token público o desde "Mis pedidos" → estado avanza (`review`→...→`shipped`/`delivered`, o `delayed`/`returned`/`cancelled`) con mail por cada transición.

**Flujos alternativos**: cupón de descuento (uno por cliente, aplicado atómicamente), carrito abandonado (recordatorio por mail, con envío manual desde el panel admin también), wishlist, direcciones múltiples, cancelación (restituye stock y libera cupón), expiración automática de pedidos impagos a 48hs (job programado).

**Validaciones/restricciones**: checkout idempotente (`Idempotency-Key` header + `idempotency_key` unique en DB); reserva de stock evita sobreventa; webhook de MP valida firma HMAC (fail-closed en producción); rate limiting en checkout y en webhook; Turnstile (captcha) en registro. El formulario de checkout (`StoreCheckoutPage.tsx`) exige nombre, email, **teléfono** (obligatorio desde 2026-08-31; el backend lo sigue aceptando `optional` — es una restricción solo de front) y **DNI** (obligatorio desde 2026-09-04, en front **y backend**: 422 si falta o no son 7–9 dígitos; se guarda en `store_orders.customer_dni`, va en la etiqueta de envío y el PDF, y se replica al perfil del comprador logueado — ver [BR-STORE-013](03-BUSINESS-RULES.md) y migración 102), más la aceptación de T&C (ver módulo 12). Para envío a domicilio, la **provincia** es un `<select>` obligatorio (24 jurisdicciones AR) y, si es **Tucumán**, se pide además la **zona** (San Miguel de Tucumán / interior) porque la tarifa de envío difiere por zona — ver [BR-STORE-012](03-BUSINESS-RULES.md).

**Estados de `StoreOrder`**: ENUM de 10 valores — confirmado en migraciones 033/040/066: incluye al menos `pending_payment`, `paid`, `processing`, `review`, `awaiting_courier`, `shipped`, `delivered`, `cancelled`, `delayed`, `returned`. Transiciones configurables en `backIndians/src/config/storeOrderFlow.ts` (**atención**: replicado también en `frontIndians/src/api/store.ts`, deuda técnica anotada — ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md)).

**Sección destacada / lanzamiento (genérica, 2026-08-27)**: UNA sección de campaña reutilizable con landing propia en `/tienda/coleccion/:slug` (hoy "Despedida del Pulga", mañana "Nueva camiseta CAT", etc.). No es un módulo nuevo ni toca el esquema: es una página de frontend (`frontIndians/src/pages/store/StoreCollectionPage.tsx`) que lista los productos de catálogo con un `tag` configurable vía el filtro `tag` que ya existe en `listStoreProducts`. Los productos son de catálogo normales (`show_in_store=true`) — siguen visibles en el catálogo general, la sección solo les da un espacio de campaña. Todo se edita en *Tienda online → Configuración → Sección destacada* mediante claves `store_collection_*` de la tabla `settings` (13 claves en `VALID_KEYS` y `PUBLIC_SETTING_KEYS` de `settings.service.ts`, sin migración): `_enabled`, `_label` (nombre en el menú), `_slug` (URL; si vacío se deriva del nombre), `_tag`, `_kicker`, `_title`, `_subtitle`, `_description`, `_cta`, `_link_url`, `_link_label`, `_hero_image_url`, `_hero_image_mobile_url`. Con `store_collection_enabled != 'true'` (o sin `_label`) la ruta redirige a `/tienda` y el ítem desaparece del menú, del footer y de la franja de la home.

Desde el **2026-09-08** esa misma sección tiene una **franja de 3 detalles de la prenda** (foto + título + texto corto), al estilo de las landings de marca: va **entre el arte de campaña y la grilla de productos** y sirve para contar la prenda (el escudo, la tela, la tecnología) antes de mostrar qué se compra. Son 10 claves más en las dos allowlists de `settings.service.ts` — `store_collection_details_heading` (encabezado opcional de la franja) y, por cada bloque `N` de 1 a 3, `store_collection_detail_N_image_url`, `_title` y `_text` — también **sin migración**. Cada bloque se dibuja solo si tiene **imagen** cargada (el título y el texto son opcionales), y si no hay ninguna la franja entera no se renderiza; con 1 o 2 imágenes la grilla se ajusta sola. Las fotos se recortan a **4:5 vertical** (`object-cover`, componente `CollectionDetails` en `StoreCollectionPage.tsx`) para que la fila quede pareja aunque se suban con medidas distintas — a diferencia del hero, que nunca se recorta. Se edita en el mismo lugar del panel (`CollectionDetailPanel` en `EcommerceSettingsPage.tsx`). La franja existe **solo en la landing de la colección**, no en la home.

**Efectos sobre otros módulos**: `CatalogStockMovement` (ledger de stock), `CashTransaction` (ingreso automático al confirmarse pago), `StoreOrder.afip_*` (envío manual a AFIP opcional).

**Nivel de implementación**: **Implementado y verificado**, incluyendo hardening de seguridad reciente (idempotencia de checkout y webhooks, verificación de firma MP, reserva de stock con vencimiento, jobs de expiración/reconciliación). Único sub-flujo **planificado pero no implementado**: integración con courier Andreani (envío/tracking sigue siendo manual). Fuente: `backIndians/src/routes/store.routes.ts`, `services/store.service.ts` (84KB, el service más grande del proyecto), `frontIndians/src/pages/store/`, `documentos/AUDITORIA_TIENDA_ONLINE_AVANCE.md`.

---

## 11. Devoluciones de tienda

**Objetivo**: gestionar devoluciones de pedidos de tienda con revisión manual obligatoria (nunca automática) y reintegro de stock condicionado al estado del producto devuelto.

**Usuarios**: `StoreCustomer` (solicita, vía panel admin en nombre del cliente o flujo propio — confirmar canal exacto de solicitud), `admin`/`billing` (revisa y decide).

**Flujo principal**: se crea `StoreReturn` (`pending_review`) con uno o más `StoreReturnItem` → admin revisa y aprueba/rechaza → si aprueba, por cada ítem marca `condition` (`resellable`/`not_resellable`) → solo los `resellable` restituyen stock (`restocked_at`) → gestión de reintegro (`refund_status`: `none`/`pending`/`refunded`).

**Restricciones**: decisión de negocio explícita — nunca se restituye stock ni se ejecuta el reintegro (contra MercadoPago u otro medio) automáticamente, siempre pasa por revisión humana. Distinto de la reversión del *asiento interno* de caja/banco (Fase 4 del plan de corrección de caja, `BR-CASH-005`): si el pedido tiene un ingreso registrado, marcar `refund_status: 'refunded'` SÍ revierte automáticamente ese asiento por `refunded_amount` — es contabilidad interna, no un llamado a una API externa.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/services/storeReturns.service.ts`, `models/StoreReturn.ts`, `models/StoreReturnItem.ts`, migraciones 088-089, `frontIndians/src/components/store/StoreReturnManager.tsx`.

---

## 11b. Legales de la tienda (textos, aceptación y arrepentimiento)

**Objetivo**: cumplir las obligaciones de la normativa argentina de consumo y datos personales en la tienda online, y poder **probar** el cumplimiento: qué versión de cada texto aceptó cada comprador, cuándo, y cómo se gestionó cada arrepentimiento.

**Usuarios**: comprador (lee los textos, acepta, usa el botón de arrepentimiento sin necesidad de cuenta); `admin`/`billing` (gestiona las solicitudes y consulta constancias en Tienda online → Legales).

**Flujo principal (comprador)**: lee Términos y Condiciones / Política de Privacidad (`/tienda/legal/terminos`, `/tienda/legal/privacidad`) → tilda la aceptación en el registro o en el checkout → el backend deja una fila por documento en `legal_acceptances` con versión, fecha, IP y user-agent. Si se arrepiente: `/tienda/legal/arrepentimiento` (link destacado en el footer, sin login) → se registra `store_withdrawal_requests` → recibe en el acto y por mail un código `ARR-AAAA-NNNNNN`.

**Flujo principal (panel)**: `/ecommerce/legal` lista las solicitudes con estado (`received` → `in_progress` → `resolved`/`rejected`), notas internas y vínculo al pedido cuando el número informado coincide; la segunda pestaña busca constancias de aceptación por email.

**Normativa que implementa**: Ley 24.240 (arts. 4, 11-17, 32-34), CCyCN arts. 1104-1116 (en particular 1109 jurisdicción, 1110/1111 revocación, 1116 excepción de productos personalizados), Resolución 424/2020 SCI (botón de arrepentimiento: acceso directo desde la home, sin registración previa, código dentro de las 24 h), Resolución 104/2005 SCT (identificación del proveedor), RG AFIP 4042-E (Data Fiscal F. 960/D), Ley 25.326 + Resolución 14/2018 AAIP (información al titular y leyenda del órgano de control).

**Validaciones/restricciones**: `accept_terms` es **obligatorio** en `POST /store/auth/register` y en `POST /store/checkout` (rechazo 422 sin él); el botón de arrepentimiento no exige login ni captcha y nunca rechaza por "pedido inexistente"; los datos del titular (razón social, CUIT, domicilio) salen de `company_*` en Settings, no están escritos en los textos; el logo Data Fiscal solo se muestra si está cargado `store_data_fiscal_url`.

**Nivel de implementación**: **Implementado y verificado** (12 tests de API en `src/__tests__/api/legal.test.ts`). Pendiente operativo, no de código: cargar los datos fiscales reales en Settings, pegar la URL del QR de ARCA y evaluar la inscripción de la base de datos ante la AAIP. Fuente: `backIndians/src/services/legal.service.ts`, `config/legalDocs.ts`, migraciones 096-098, `frontIndians/src/pages/store/legal/`, `pages/ecommerce/LegalRequestsPage.tsx`.

---

## 11c. Centro de ayuda de la tienda

**Objetivo**: que el comprador resuelva solo las dudas frecuentes (envíos, cambios, reembolsos, garantía, talles, cuidados, pagos, preventas, cuenta) y que atención pueda responder enlazando la respuesta exacta en vez de repetirla.

**Usuarios**: comprador y visitante (público, sin login).

**Flujo principal**: `/tienda/ayuda` → buscador (filtra las 63 preguntas por texto normalizado sin acentos) o índice de 11 categorías → cada categoría abre con su política destacada y sus preguntas en `<details>` → cada pregunta tiene ancla propia `#faq-<id>` con botón "copiar enlace". Las cuatro acciones rápidas del encabezado llevan a Mis pedidos, WhatsApp (cambios), la sección de reembolsos y la de contacto.

**Dónde vive el contenido**: `frontIndians/src/pages/store/help/helpContent.ts` — categorías, preguntas y la constante `HELP_POLICY` con los plazos publicados. La página (`StoreHelpPage.tsx`) solo lo presenta. Para corregir un texto de atención **no hace falta tocar componentes**.

**Plazos publicados** (fuente: documento "Centro de ayuda completo v1.0", agosto 2026, decisiones confirmadas con el usuario el 2026-08-24):

| Tema | Valor publicado |
|---|---|
| Envío | 7 a 9 días hábiles desde la acreditación del pago |
| Cambios y devoluciones | 15 días hábiles desde la recepción |
| Reembolso | hasta 10 días hábiles + el plazo del emisor |
| Garantía legal | 6 meses para productos nuevos (Ley 24.240) |
| Respuesta de atención | 2 días hábiles |

**Consistencia obligatoria**: estos plazos aparecen además en la barra de anuncio del `StoreLayout` (default de `store_announcement`) y deben coincidir con los T&C (`legal/TermsPage.tsx`) y con los correos al cliente. La garantía de 3 meses del brief original **no puede publicarse**: la Ley 24.240 fija 6 meses como mínimo para bienes nuevos.

**Alineación con el checkout (2026-08-24)**: la ayuda publica que el medio de pago es MercadoPago y que no hay retiro en local, y el checkout se ajustó para no contradecirlo — transferencia y retiro quedaron **ocultos** (`StoreCheckoutPage.tsx`). Es ocultamiento de UI, no desactivación: el backend sigue aceptando `bank_transfer` y `pickup`, los pedidos históricos con esos valores se muestran y se gestionan igual, y los T&C se dejaron sin tocar por decisión del usuario. Cada bloque oculto lleva en el código el comentario de cómo volver a ofrecerlo. Ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md).

**SEO**: emite JSON-LD `FAQPage` con las 63 preguntas (`FaqJsonLd` en `components/seo/JsonLd.tsx`). Es válido porque las respuestas se montan siempre dentro del `<details>` colapsado, nunca se generan al abrir.

**Anclas publicadas que no se pueden romper**: `#envios`, `#cambios`, `#talles` (footer y correos ya enviados) y `#faq`, que era el bloque único de preguntas de la versión anterior y hoy se redirige a `#pedidos`.

**Nivel de implementación**: **Implementado y verificado** (typecheck, build, Vitest y prueba en navegador con Playwright: deep links, buscador, mobile sin scroll horizontal). Fuente: `frontIndians/src/pages/store/StoreHelpPage.tsx`, `pages/store/help/helpContent.ts`.

---

## 12. Facturación electrónica AFIP/ARCA

**Objetivo**: emitir comprobantes fiscales electrónicos válidos (con CAE) ante AFIP para facturas de fábrica, catálogo y pedidos de tienda.

**Usuarios**: `admin`/`billing`.

**Flujo principal**: desde el detalle de una factura/pedido de tienda, click en "Enviar a AFIP" (`AfipButton`) → modal con datos fiscales (tipo comprobante A/B/C, concepto, alícuota IVA, tipo/nro documento receptor, condición IVA) → `POST /invoices/:id/afip` (o equivalente de catálogo/tienda) → si `afip_enabled=true`, autentica contra WSAA (firma CMS con certificado) y solicita CAE contra WSFEv1 → guarda `afip_status`/`afip_cae`/`afip_cae_vto` en el registro.

**Validaciones/restricciones**: **gate explícito** `assertAfipEnabled()` — si el setting `afip_enabled` no es `'true'`, corta antes de intentar cualquier llamado real (agregado como fix de seguridad tras detectar que el toggle de UI antes no bloqueaba nada). Es **manual siempre** — no se dispara automáticamente al confirmarse un pago.

**Estados**: `afip_status` ENUM `pending`/`sent`/`error` (por documento: `Invoice`, `CatalogInvoice`, `StoreOrder`).

**Nivel de implementación**: **Implementado y verificado en código** (WSAA+WSFEv1, tests con SOAP mockeado), **no habilitado en producción** — falta certificado real (`AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` vacías en `.env.example`, sin confirmar si ya se cargaron en producción). Fuente: `backIndians/src/services/afip.service.ts`, `routes/afip.routes.ts`, migraciones 074-078, `frontIndians/src/components/afip/`.

---

## 13. Dashboard y analítica

**Objetivo**: dar visibilidad ejecutiva sobre pedidos, facturas, stock, vendedores, y sobre audiencia/comportamiento de la tienda online.

**Usuarios**: `admin`/`billing` (dashboard general y de vendedores); `admin`/`billing` (analítica de tienda: eventos, audiencia, carritos abandonados).

**Flujo principal**: `GET /dashboard/summary` (KPIs, gráficos), `GET /dashboard/sellers` (stats por vendedor, filtrable por mes), `GET /store/admin/metrics` / `/admin/event-analytics` / `/admin/audience` / `/admin/abandoned-carts`.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/routes/dashboard.routes.ts`, `services/storeAnalytics.service.ts`, `frontIndians/src/pages/admin/DashboardPage.tsx`, `pages/ecommerce/EcommercePage.tsx`.

**Nota**: `frontIndians/src/pages/ecommerce/EcommerceAnalyticsPage.tsx` existe como archivo pero **no está registrado en el router** — verificar si es código huérfano o integración pendiente antes de asumir que es una página accesible.

---

## 14. Settings

**Objetivo**: configuración key-value de la empresa, facturación, AFIP y tienda (landing, banners, cupón popup, datos bancarios para transferencia, chatbot, redes sociales, **costos de envío por zona**).

**Imágenes de la landing con variante mobile**: el hero (`store_hero_image_*_mobile_url`), el carrusel (`store_carousel_N_image_mobile`), la sección destacada (`store_collection_hero_image_mobile_url`) y el **banner promocional** (`store_promo_image_mobile_url`, agregado 2026-08-31) tienen cada uno una imagen desktop + una mobile opcional. El front sirve la mobile con `<picture>`/`<source media="(max-width: 767px)">`; si no hay mobile cargada, cae a la de desktop. Cada clave `*_mobile*` tiene que estar en `VALID_KEYS` **y** `PUBLIC_SETTING_KEYS` de `settings.service.ts` (allowlist explícita, ver [BR-STORE-011](03-BUSINESS-RULES.md)).

**Usuarios**: `admin`/`billing` (escritura vía `/settings` y `/store/settings` admin); lectura pública para settings de tienda no sensibles (`GET /store/settings`, cacheado 60s).

**Envíos**: `shipping_cost` (resto del país), `shipping_cost_tucuman_capital`, `shipping_cost_tucuman_interior` y `free_shipping_min` (umbral de envío gratis, global). Las tres primeras son las tarifas por zona — ver [BR-STORE-012](03-BUSINESS-RULES.md). Todas están en `VALID_KEYS` y `PUBLIC_SETTING_KEYS`.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/models/Settings.ts` (PK=`key`), `routes/settings.routes.ts`, múltiples seeds de settings en migraciones (011, 034, 036, 038, 078).

---

## 15. Logging

**Objetivo**: observabilidad estructurada end-to-end (backend + frontend) con contexto de request, sanitización de datos sensibles, y clasificación de errores de negocio.

**Usuarios**: no es un módulo de negocio, es transversal a todos.

**Flujo principal**: cada request recibe `transactionId`/`correlationId` → logger hijo con ese contexto → errores de negocio (`AppError`) clasificados con `code`/`type` → sanitización recursiva antes de loguear (redacción/enmascarado de campos sensibles) → el frontend también manda sus errores a `POST /logs/client`, mismo pipeline.

**Nivel de implementación**: **Implementado y verificado**. Fuente: `backIndians/src/utils/logger.ts`, `sanitize.ts`, `middlewares/requestContext.ts`, `errorHandler.ts`; memoria previa `logging-system.md`.

---

## Actualizar este documento cuando…

Se agregue/quite un módulo, cambie un flujo principal, o cambie el nivel de implementación reportado de alguno de los 15 módulos de arriba.
