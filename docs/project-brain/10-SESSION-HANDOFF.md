# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-09-08 — Módulo de Proveedores (CRUD + cards + filtros)

Pedido del usuario: nueva sección "Proveedores" con CRUD, cada proveedor como **card** en la pantalla y **filtros** para buscarlos. Referencia: el módulo de proveedores de Farol Bike (proyecto gemelo), pero **sin** su módulo de Compras/remitos — Indians no lo tiene.

Decidido con el usuario (vía preguntas): **solo CRUD de proveedores**, tabla nueva `suppliers` **aislada** (no toca stock/costos/pedidos); campos comerciales completos + **rubro/categoría** (texto libre, para filtrar) + **estado activo/inactivo** (baja lógica); acceso **`admin` y `billing`**.

**Sin cambio de contrato de datos existente** — es una tabla y unos endpoints nuevos, todo aditivo. **Migración `105`** (`suppliers`), ya corrida en la DB de dev (`npm run migrate`).

**Backend** (`backIndians`):
- `migrations/20260908-105-create-suppliers.js` — tabla `suppliers` con guard `showAllTables()`, único `uq_suppliers_tax_id` por `addConstraint` (no `unique: true` en el modelo, para no duplicar índice bajo `sync()`), índices en `active`, `business_name`, `category`.
- `src/models/Supplier.ts` — modelo. `src/models/index.ts` — import + export (sin asociaciones: entidad aislada).
- `src/services/supplier.service.ts` — `listSuppliers` (filtros `search`/`category`/`includeInactive` + paginación), `listSupplierCategories`, `getSupplier`, `createSupplier`, `updateSupplier`, `setSupplierActive` (baja lógica), `deleteSupplier` (borrado real). CUIT: normaliza a 11 dígitos (acepta con/sin guiones), único cuando está informado → 409 con el nombre del proveedor que ya lo usa.
- `src/controllers/supplier.controller.ts`, `src/routes/supplier.routes.ts` (`authorize('admin','billing')`; `DELETE` solo `admin`), registrado en `src/routes/index.ts` como `/suppliers`.

**Frontend** (`frontIndians`):
- `src/api/suppliers.ts` — tipos + `suppliersApi` (`list`, `categories`, `getById`, `create`, `update`, `setStatus`, `delete`) + `formatCuit`.
- `src/pages/suppliers/SuppliersPage.tsx` — **grilla de cards** responsive (`sm:grid-cols-2 lg:grid-cols-3`) con badge de rubro/condición IVA/estado, datos de contacto, **bloque de observaciones** (`notes`, con `line-clamp-3` + `title` completo — a pedido del usuario, para saber "de qué es proveedor"), y acciones editar / baja-alta / eliminar (eliminar solo visible para `admin`). Filtros: buscador debounced + `<Select>` de rubro (poblado por `/suppliers/categories`) + checkbox "mostrar dados de baja". Modal alta/edición con react-hook-form + zod, confirmación vía `useConfirm`.
- `src/router/index.tsx` — ruta `/suppliers` (lazy, `allowedRoles={['admin','billing']}`).
- `src/components/layout/Sidebar.tsx` — item "Proveedores" (icono `Truck`), roles `admin`/`billing`, después de "Clientes".

**Validación**: `npm run typecheck` limpio en ambos repos. `npx eslint` sobre los archivos nuevos (`SuppliersPage.tsx`, `api/suppliers.ts`) sin problemas; `npm run lint` del front sigue en su baseline (178 problemas preexistentes, exit 0 — no se agregó ninguno). Test nuevo `src/__tests__/api/factory-suppliers.test.ts` → **6/6 en verde** contra MySQL real (alta, búsqueda, filtro por rubro + `/categories`, razón social obligatoria, CUIT duplicado → 409, edición + baja lógica + `include_inactive`, permisos por rol: seller 403, billing no puede `DELETE`, admin sí).

### Falta

1. **Probar en navegador** `/suppliers` (crear/editar/baja/filtrar) — no se abrió el navegador en esta sesión.
2. **Sin commitear**: los cambios quedaron en el working tree de la rama actual en ambos repos. Rama, merge y release los decide el usuario (ver [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md)). **Al releasear: correr `npm run migrate` en producción** (la migración 105 crea la tabla; producción no usa `sync()`).
3. Enganche opcional con Costos/Stock (registrar de qué proveedor se compró) quedó **fuera de alcance** por decisión explícita del usuario.

---

## Sesión anterior: 2026-09-08 — Franja de 3 detalles de la prenda en la sección destacada

Pedido del usuario con una referencia visual concreta (la landing de adidas/River): en la sección destacada (hoy la camiseta del Pulga) mostrar **tres fotos de detalle de la prenda, cada una con título y un texto corto debajo**.

Decidido con el usuario (vía preguntas): la franja va **entre el hero y la grilla de productos**; las fotos se **recortan a 4:5 vertical** para que la fila quede pareja aunque se suban con medidas distintas; se ve **solo en la landing de la colección**, no en la home (la franja `CollectionBand` de la home queda como está).

**Sin migración** (claves de la tabla key-value `settings`) y **sin cambio de contrato** — es aditivo: el front nuevo contra un back viejo simplemente no dibuja la franja.

**Backend** — `src/services/settings.service.ts`: 10 claves nuevas en `VALID_KEYS` **y** `PUBLIC_SETTING_KEYS` (allowlist explícita, [BR-STORE-011](03-BUSINESS-RULES.md)): `store_collection_details_heading` y, por bloque `N` de 1 a 3, `store_collection_detail_N_image_url` / `_title` / `_text`.

**Frontend**:
- `src/pages/store/StoreCollectionPage.tsx`: componente **`CollectionDetails`** + lectura de las claves. Cada bloque se arma solo si tiene **imagen** (título y texto opcionales); si no hay ninguna imagen, la franja no se renderiza. Con 1 o 2 fotos la grilla se ajusta (`max-w-md` / `sm:grid-cols-2`), con 3 va `sm:grid-cols-3`. Imágenes `aspect-[4/5] object-cover` + `loading="lazy"`.
- `src/pages/ecommerce/EcommerceSettingsPage.tsx`: subcomponente **`CollectionDetailPanel`** (foto + título + texto) ×3 más el título de la franja, dentro de la sección "Sección destacada / lanzamiento" ya existente.

**Validación**: `tsc --noEmit` limpio en ambos repos; `npm run build` del front OK; `store-public-settings.test.ts` 10/10 (el guardrail S-01 cubre las claves nuevas); `eslint` sobre los dos archivos tocados sin errores nuevos (los 2 `no-explicit-any` de `StoreCollectionPage` son preexistentes). **No se probó en navegador**: hace falta que el admin suba las tres fotos desde el panel.

### Falta

1. **Cargar el contenido desde el panel** (*Tienda online → Configuración → Sección destacada → Detalles de la prenda*): tres fotos verticales de la camiseta + título y texto de cada una, y opcionalmente el título de la franja.
2. **Probar en navegador** `/tienda/coleccion/<slug>` en desktop y mobile una vez cargadas las fotos.
3. **Sin commitear**: los cambios quedaron en el working tree de `master` en ambos repos. Rama, merge y release los decide el usuario (ver [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md)).

---

## Sesión anterior: 2026-09-07 — Aviso de cancelación por falta de pago + popup de pedido pendiente

Raíz: **quejas reales de clientes**. Un comprador dejaba un pedido sin pagar, hacía otro y lo pagaba; cuando le llegaba la cancelación automática del primero (`BR-STORE-004`, 48hs), creía que le habían cancelado el que sí había abonado. El plazo existía desde siempre pero **nunca se le comunicaba a nadie**, y el mail de cancelación era genérico.

Decidido con el usuario (vía preguntas): advertir en mail de confirmación + pantalla de espera de pago + "Mis pedidos" (NO en el checkout antes de confirmar); popup **al entrar al checkout**, no bloqueante; detección híbrida logueado/invitado; botones "Ir a pagarlo" + "Seguir con este pedido".

**Rama `feature/aviso-pedido-impago` en AMBOS repos, sin commitear.** Sin migración.

**Backend**:
- **`src/config/orderExpiry.ts` (nuevo)**: fuente única del plazo (`getOrderExpiryHours()`) y del criterio de qué pedido expira (`orderExpiresUnpaid()`, espejo del `where` de `expireStaleOrders`). La constante privada que vivía en el job se movió acá porque ahora el plazo también se comunica.
- **`GET /store/settings`** publica `order_expiry_hours` (clave **derivada** de la env, no fila de la tabla). Nueva lista `PUBLIC_DERIVED_SETTING_KEYS` en `settings.service.ts` — el guardrail S-01 exigía que toda clave publicada esté declarada, y agregarla a `PUBLIC_SETTING_KEYS`/`VALID_KEYS` habría sido mentira (no es guardable desde el panel).
- **Mail de confirmación** (`sendOrderConfirmationEmail`, 6º parámetro `expiryHours`): bloque de advertencia con el número de pedido adentro. Se pasa solo si el pedido efectivamente expira — con efectivo no menciona plazo alguno.
- **Mail de cancelación**: nuevo `StoreOrderStatusReason = 'unpaid'`, propagado desde el job vía `StatusChangeOptions.emailReason`. Asunto "cancelado por falta de pago" y cuerpo que aclara que se canceló *ese* pedido y que los otros ya pagos no se ven afectados. Sin `reason` mantiene el copy genérico intacto.

**Frontend**:
- **`utils/orderExpiry.ts` (nuevo)**: lee `order_expiry_hours` de settings (fallback 48), horas restantes, `timeLeftLabel`, y el espejo de `orderExpiresUnpaid`.
- **`store/pendingOrdersStore.ts` (nuevo)**: zustand+persist, recuerda los pedidos creados en ESE navegador (para invitados). Se escribe en el checkout **antes** de `clear()` del carrito.
- **`hooks/usePendingPaymentOrders.ts` (nuevo)**: logueado → `/store/me/orders`; invitado → registro local con el estado **revalidado** contra `/store/orders/:n/status` (nunca se confía en el estado guardado local; los que ya no están impagos se olvidan).
- **`components/store/PendingPaymentDialog.tsx` (nuevo)**: lista prendas + talles + cantidades del pedido pendiente. "Ir a pagarlo" apunta a "Mis pedidos" si está logueado y a `/tienda/checkout/pago?order=N` si es invitado (Mis pedidos está detrás del login y lo rebotaría).
- Advertencia del plazo en `StoreCheckoutFlowPages` (espera de MP **y** transferencia, esta última solo mientras no subió comprobante) y en cada pedido `pending_payment` de `StoreAccountPage`, con horas restantes reales.

**Validación**: `tsc` limpio en ambos repos. Backend **451/451** (61 suites) — nuevos `unit/orderExpiry.test.ts` (10) y 6 casos en `store-order-emails.test.ts`; `store-public-settings.test.ts` ampliado (10). Frontend 49/49 vitest + `npm run build` OK; lint sin errores nuevos (los de `StoreAccountPage`/`StoreCheckoutPage` son preexistentes). **Falta la prueba manual en navegador** del popup y de los tres avisos.

### Falta

1. **Probar en navegador**: popup como invitado (crear pedido MP, no pagar, volver al checkout) y como logueado; los tres avisos de plazo; el mail de cancelación (correr `expireStaleOrders` a mano o bajar `ORDER_EXPIRY_HOURS`).
2. **Sin commitear** en ambos repos; rama `feature/aviso-pedido-impago` creada. Merge y release los decide el usuario.
3. Contrato **aditivo** (clave nueva de settings, parámetro opcional de mail): el front tolera un back viejo (cae al fallback de 48hs), así que no exige despliegue simultáneo.
4. Decisión consciente: un invitado con transferencia + comprobante ya subido queda advertido de más (el endpoint público de estado no expone el comprobante). Preferible a callarle una cancelación que sí va a ocurrir.

---

## Sesión anterior: 2026-09-07 — Estados "Enviado" y "Entregado" en el flujo de pedidos mayoristas

Raíz: el usuario pidió que el flujo de un pedido de fábrica no termine en "Listo para despacho" (`ready`) sino que siga a "Enviado" y "Entregado". Se acordó (vía preguntas): mantener `ready` como paso intermedio y agregar `shipped`/`delivered` al final; el **taller** marca `ready → shipped`, **facturación/admin** marca `shipped → delivered` (admin puede volver un paso atrás); en el dashboard `shipped`/`delivered` cuentan como terminados igual que `ready`.

**Cambios**:
- **Esquema**: ENUM de `orders.status` y de `order_status_history` (`previous_status`/`new_status`) gana `'shipped'`, `'delivered'`. Migración nueva `migrations/20260907-104-add-shipped-delivered-order-statuses.js` (solo ALTER de ENUM, no migra filas; `down` revierte a `ready`). Espejo en `src/config/ensureSchema.ts` (bloque nuevo, guardado por `includes('delivered')` para no reconstruir la tabla en cada arranque). Modelos `Order.ts` / `OrderStatusHistory.ts` actualizados. `src/types/index.ts` (`OrderStatus`).
- **Transiciones** (`ORDER_STATUS_TRANSITIONS` en `order.service.ts`): `workshop.ready = ['shipped']`; `billing.shipped = ['delivered']`; `admin.ready = ['shipped','cancelled']`, `admin.shipped = ['delivered','ready','cancelled']`, `admin.delivered = ['shipped']`. Validación `isIn` de `order.routes.ts` (2 arrays) ampliada.
- **Dashboard** (`dashboard.service.ts`, 2 queries): "pendientes" = `status NOT IN ('cancelled','ready','shipped','delivered')`; el KPI `ready`/`ready_orders` = `status IN ('ready','shipped','delivered')`. Se mantuvo el nombre de campo `ready_orders` para no tocar 3 type defs + `DashboardPage`/`SellersPage`.
- **Frontend**: `OrderStatus`, `ORDER_STATUS_LABELS` ("Enviado"/"Entregado"), `ORDER_STATUS_COLORS` (lime/emerald), `WORKSHOP_TRANSITIONS`/`BILLING_TRANSITIONS`/`ADMIN_TRANSITIONS` en `formatters.ts`; opción de filtro "Enviado" en `WorkshopOrdersPage`, "Enviado"+"Entregado" en `billing/OrdersPage`. Los detalles (`billing/OrderDetailPage`, `WorkshopOrderDetailPage`) muestran los botones nuevos automáticamente (leen de los mapas de transición).
- **NO tocado a propósito**: el filtro por defecto del listado de taller (`order.service.ts` línea ~395, `['workshop_review','in_production','quality_check','ready']`) y `WORKSHOP_STATUSES` en `useSocket.ts` — ambos ya estaban desactualizados (no listan los 6 controles) pero no los empeora esta tarea; el taller ve el pedido hasta `ready`, lo marca "Enviado" y sale de su vista por defecto.

**Validación**: `tsc` limpio (back+front). Backend **432/432** (60 suites) — incluye `transitions.test.ts` (39, casos nuevos de despacho) y `factory-orders.test.ts` (8, nuevo test que camina un pedido a `ready`, verifica que billing NO puede `shipped`, taller sí, taller NO puede `delivered`, billing sí). Frontend **49/49** vitest (`formatters.test.ts` con mirror front↔back actualizado). Para probar el flujo real hubo que ALTERear el ENUM del `orders.status` en la base de dev a mano (jest no corre `ensureSchema`); en un arranque normal de `npm run dev` lo hace `ensureSchema`.

### Falta

1. **Sin commitear** (ambos repos). El usuario decide rama/commit.
2. **Contrato NO aditivo de esquema**: al desplegar hay que correr la migración `104` (backend y base juntos). El front puede ir después sin romper (los estados nuevos solo aparecen si el back los emite), pero conviene desplegar los dos juntos para que los botones "Enviado"/"Entregado" existan cuando el back ya los acepta.
3. Opcional a futuro: modernizar el filtro por defecto del listado de taller y `useSocket.WORKSHOP_STATUSES` (deuda preexistente, no de esta tarea).

---

## Sesión anterior: 2026-09-07 — El taller no ve precios + "Unidades" del listado de taller siempre en 0

Raíz: el usuario reportó, con dos capturas del perfil de taller, que (1) el detalle de una orden de trabajo mostraba el importe cobrado al cliente (tarjeta "Total", subtotal por ítem, "Total del pedido") — el taller no debe conocer ese dato — y (2) la columna "Unidades" del listado de "Órdenes de trabajo" siempre mostraba `0`.

**Diagnóstico**:
- (1) `WorkshopOrderDetailPage.tsx` renderizaba `formatCurrency(order.total_amount)` y el subtotal por ítem. Además la API devolvía `total_amount` y `items[].unit_price` para el rol `workshop`.
- (2) `listIncludes` en `order.service.ts` **no incluía `OrderItem`**, así que `order.items` llegaba `undefined` al listado y `totalUnitsForOrder` (que suma `item.sizes`) daba siempre 0. El detalle sí funcionaba porque usa `orderIncludes` (completo).

**Fix**:
- Backend (`order.service.ts`): nuevo helper `stripPricingForWorkshop(order)` que pone `total_amount = 0` y `unit_price = null` en los ítems; se llama en `getOrderById` y en `listOrders` cuando `currentUser.role === 'workshop'`. `listIncludes` ahora trae `{ model: OrderItem, as: 'items', attributes: ['id', 'sizes'] }` — solo `sizes`, nunca `unit_price`.
- Frontend (`WorkshopOrderDetailPage.tsx`): se quitaron la tarjeta "Total" (grid de métricas pasó de 4 a 3 columnas), el subtotal por ítem y la línea "Total del pedido"; se quitó el import `formatCurrency`. El `WorkshopOrdersPage.tsx` no se tocó — con los ítems ya poblados calcula bien las unidades.
- El PDF de ficha técnica (`generateOrderPDF`) ya no incluía precios: sin cambios.

**Validación**: `tsc --noEmit` limpio en ambos repos. `eslint` limpio en las dos páginas de taller. **327/327 tests de API en verde** (`src/__tests__/api`, 52 suites). Nueva regla [BR-ORDER-006](03-BUSINESS-RULES.md); se actualizó 06.

### Falta

1. **Sin commitear** — cambios en `backIndians` (`src/services/order.service.ts`, `docs/project-brain/03`, `06`, `10`) y `frontIndians` (`src/pages/workshop/WorkshopOrderDetailPage.tsx`). El usuario decide rama/commit/release.
2. Contrato de API **no aditivo para `workshop`** (antes veía `total_amount`/`unit_price`, ahora no) pero es una restricción deliberada; ningún otro rol cambia. Sin migración. Al desplegar, backend y frontend pueden ir juntos o por separado sin romper nada (el front del taller ya no usa esos campos).

---

## Sesión anterior: 2026-09-07 — Fix de zona horaria en el número de pedido de tienda

Raíz: el usuario reportó, con captura del seguimiento de un pedido real de producción (`ECOM-20260905-0002`), que el número lleva fecha `20260905` cuando el pedido se hizo el `20260904` (historial: "Pendiente de pago — 4 de septiembre de 2026 a las 10:13 p.m.").

**Diagnóstico**: `generateStoreOrderNumber` (`backIndians/src/services/store.service.ts`) armaba el segmento `YYYYMMDD` con `new Date().getFullYear()/getMonth()/getDate()` — hora local del proceso, que en producción (Railway) es UTC. Un pedido hecho entre las 21:00 y la medianoche de Tucumán (UTC−3) caía en el día siguiente: `2026-09-04 22:13 ART` == `2026-09-05 01:13 UTC` → `getDate()` = 5. Además la clave `date_key` de `store_order_sequences` sufría lo mismo, así que la secuencia `NNNN` de esa franja horaria contaba para la jornada equivocada. Es el mismo defecto de TZ ya corregido dos veces en el repo (asiento de caja con `businessDate()`; filtro por fecha del listado admin, 2026-09-02).

**Fix**: se extrajo y exportó `storeOrderDateKey(at = new Date())` = `businessDate(at).replace(/-/g, '')` y `generateStoreOrderNumber` la usa. Sin migración: `store_order_sequences` simplemente se indexa por la fecha correcta de acá en adelante; las filas y los pedidos ya emitidos no se tocan (no se renumera `ECOM-20260905-0002`).

**Validación**: `tsc --noEmit` limpio. Test nuevo `src/__tests__/unit/storeOrderDateKey.test.ts` (6/6, cubre el borde 22:13/23:59/00:01 ART e independencia de `process.env.TZ`). Suites relacionadas en verde: `purchase-flow`, `store-orders-list`, `businessDate` (11/11).

### Falta

1. **Mergeado a `master` local** (rama `fix/store-order-number-timezone`, merge `--no-ff` `3041f26`), `master` ahead 2 de `origin/master`. **Sin pushear** — el usuario eligió que salga en el próximo `npm run release` junto con lo que venga (el bug es cosmético, no urge). **Solo-backend**, sin migración, contrato de API sin cambios.
2. Al desplegar no hace falta nada especial (sin migración).

---

## Sesión previa: 2026-09-07 — Protección de la base productiva (backup diario + guarda de migrate + backup a la nube + usuario RO) — mergeado a `master`, pendiente de release

Raíz: el usuario limpió la base de **desarrollo** con `npm run db:reset` (funcionó bien — ese script ya aborta si la base no es local) y pidió (1) protección contra el borrado accidental de producción y (2) una copia diaria. Todo mergeado a `master` en `backIndians` (rama `chore/db-prod-protection`), sale en el próximo `vX.Y.Z` junto con el código de barras.

**Backup diario local** — nuevos en `backIndians/scripts/release/`:
- `db-backup-daily.mjs` (`npm run db:backup:daily`) — envuelve `backupDatabase()` de `db-backup.mjs` (mismo `mysqldump --single-transaction` de solo lectura + las 3 verificaciones de integridad). Retención de 30 `daily-*` (nunca toca los `vX.Y.Z-*` de release), log en `.releases/db/_daily-backup.log`, exit ≠ 0 si falla.
- `daily-backup.cmd` — runner autolocalizado que manda toda la salida al log. Lo ejecuta el Programador de tareas.
- `install-daily-backup-task.ps1` — registra/desregistra la tarea *"Indians - Backup diario DB"* (diaria 13:00, `-At`, `-StartWhenAvailable`, `-Uninstall`).
- `package.json`: nuevo script `db:backup:daily`. **Probado contra prod real**: `daily-20260906-203344.sql.gz`, 52 tablas, verificado.

**Backup antes de migrar** — `npm run migrate` ahora pasa por `scripts/release/guarded-migrate.mjs`:
- Base local → passthrough directo. Base remota + consola **no** interactiva (deploy de Railway, `startCommand = "npm run migrate && npm start"`) → passthrough tal cual, sin backup (no hay `mysqldump` en el contenedor). **Sin regresión.** Base remota + consola interactiva → saca `pre-migrate-<fecha>.sql.gz`, pide escribir el nombre de la base; si el backup falla, no migra.
- `migrate:undo` / `migrate:undo:all` pasan por la misma guarda. Nuevo `migrate:raw` = `sequelize-cli db:migrate` sin verificación. Usa `npx --no-install` para no salir a la red en el deploy.

**Copia en la nube (off-site)** — `backIndians/.github/workflows/db-backup.yml` (primer workflow del repo): cron diario 06:20 UTC + `workflow_dispatch`, corre `node scripts/release/db-backup.mjs --tag=cloud` y sube el `.sql.gz` como artifact (retención 90 días). **Probado**: corrida a mano en verde, artifact `.sql.gz` completo (52 tablas, ~920 KB, `-- Dump completed on`). El disparador `push` temporal que se usó para probarlo desde la rama ya se revirtió antes del merge. Doc: `12-BACKUP-EN-LA-NUBE.md`.

**Usuario `indians_ro`** (solo SELECT sobre `railway.*`) creado en el MySQL de Railway — SQL y pasos en `11-RELEASE-Y-ROLLBACK.md` § "Conexión de solo lectura a producción". Verificado: un `DELETE` da `Error 1142 command denied`. Es la conexión por defecto en el cliente SQL; la de `root` sólo para escribir.

### Falta

1. **Release**: sale junto con `feat/product-barcode` en el mismo `vX.Y.Z` (`npm run release`, después deploy con OK explícito). Al deployar, Railway corre la migración 103.
2. **Correr `install-daily-backup-task.ps1`** en la máquina del usuario (puede pedir elevación); verificar con `Get-ScheduledTaskInfo -TaskName 'Indians - Backup diario DB'`.
3. Opcional: activar los backups nativos de MySQL en Railway si el plan lo permite (tercera pata).

---

## Sesión anterior: 2026-09-05 — Listado imprimible de fichas técnicas (rama `feat/product-barcode`, mergeada — continuación de la sesión del código de barras)

El usuario pidió, sobre la misma rama, un listado imprimible/descargable de productos con código interno, nombre, talles, código de barras, cliente y tipo de tela, con filtros — trajo una imagen de referencia (documento "Fichas técnicas · Ñuñorco" con logo, barra negra, encabezado de tabla en rojo y nota al pie). Decisiones confirmadas antes de implementar: filtros = Cliente + Tipo de prenda (no tela ni texto libre); título del PDF dinámico (nombre del cliente si se filtra a uno solo, genérico si no); vive como acción nueva dentro de `/catalog` (no una entrada de menú aparte).

**Backend**: un solo cambio, y fue un bug fix real encontrado en el camino — `listAllProducts` (`catalog.service.ts`) ordenaba solo por `createdAt DESC`, sin desempate. Con datos cargados en lote (mismo `createdAt` en muchas filas — el dev tiene 1112 productos activos, mayoría residuo de tests de QA/stress), la paginación por `OFFSET` no es estable entre queries separadas: se detectó con un React key duplicado real durante la prueba en navegador (el mismo producto aparecía en dos páginas). Se agregó `['id', 'DESC']` como segundo criterio. No requirió migración ni cambios de contrato — el endpoint ya devolvía `internal_code` y `barcode` sin necesidad de tocar el `include`.

**Frontend**: `npm install jspdf-autotable` (jsPDF ya estaba). Nueva página `src/pages/catalog/CatalogTechnicalSheetsPage.tsx` en `/catalog/technical-sheets`, con botón de entrada "Fichas técnicas" en `CatalogBrowserPage.tsx`. Filtros: `SearchCombobox` para Cliente, `Select` para Tipo de prenda (scopeado al cliente vía el hook ya existente `useGarmentTypes(clientId)` — sin cliente trae el listado global). Nombres de tela resueltos con `useFabricTypes()` (catálogo completo, no el endpoint de stock disponible, para no perder telas sin stock actual). `fetchAllProducts()` pagina contra `GET /catalog/products` **en paralelo** (`Promise.all`, no un loop secuencial — con 1112 filas un loop secuencial tardaba visiblemente) y de-duplica por `id` como salvaguarda extra sobre el fix del backend. El PDF (`jspdf` + `jspdf-autotable`) repite en cada página una cabecera negra con el logo de Indians (`src/assets/indians-logo.png`, copiado del PNG que ya usaba el backend para pdfkit — mismo asset, dos copias porque son dos motores de PDF distintos) vía el hook `didDrawPage`; el pie de nota itálica se agrega una sola vez, después de `lastAutoTable.finalY`, con salto de página si no entra. El botón "Imprimir" genera el mismo PDF y lo abre en una pestaña nueva con `doc.autoPrint()` (no hay una segunda versión HTML/CSS de impresión que mantener en paralelo — a diferencia del modal de código de barras de la sesión anterior, acá interesaba que Imprimir y Descargar muestren *exactamente* el mismo documento branded).

**Validación corrida**: typecheck y lint limpios en ambos repos (ver el archivo de rutas `router/index.tsx` — los ~59 errores de `react-refresh/only-export-components` que tira ESLint ahí son preexistentes, no de esta sesión). Tests de Jest de catálogo en verde (18/18) después del fix de `ORDER BY`. **Probado en navegador real** con Playwright: filtro por cliente funciona (49/1112 productos para "Club Atlético Los Pumas"), sin filtro carga los 1112 productos en ~66-180ms tras paralelizar el fetch, PDF filtrado (3 páginas) y sin filtrar (~24 páginas, 659ms, 1.9MB) se descargan sin errores. Contenido del PDF verificado con extracción de texto vía `pdfjs-dist` (headless Chromium no tiene plugin de PDF, no se pudo tomar captura visual): título dinámico correcto, cabecera de tabla y barra de logo repetidas en cada página, footer solo en la última, datos de las 6 columnas correctos.

### Falta

1. Mergear `feat/product-barcode` a `master` en ambos repos y releasear cuando el usuario lo apruebe.
2. Evaluar si el listado necesita paginar/virtualizar la tabla en pantalla si algún día el catálogo real (no de QA) crece mucho — hoy renderiza las ~1112 filas sin problema, pero es un número inflado por datos de prueba.

### Ajuste pedido en la misma sesión (2026-09-06) — código de barras como imagen, no texto

El usuario pidió que la columna "Código de barras" del listado muestre el código completo con las barras (escaneable), no solo el texto `PRD-NNNNNN`. Implementado con `JsBarcode` (ya instalado para el modal de código de barras de la sesión anterior): `buildBarcodeImages()` genera una imagen por producto una sola vez (reutilizando un único `<canvas>` fuera de pantalla) y esa misma imagen se usa tanto en la tabla (`<img>`) como en el PDF. En el PDF, el texto de esa columna queda vacío en el `body` de `autoTable` y la imagen se dibuja aparte con `didDrawCell` (columna a ancho fijo 30mm, `minCellHeight: 14` para que la fila tenga alto suficiente).

En el camino aparecieron dos problemas de peso de archivo, ambos ya corregidos (ver nota en 02-FUNCTIONAL-MAP.md módulo 9): `width` fraccionario en `JsBarcode` → antialiasing → PNG casi incompresible; y `doc.addImage()` sin el parámetro `compression` → bitmap sin comprimir. El PDF de 1112 productos pasó de 34-40MB a **4.5MB** con ambos fixes. Se verificó con Playwright en las tres escalas: 49 productos (una página se ve prolija con barras nítidas, PDF ~200KB), y 1112 productos (97 páginas, ~4.5MB, generado en ~3s sin errores). Contenido verificado con extracción de texto (`pdfjs-dist`, headless Chromium no tiene plugin de PDF para captura visual directa).

---

## Sesión anterior: 2026-09-04 (noche) — Código de barras único por producto de catálogo (rama `feat/product-barcode`, ambos repos, **sin mergear**)

El usuario pidió que cada producto de catálogo (`CatalogProduct`) reciba un código de barras único al crearse, con posibilidad de imprimirlo/compartirlo, y que los productos ya existentes también puedan tenerlo. Decisiones confirmadas antes de implementar: entidad = `CatalogProduct` (el modelo `products`/`product_categories` es legado sin uso, se descartó); formato Code128 alfanumérico; UI = modal individual por producto con Imprimir/Compartir (no impresión múltiple); backfill automático en la migración (no botón manual).

**Backend**: migración `20260904-103-add-catalog-products-barcode.js` agrega `catalog_products.barcode` (VARCHAR 50, nullable) + índice único `uq_catalog_products_barcode` vía `addIndex` explícito (no `unique: true` en el modelo — mismo patrón que `cash_transactions.idempotency_key`, para no duplicar el índice bajo `sync()` en dev) y hace backfill determinístico (`CONCAT('PRD-', LPAD(id, 6, '0'))`) para los productos ya existentes. Replicado en `ensureSchema.ts`. `CatalogProduct.ts` — nuevo atributo `barcode`. `catalog.service.ts` — `createProduct` genera `PRD-NNNNNN` (con `buildProductBarcode(id)`) y lo asigna con un `product.update()` dentro de la misma transacción, justo después del insert (necesita el `id` autogenerado). Ver módulo 9 en [02-FUNCTIONAL-MAP.md](02-FUNCTIONAL-MAP.md) y migración 103 en [05-DATABASE.md](05-DATABASE.md).

**Frontend**: `npm install jsbarcode @types/jsbarcode`. Nuevo componente `src/components/catalog/ProductBarcodeModal.tsx` — renderiza el código con `JsBarcode` en un `<canvas>`, botón Imprimir (`window.print()` + CSS `@media print` que aísla `#barcode-print-area`) y botón Compartir (Web Share API con el PNG del canvas vía `canvas.toBlob`; fallback desktop: descarga el PNG). `CatalogPage.tsx` — nuevo botón "Código de barras" (ícono `Barcode` de lucide-react) en `ProductCard`, apilado debajo del botón existente "Ver ficha técnica" (mismo `top-2 right-2`, ahora en un `flex-col`). Tipo `CatalogProduct.barcode` agregado en `types/index.ts`.

**Ajuste pedido en la misma sesión — impresión por cantidad (estilo Farolbike)**: el usuario pidió poder imprimir X copias alineadas en la hoja, no solo una. Se agregó un input "Cantidad de etiquetas" (1–200) que arma una grilla de 3 columnas con la misma imagen del código repetida N veces (cada etiqueta con título + código), tanto en la previsualización del modal como en lo que efectivamente imprime `window.print()` (mismo `#barcode-print-area`, con `break-inside: avoid` por etiqueta para no cortarlas entre hojas). El cuerpo del modal se extrajo a `BarcodeModalBody` y se remonta con `key={product.id}` — la primera versión reseteaba la cantidad con un `setState` síncrono dentro de un `useEffect`, que el linter de React Compiler marca como error (`react-hooks/set-state-in-effect`); el remount por `key` lo evita sin efectos. Compartir sigue compartiendo una sola unidad (no la grilla completa) — no se pidió lo contrario.

**Validación corrida**: backend `npm run typecheck` limpio, `npx tsc --noEmit` del frontend limpio, tests de Jest de catálogo (`factory-catalog.test.ts`, `catalog-mp-payments.test.ts`) en verde (18/18). Migración corrida contra la base de desarrollo real: backfill verificado (`PRD-000001`, `PRD-000002`, ...) e índice único confirmado con `SHOW INDEX`. Sanity check del flujo de creación con un script ad-hoc (`createProduct` real contra la DB de dev): el producto nuevo recibió `barcode` correcto (`PRD-001113`) antes de hacer commit de la transacción. **Probado en navegador real** (Playwright headless contra los dev servers ya corriendo del usuario): login admin → `/catalog/1` → botón "Código de barras" → modal abre con el canvas renderizado (Code128 + texto `PRD-000049` debajo) y ambos botones Imprimir/Compartir visibles — captura de pantalla verificada.

### Falta

1. Probar el flujo de "Imprimir" y "Compartir" con interacción real de usuario (el test automatizado solo verificó que el modal y el canvas se rendericen; `window.print()` y `navigator.share()` no se pueden validar sin un usuario real interactuando).
2. Mergear `feat/product-barcode` a `master` en ambos repos y releasear cuando el usuario lo apruebe (no se hizo — no fue pedido en esta sesión).
3. Evaluar si conviene mostrar también el `barcode` como texto corto en `ProductCard` (hoy solo se ve dentro del modal), igual que ya se hace con `internal_code`.

---

## Sesión anterior: 2026-09-04 (tarde) — Comprobante de pago / etiqueta de envío en ticket 100x150mm (rama `claude/pago-etiqueta-envio-e051ex`, ambos repos, **sin mergear**)

El usuario trajo un diseño (PDF, ticket 100x150mm) para que sirva a la vez de **comprobante de pago no fiscal** (cuando no se emite factura AFIP/ARCA) y de **etiqueta de envío descargable**. Decisiones confirmadas con el usuario antes de implementar: (1) convive con el comprobante A4 existente (`store.pdf.ts` / `generateInvoicePdf`), no lo reemplaza; (2) reemplaza al botón "Etiqueta de envío" que antes generaba HTML client-side con `window.print()` — ahora descarga este PDF; (3) el bloque "Datos del comercio" del diseño alcanza como remitente (se completa con los `settings` `company_*`, sin agregar campos nuevos al diseño); (4) alcance solo panel admin (`EcommerceOrdersPage`), no se expone al comprador.

**Backend**: `src/utils/store.pdf.ts` — nueva función `generateReceiptLabelPdf(data: ReceiptLabelData)`, documento PDFKit tamaño `[100mm, 150mm]` en puntos, replica el layout del diseño (cabecera con logo, datos del comercio, datos del cliente con domicilio de envío, tabla de ítems, pedido/pago, totales, datos del pago con medio/ID de operación/fecha-hora/importe/estado, pie "COMPROBANTE DE PAGO - NO VÁLIDO COMO FACTURA"). `src/services/store.service.ts` — `getStoreOrderReceiptLabelPdfBuffer(orderId)`: arma los datos igual que `buildInvoiceData` + `payment_method`/`mp_payment_id`/`STORE_STATUS_LABELS[order.status]` + fecha del primer cambio a `paid` en `StoreOrderStatusHistory` (no hay columna `paid_at` en `StoreOrder`). `src/controllers/store.controller.ts` — `downloadReceiptLabelAdmin`. `src/routes/store.routes.ts` — `GET /store/admin/orders/:id/receipt-label` (mismos roles que `/invoice`: `admin`, `billing`).

**Frontend**: `src/api/store.ts` — `storeAdminApi.orders.downloadReceiptLabel(id)`. `src/pages/ecommerce/EcommerceOrdersPage.tsx` — se eliminó `printShippingLabel` (generaba HTML + `window.open` + `window.print()`, ~110 líneas) y el `useQuery` de `settings` que solo alimentaba esa función; el botón "Etiqueta de envío" ahora usa una mutation (`downloadReceiptLabel`) que descarga `comprobante-etiqueta-<order_number>.pdf`, mismo patrón que `downloadInvoice`.

**Validación corrida**: backend `npm run typecheck` limpio (el único error de `tsc` es preexistente, `moduleResolution=node10` deprecado, no relacionado). Frontend `npx tsc -b` limpio, `npm run lint` sin errores nuevos en los archivos tocados (los 166 errores/11 warnings son preexistentes, mismo conteo que sesiones anteriores). **No se corrió `npm run test:full`** (no hay MySQL disponible en este entorno) ni prueba en navegador real — pendiente antes de mergear.

### Falta

1. **Correr `npm run test:full` (backend)** y probar en navegador real la descarga del comprobante/etiqueta desde `EcommerceOrdersPage` (pedido con envío `delivery`, con y sin pago de Mercado Pago, con y sin cupón) — no se hizo en esta sesión por falta de MySQL en el entorno.
2. Confirmar con el usuario si el layout generado (adaptación a PDFKit del diseño original) es fiel a lo esperado antes de mergear — no se pudo comparar visualmente con el PDF de referencia dentro de esta sesión.
3. Mergear `claude/pago-etiqueta-envio-e051ex` a `master` en ambos repos y releasear cuando el usuario lo apruebe.

---

## Sesión anterior: 2026-09-04 (mañana) — DNI obligatorio en el checkout (v1.8.0) + fix del login con Google (v1.8.1)

### Estado del release

- **v1.8.0 — EN PRODUCCIÓN.** DNI obligatorio en el checkout (ver abajo). Mergeado `--no-ff` a `master` en ambos repos, `npm run release -- minor`, pusheado y deployado.
- **v1.8.1 — fix de entorno del frontend.** El build de producción salía **sin `VITE_GOOGLE_CLIENT_ID`** → el botón "Continuar con Google" de la tienda tiraba "Login con Google no configurado". Regresión vieja (desde v1.5.0, 2026-09-01): al mover el client ID de dev a `.env.development` se comentó la línea en `.env` y **nunca se agregó a `.env.production`**. Vite en modo `build` carga `.env` + `.env.production` (no `.env.development`), así que la variable quedaba `undefined` y se inlineaba vacía. **Fix**: agregar `VITE_GOOGLE_CLIENT_ID=<client ID de producción>` a `frontIndians/.env.production` (mismo valor que `GOOGLE_CLIENT_ID` en el backend de Railway). No hay cambio de código: es solo el `.env.production` (gitignored) + regenerar el build. Salió como **v1.8.1** (`patch`). **Para no repetirlo: cualquier `VITE_*` que tenga que existir en producción va en `.env.production`, no alcanza con `.env` o `.env.development`.**

### DNI obligatorio en el checkout — qué se hizo (v1.8.0)

- **Migración `102`** (`20260904-102-checkout-dni-columns.js`): agrega `store_orders.customer_dni` y `store_customers.dni` (VARCHAR 15, nullable). Replicada en `src/config/ensureSchema.ts`.
- **Modelos**: `StoreOrder.customer_dni`, `StoreCustomer.dni`.
- **Validación (backend)**: `checkoutValidators` en `store.routes.ts` — `customerDni` **obligatorio**, se limpian puntos/espacios y se exige `^\d{7,9}$` (→ 422). `PUT /store/me` acepta además `dni` opcional con la misma regla.
- **Servicio**: `CheckoutInput.customerDni` → `store_orders.customer_dni`; tras crear el pedido, si el comprador está logueado y **no** tenía DNI en el perfil, se copia a `store_customers.dni` (nunca pisa uno cargado, nunca corta el checkout). `storeGetProfileService`/`storeUpdateProfileService` y los `include` de `customer` en el panel ahora traen `dni`.
- **PDF**: `store.pdf.ts` imprime el campo "DNI" en el comprobante de compra.
- **Frontend**: `StoreCheckoutPage` (campo "DNI *" al lado del teléfono, zod 7–9 dígitos; **teléfono y DNI se precargan del perfil** — `defaultValues` con el `customer` del store de auth + un `useEffect` que completa desde el fetch fresco de `/me` si el campo sigue vacío, igual que la dirección), `StoreAccountPage` ("Mis datos": DNI editable), `EcommerceOrdersPage` (DNI en el detalle del pedido y en la **etiqueta de envío**). Tipos en `api/store.ts`.
- **Tests**: `src/__tests__/api/checkout-dni.test.ts` nuevo (5 casos: sin DNI → 422, corto → 422, no numérico → 422, con puntos → 201 y normalizado, replica al perfil). Se agregó `customerDni: '30123456'` a los **51** payloads de checkout de los tests existentes (21 archivos).

### Validación corrida

- Backend: `npm run typecheck` limpio. `npx jest` de los **22** archivos que tocan `/store/checkout` + el nuevo → **todo verde** (no se corrió `test:full` completo).
- Frontend: `tsc -b` limpio, `eslint` sin errores nuevos (mismo conteo que master), `vitest run` 47/47.

### Falta

1. Deployar **v1.8.1** (push de ambos repos + `npm run deploy:release -- v1.8.1`) y verificar en producción que el botón "Continuar con Google" de la tienda vuelve a funcionar.
2. Borrar la rama local `feature/checkout-dni-obligatorio` en ambos repos (ya mergeada).

---

## 2026-09-02 — Pedidos de tienda: pago que "revivía" + paginación/filtro de fecha rotos

Tres cosas, todas sobre pedidos de la tienda online. La primera ya salió en **v1.6.2**; las otras dos están mergeadas a `master` (ambos repos) **sin releasear** — arman el próximo release.

### 1. Un pedido volvía solo a "Pagado" — `fix/store-order-status-revert-pagado` (backIndians) — EN v1.6.2

Al pasar un pedido de "Pagado" a "En preparación", a veces volvía solo a "Pagado" (reescribía historial + reenviaba el mail de pago). Causa: `applyPaymentResult` (`store.service.ts`) reaplicaba `mapMpStatusToOrderStatus('approved') = 'paid'` sin mirar el estado actual — un webhook `approved` repetido, la confirmación del cliente al recargar la página de éxito, o el job de reconciliación, lo empujaban de `processing` de vuelta a `paid`. El único freno era comparar fechas de pago (`<` estricto), que no cubre un re-`approved` con la misma fecha.

**Fix**: guarda anti-retroceso en `applyPaymentResult` — si el pedido ya salió de `pending_payment`, un resultado que mapea a `paid`/`pending_payment` solo refresca los metadatos de MP y loguea `store.webhook.staleForwardIgnored`, sin tocar el estado. El camino `pending_payment → paid` y el de cancelación por rechazo/contracargo quedan intactos. Test nuevo en `webhook-robustness.test.ts` (caso "processing + webhook approved repetido → sigue en processing"). Documentado en `06-API-AND-INTEGRATIONS.md`.

### 2. Filtro por fecha del listado admin de pedidos — `fix/store-orders-date-filter-timezone` (backIndians) — mergeado, SIN releasear

`listStoreOrders` armaba el tope superior con `new Date(date_to)` (parsea `YYYY-MM-DD` como medianoche **UTC**) + `setHours(23,59,59,999)`. En Argentina (UTC−3) eso corre el día hacia atrás: "hasta el 2/9" quedaba topado en la madrugada del 2/9 UTC y **excluía todos los pedidos de esa jornada** (verificado en dev: `date_from=date_to=hoy` → 0 filas; post-fix → 86). Se alineó con `invoice.service`/`order.service`: `new Date(`${date_to}T23:59:59.999`)` (fin de jornada en la zona del server). Test `store-orders-list.test.ts` (3 casos: sobre paginado, rango de hoy incluye pedido de hoy, rango futuro vacío).

### 3. Paginación real + filtro por fecha en "Pedidos de la tienda" — `feature/pedidos-tienda-paginacion-fecha` (frontIndians) — mergeado, SIN releasear

- **Paginación estaba muerta**: `EcommerceOrdersPage` leía `data.meta.total_pages`, pero el interceptor de `axios` aplana la respuesta a `{ data, total, page, per_page, total_pages }` (sin `meta`) → el bloque de paginación nunca se renderizaba por más pedidos que hubiera. Corregido a la forma plana de `PaginatedResponse`. El **mismo bug** estaba en el tab "Tienda Online" de `InvoicesPage` — corregido también.
- **Filtro Desde/Hasta** (rango sobre la fecha del pedido) cableado a los params `date_from`/`date_to` que el backend ya soportaba. Botón "Limpiar filtros" cuando hay alguno activo; cualquier cambio de filtro vuelve a la página 1. El contador de pedidos ahora se muestra siempre.
- El backend **no necesitó cambios de contrato** para esto (los params ya existían); lo único de backend es el fix de TZ del punto 2, del que este filtro depende para servir en producción.

Verificado end-to-end en navegador (Playwright, 813 pedidos reales en dev): paginación "1/41", avance de página, filtro a "hoy" → "87 pedidos / 1-5", rango futuro → "No hay pedidos", "Limpiar filtros" restaura.

### Estado del release

- **v1.6.2**: contiene el punto 1. `npm run release` corrió y creó tag `v1.6.2` en ambos repos (`chore(release): v1.6.2`). Confirmar con `npm run release:status` si ya está desplegado en producción (back `/health` mostraba 1.6.1 en el dev server local, que es otra cosa).
- **Próximo release** (puntos 2 y 3): ambos repos en `master`, limpios, merges `--no-ff` confirmados (backIndians `a418ab2`, frontIndians `22db6d7`). Sin migración (solo lógica + UI) → rollback solo de código. Sugerido `npm run release -- minor` (v1.6.2 → v1.7.0: hay funcionalidad nueva, el filtro de fecha).

### Falta

1. Correr `npm run release -- minor` en una terminal interactiva real (el prompt de confirmación no corre por pipe/background; `--yes` lo salta pero quedó bloqueado por el clasificador de permisos del agente). Después: deploy con los comandos que imprime + `npm run release:status`.
2. Borrar ramas locales `fix/store-order-status-revert-pagado`, `fix/store-orders-date-filter-timezone`, `feature/pedidos-tienda-paginacion-fecha`.

---

## Sesión anterior: 2026-09-01 (mañana) — RELEASE v1.5.0 EN PRODUCCIÓN (envío por zona + banner promo mobile + teléfono obligatorio)

Las tres ramas se mergearon a `master` en ambos repos y **se desplegó `v1.5.0`** con `npm run release -- minor`: back `/health` → `1.5.0` (commit `d18d8db`), front `/version.json` → `1.5.0`. Ninguna toca esquema de DB (todo `settings` key-value + JSON de `shipping_address`) → sin migración, rollback solo de código si hiciera falta.

### 1. Costo de envío por zona — `feature/checkout-envio-por-zona` (ambos repos)

**Por qué**: el envío dentro de Tucumán cuesta distinto que al resto del país, y la capital distinto que el interior. Era un valor único.

- **Backend**: `settings.service.ts` — claves `shipping_cost_tucuman_capital` y `shipping_cost_tucuman_interior` en `VALID_KEYS` + `PUBLIC_SETTING_KEYS` (`shipping_cost` = resto del país). `store.service.ts` — `resolveShippingZone({state, shipping_zone})` + `getShippingCostForZone(zone)` (fallback a `shipping_cost` si la clave de Tucumán está vacía → nunca 0); `computeOrderTotals` y `getCheckoutQuote` reciben `shipping_state`/`shipping_zone`; `createStoreOrder` los pasa desde `shipping_address` al recalcular → el guard de `expected_total` no da 409. `store.routes.ts` — `shipping_zone` opcional (enum) en quote y checkout. `StoreOrder.ts` — `ShippingAddress.shipping_zone`. `checkout-quote.test.ts` — 6 casos nuevos. Regla nueva: [BR-STORE-012](03-BUSINESS-RULES.md).
- **Frontend**: `src/data/argentinaProvinces.ts` (nuevo, 24 jurisdicciones + `isTucuman()`); `StoreSelect` nuevo en `components/store/StoreField.tsx`; `StoreCheckoutPage.tsx` — provincia = `<select>` obligatorio para envío, si es Tucumán aparecen 2 radio-cards de zona, `state`+`shipping_zone` en el `queryKey` y el payload del quote/checkout; `api/store.ts` tipos; `EcommerceSettingsPage.tsx` sección Envíos con 3 costos; `EcommerceOrdersPage.tsx` muestra la zona.

### 2. Imagen mobile del banner promo — `feature/banner-promo-responsive-mobile` (ambos repos)

El banner promo de la landing se veía todo negro en mobile (la imagen se ocultaba abajo de `md`). `settings.service.ts` — clave `store_promo_image_mobile_url` en `VALID_KEYS` + `PUBLIC_SETTING_KEYS`. `EcommerceSettingsPage.tsx` — 2º `ImageUploadInput` "Imagen del banner — mobile (opcional)". `StoreLandingPage.tsx` — `<picture>` con `<source media="(max-width: 767px)">`; sin versión mobile cae a la de desktop con `object-cover`.

### 3. Teléfono obligatorio + fixes de entorno de dev — `feature/checkout-telefono-obligatorio` (`frontIndians`)

`StoreCheckoutPage.tsx` — `customer_phone` requerido en el esquema Zod (backend lo sigue aceptando `optional`, sin cambio de contrato). `vite.config.ts` — `strictPort: true` (si 5173 está ocupado, Vite falla en vez de saltar a 5174 y romper CORS). `.gitignore` — `+.env.development` (ahí va `VITE_GOOGLE_CLIENT_ID` de dev; `vite build` no lo toma).

### Falta tras el deploy (operativo, no de código)

1. **Cargar en el panel** *Configuración → Envíos*: `shipping_cost_tucuman_capital` y `shipping_cost_tucuman_interior`. Hasta cargarlos, un envío a Tucumán cobra el de "resto del país" (fallback de `getShippingCostForZone`). Subir también una imagen mobile del banner promo.
2. **Smoke en producción**: checkout eligiendo Tucumán + zona → el total del resumen tiene que cambiar y el checkout no debe dar 409; otra provincia → costo de "resto del país". Home en mobile con el banner.
3. **Ramas `feature/*` locales** (`checkout-envio-por-zona`, `banner-promo-responsive-mobile`, `checkout-telefono-obligatorio`) ya mergeadas — se pueden borrar.
4. **Google OAuth en dev** (no bloquea el release): `VITE_GOOGLE_CLIENT_ID` (front, `.env.development`) = `GOOGLE_CLIENT_ID` (back, `.env`), y `http://localhost:5173` autorizado en Google Cloud Console.

---

## Sesión anterior: 2026-08-31 (mañana) — Sección destacada + ajustes de tienda — RELEASE v1.3.0 y v1.3.1 EN PRODUCCIÓN

**Por qué**: lanzamiento de camisetas homenaje a Luis Miguel "Pulga" Rodríguez. Se pidió que la sección **no sea específica del Pulga** sino **genérica y reutilizable**: hoy "Despedida del Pulga", mañana "Nueva camiseta CAT", etc.

**Estado final**:
- **v1.3.0** (2026-08-29): mergeado a `master` en ambos repos y desplegado (back `70ff84f` + front `eb0438f`). El deploy de Railway quedó ~20 min "Queued" antes de tomar; terminó bien sin intervención. Backup: `.releases/db/v1.3.0-20260828-221951.sql.gz`.
- **v1.3.1** (2026-08-31): parche desplegado — el **pill de la sección destacada en el nav pasó de terracota a celeste** (nuevo color `celeste` en `tailwind.config.js`, tono de la camiseta de Atlético Tucumán) y el beneficio de la home dice **"Con Mercado Pago"** (antes "MercadoPago y transferencia"). El checkout y el centro de ayuda ya eran solo MP. **NO se tocó el T&C** (menciona transferencia de forma condicional; sacarlo requiere bump de versión en `legalDocs.ts`, quedó pendiente por decisión del usuario). Verificado con `release:status` (todo verde) + smoke en `indians.com.ar`. Backup: `.releases/db/v1.3.1-20260831-114905.sql.gz`.

**Qué se hizo** (rama `feature/seccion-el-pulga`, ya mergeada a `master`):

- **Decisión con el usuario**: UNA sección de campaña que el admin repurposea. Landing propia PERO los productos siguen visibles en todo el catálogo. Todo administrable desde el panel. Accesos: menú principal (pill terracota) + footer + franja en la home.
- **Enfoque**: los productos son los del catálogo con un `tag` configurable. Se reusa el filtro `tag` de `GET /store/products` → **sin migración, sin cambio de contrato de API**.
- **Backend** (`backIndians/src/services/settings.service.ts`): 13 claves `store_collection_*` en `VALID_KEYS` y `PUBLIC_SETTING_KEYS` — `_enabled`, `_label`, `_slug`, `_tag`, `_kicker`, `_title`, `_subtitle`, `_description`, `_cta`, `_link_url`, `_link_label`, `_hero_image_url`, `_hero_image_mobile_url`.
- **Frontend**:
  - `src/pages/store/StoreCollectionPage.tsx` (renombrada desde `StorePulgaPage.tsx`): hero con la imagen **entera, sin recortar** (`w-full h-auto`); textos superpuestos opcionales; `ProductCard` de los productos (2 cols si son ≤2, si no 3). Redirige a `/tienda` si no está activa; normaliza el slug a la URL canónica.
  - `src/router/index.tsx`: rutas `/tienda/coleccion` y `/tienda/coleccion/:slug`.
  - `src/components/store/StoreLayout.tsx`: `collectionNavItem(settings)` arma el ítem (pill terracota `bg-clay-600`) en menú desktop + mobile y el link del footer, condicionado a `store_collection_enabled === 'true'` && `_label`.
  - `src/pages/store/StoreLandingPage.tsx`: componente `CollectionBand` (franja en la home).
  - `src/pages/ecommerce/EcommerceSettingsPage.tsx`: sección "Sección destacada / lanzamiento".
  - `scripts/generate-sitemap.mjs`: agrega `/tienda/coleccion/<slug>` solo si está activa.

**Validación del release**: `npm run release -- minor --yes` corrió typecheck + `test:full` (backend) y build + prerender (frontend) en verde, sacó el backup de prod y tageó `v1.3.0` en ambos repos.

**Pendientes tras el deploy**:
1. **Prueba del scroll horizontal en mobile en un iPhone real** — los fixes defensivos (`SmartProductSections` + `overflow-x-clip` en el wrapper de `StoreLayout`) están en producción pero no se pudieron verificar en herramientas (la emulación de Chromium miente con `window.innerWidth`).
2. **Activar la sección** cuando el negocio lo decida: *Tienda online → Configuración → Sección destacada* → Nombre + Tag + imagen + toggle; taggear los productos de catálogo con ese tag.
3. **"Lo más comprado de la semana"**: en producción hoy devuelve 0 productos (no hay compras de los últimos 7 días que resuelvan a productos visibles), así que `SectionShell` esconde la sección. Es el comportamiento esperado del ranking nuevo (solo `purchase`); si se quiere que siempre muestre algo, hay que ampliar el fallback de `getTrendingProducts` (hoy solo cae a "más nuevos" cuando hay CERO eventos de compra, no cuando los eventos resuelven a vacío).

---

## Sesión anterior: 2026-08-26 — Test de estrés pre-lanzamiento (tienda + panel)

**Por qué**: el sistema va a producción con un flujo importante de tráfico real y nunca se había probado bajo concurrencia real de escritura (checkout, login) — solo lecturas públicas (`stress/run-stress.js`, autocannon, ya existía).

**Qué se hizo**: se armó infraestructura de test de carga nueva en `backIndians/stress/` (rama `test/stress-carga-lanzamiento`, NO mergeada a `master`):
- `seed-load-data.ts`: siembra 300 productos de catálogo (`STRESS-*`, stock alto) + 1 producto de stock bajo para el test de condición de carrera (`STRESS-RACE`, stock=5) + 200 compradores de prueba. Guarda de "solo DB local" igual a `scripts/reset-dev-db.js`.
- `k6/01-catalog-browse.js`, `02-store-auth.js`, `03-checkout-transfer.js` (siempre `payment_method: bank_transfer`, nunca dispara MercadoPago real), `05-admin-panel.js`, `04-stock-race.js` (burst de 50 compradores por 5 unidades) + `verify-race-integrity.ts` (chequeo de integridad post-burst).
- `run-k6.mjs`: orquestador que corre cada escenario en niveles crecientes de VUs vía `docker run grafana/k6` (sin instalar nada) y reporta el punto de quiebre (tasa de error/latencia).
- Corrido contra una réplica local (no existe staging real desplegado) con `MAIL_ENABLED=0` + emails de prueba en `@example.com` (bloqueados siempre por `mailGuard.ts`, doble barrera) — cero mails reales, cero pagos MP reales en toda la sesión.

**3 bugs reales encontrados y corregidos** (ver tabla completa en [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md)):
1. **Auto-deadlock del pool de conexiones en checkout**: `generateStoreOrderNumber` no recibía la `transaction` del checkout → con concurrencia ≥ `pool.max` (10), el sistema se autobloqueaba (`SequelizeConnectionAcquireTimeoutError`) con apenas 10 compradores simultáneos. Fix: pasarle la transacción.
2. **Números de pedido duplicados bajo concurrencia** (hasta ~45% de checkouts fallando con 50+ VUs): el cálculo del próximo `order_number` no era atómico. Un primer intento (`lock: FOR UPDATE` sobre el `SELECT` original) generó deadlocks reales de InnoDB — **no repetir ese patrón**, quedó documentado en el código. Fix definitivo: tabla `store_order_sequences` (migración 100) con el modismo atómico de MySQL (`INSERT ... ON DUPLICATE KEY UPDATE next_seq = LAST_INSERT_ID(next_seq + 1)`).
3. **Login capado a ~3 req/s pase lo que pase** (staff y comprador): `bcryptjs` (JS puro) bloqueaba el único hilo de Node bajo logins concurrentes. Fix: reemplazado por `bcrypt` nativo en todo el backend (mismo formato de hash, compatible con contraseñas existentes — verificado en vivo, nadie necesita resetear). Sube a ~15 req/s con el thread pool default de Node, ~24 req/s con `UV_THREADPOOL_SIZE=16`.

También: pool de conexiones subido de `max: 10` a `max: 25` (mejora moderada, no es la bala de plata — el techo real de throughput por endpoint sigue en ~85-170 req/s, probablemente por ser un único proceso Node sin cluster). Verificado que **no hay** condición de carrera de stock (el ledger ya usa `FOR UPDATE` correctamente).

**Validación**: `tsc --noEmit` limpio, `npm run test:full` — **57 suites / 406 tests, todos en verde** (incluye el flujo de checkout con el nuevo contador de `order_number`, sin regresiones). Los 5 escenarios de k6 corridos con resultados numéricos (req/s, p50/p95, tasa de error) mostrados al usuario. Verificación de integridad post-condición-de-carrera: PASA (5 pedidos, 5 reservado de 5 físico, ledger reconcilia).

**Falta / cómo retomar**:
1. **Cargar `UV_THREADPOOL_SIZE` en Railway** (variable de entorno, sin cambio de código) — es lo único de los 3 hallazgos críticos que sigue con una acción pendiente fuera del código.
2. **Verificar el límite de conexiones del plan de MySQL en Railway** antes de confiar en `pool.max: 25` en producción (localmente MySQL permite 151; Railway puede ser distinto).
3. Rama `test/stress-carga-lanzamiento` en `backIndians` sin mergear — pedir confirmación antes de mergear a `master` y desplegar (toca `store.service.ts`, una migración nueva, y la librería de hashing de contraseñas — release delicado, seguir `11-RELEASE-Y-ROLLBACK.md`).
4. Datos de prueba `STRESS-*` / `stress-customer-*@example.com` quedaron en la base de dev local (no en producción) — limpiar con `npx ts-node --project tsconfig.seed.json stress/seed-load-data.ts --cleanup` o `npm run db:reset` si hace falta una base limpia.
5. No evaluado en esta sesión (fuera de alcance): migrar a `node:cluster`/múltiples instancias si el volumen esperado de lanzamiento supera el techo medido (~85-170 req/s por endpoint en esta máquina de desarrollo — no es directamente comparable al hardware de Railway, hay que remedir ahí si el margen preocupa).

Archivos tocados: `src/services/store.service.ts`, `src/services/auth.service.ts`, `src/services/store.auth.service.ts`, `src/services/user.service.ts`, `src/models/StoreOrderSequence.ts` (nuevo), `src/models/index.ts`, `src/config/db.ts`, `migrations/20260826-100-create-store-order-sequences.js` (nueva), `package.json`/`package-lock.json` (bcrypt en vez de bcryptjs), `seeders/*.ts` (mismo swap), `tsconfig.seed.json`, `.gitignore`, todo `backIndians/stress/` (nuevo).

---

## Sesión anterior (2026-08-25): Ficha técnica + código interno en productos de catálogo

Cerrada y validada sin pendientes (código commiteable, probado en navegador real, 406 tests en verde). Detalle completo en el historial de `git log` de `backIndians` y en [05-DATABASE.md](05-DATABASE.md) (migración 099) / [02-FUNCTIONAL-MAP.md](02-FUNCTIONAL-MAP.md) (sección 9) si hace falta el contexto completo.

---

## Sesiones anteriores — pendientes que siguen abiertos

- **SSL `sistema.indians.com.ar`** (sesión 2026-08-24): el certificado del subdominio sigue sin resolverse — requiere contactar soporte de Donweb. Vía de emergencia vigente: `https://sistema.indianstextil.com.ar/`. Detalle en [DEC-022](08-DECISIONS.md#dec-022).
- **`feature/centro-de-ayuda`** (sesión 2026-08-24, ambos repos): rama sin mergear con la reescritura de `/tienda/ayuda` (11 categorías, 63 preguntas, deep links, FAQ JSON-LD) y el checkout alineado (solo Mercado Pago, sin retiro en local). Pendiente: mergear + `npm run deploy` del frontend; decidir si se alinean los T&C (mencionan transferencia/efectivo/retiro) y si se desactiva `bank_transfer` en el backend. Retomar con `cd frontIndians && git checkout feature/centro-de-ayuda`.

Ver [DEC-022](08-DECISIONS.md#dec-022) para el detalle técnico completo. Resumen para retomar:

**Qué se hizo**: se diagnosticó que `sistema.indians.com.ar` devolvía la página de error de Donweb ("sin certificado SSL") en vez de la app — causa: el certificado del hosting cubre `indians.com.ar` raíz pero nunca se dio de alta el subdominio `sistema.` en el panel de Certificados SSL de Donweb, y su self-service no acepta subdominios. Aparte, se encontró y arregló un bug real de login (`LoginPage.tsx` rechazaba contraseñas de más de 10 caracteres, contradiciendo el mínimo de 10 del backend) — commit `723400f`, commiteado y pusheado directo a `master` (no a `feature/centro-de-ayuda`, que quedó intacta), buildeado y desplegado por FTP.

**Cómo retomar**:
1. **Pendiente real**: el certificado SSL de `sistema.indians.com.ar` sigue sin resolverse — hace falta contactar soporte de Donweb (el panel no permite agregarlo como subdominio). Hasta que se resuelva, el acceso al panel es por `https://sistema.indianstextil.com.ar/` (mismo backend/DB/build, documentado como vía de emergencia).
2. Confirmar si el usuario quiere que el link de "recuperar contraseña" deje de depender de `SYSTEM_URL` fijo (propuesto, no implementado — ver DEC-022).
3. `frontIndians` quedó en `master` con el fix de login ya pusheado; `feature/centro-de-ayuda` no se tocó y sigue con sus 2 commits sin mergear (ver la sección siguiente). Al mergear esa rama a `master`, va a traer consigo el fix de login (ya está en `master`, así que no hay conflicto esperado ahí).

---

## Sesión anterior (aún vigente, sin cambios): 2026-08-24 — Centro de ayuda de la tienda

Rama: `feature/centro-de-ayuda` en **ambos** repos (en backIndians solo cambia el cerebro documental: el código del backend no se tocó). No mergeada, no releaseada.

### De dónde salió

El usuario trajo el documento *"INDIANS — Centro de ayuda completo v1.0"* (agosto 2026, 18 páginas: arquitectura, textos de atención, políticas de envíos/cambios/devoluciones/garantía/talles y especificaciones de implementación) y pidió adaptarlo a la sección de ayuda de la tienda.

La página `/tienda/ayuda` ya existía, con cuatro bloques (envíos, cambios, talles, FAQ). El trabajo real no fue escribir texto: fue **resolver las contradicciones** entre lo que el documento propone, lo que la página decía y lo que el sistema hace de verdad.

### Contradicciones encontradas (verificadas contra el código, no contra el documento)

| Documento | Sistema real | Resolución |
|---|---|---|
| Solo Mercado Pago | `StoreCheckoutPage.tsx` ofrecía MP + efectivo + transferencia | Se publica "Mercado Pago" y **se ocultó la transferencia** en el checkout (el efectivo ya estaba oculto desde el 2026-08-19) |
| No hay retiro en local | `shipping_type: 'pickup'` era el **default** del checkout | **Se ocultó el retiro** y el default pasó a `'delivery'` |
| Cambios: 15 días hábiles | La ayuda publicaba 30 días corridos | Se adoptan los 15 días hábiles |
| Envío: 7 a 9 días hábiles | La ayuda publicaba 3-7 días + 24-48 h de despacho | Se adoptan los 7 a 9 días hábiles |
| Garantía: 6 meses | La ayuda no hablaba de garantía | Se publica la garantía legal de 6 meses (Ley 24.240) |
| No publicar tabla de talles genérica | Ya había una publicada | Se **mantienen** las tablas y se suma el instructivo de medición |

Las cuatro decisiones que no eran técnicas (pagos, plazos, talles, estructura de rutas) las tomó el usuario explícitamente. Sobre el retiro en local cambió de criterio a mitad de la sesión: primero se mantenía, después pidió ocultarlo junto con la transferencia.

### Segunda parte: alinear el checkout

Con la ayuda ya publicando "se paga con Mercado Pago", el checkout la contradecía. El usuario pidió **ocultar** transferencia, efectivo y retiro en local, sin tocar T&C ni Settings.

Es ocultamiento de UI, no desactivación, y la diferencia importa: el backend sigue aceptando `bank_transfer` y `shipping_type: 'pickup'`, los pedidos históricos con esos valores se muestran y se gestionan igual, `/tienda/checkout/transferencia` sigue viva y las claves `bank_transfer_*` quedan cargadas. Cada bloque oculto lleva el comentario de cómo revertirlo, siguiendo el patrón que ya había dejado el equipo para el efectivo.

El detalle que no era obvio: `'pickup'` era el **default** del formulario. Ocultar el radio sin cambiar el default habría creado los pedidos como retiro sin que el comprador pudiera verlo ni cambiarlo. El default pasó a `'delivery'`.

### Qué se hizo

**Contenido separado de la UI**: `frontIndians/src/pages/store/help/helpContent.ts` — 11 categorías, 63 preguntas y la constante `HELP_POLICY` con los plazos publicados en un solo lugar. Se puede corregir un texto de atención sin tocar un componente.

**Página** (`StoreHelpPage.tsx`, reescrita): buscador que normaliza acentos, cuatro acciones rápidas, índice de categorías, política destacada por sección, pasos del cambio, tablas de talles y medición, canales de contacto reales tomados de Settings (`store_whatsapp`, `company_email`, `store_instagram`).

**Acordeones con `<details>` nativo** en vez de estado en React: trae teclado y semántica gratis, el navegador lo abre solo cuando el hash apunta adentro, y la respuesta se monta siempre (lo que hace válido el JSON-LD). De paso, sacó el `setState` dentro de un efecto que tenía la versión anterior.

**Deep links**: cada pregunta tiene ancla `#faq-<id>` con botón "copiar enlace" — para que atención mande la respuesta exacta. Las anclas viejas (`#envios`, `#cambios`, `#talles`) siguen funcionando, y `#faq`, que era el bloque único de la versión anterior y está en correos ya enviados, redirige a `#pedidos` en vez de quedar muerta.

**SEO**: `FaqJsonLd` nuevo en `components/seo/JsonLd.tsx` → emite `FAQPage` con las 63 preguntas.

**Consistencia**: el default de `store_announcement` en `StoreLayout` decía "Cambios sin cargo dentro de los 30 días" — se actualizó a los 15 días hábiles. Los links de Ayuda del footer se ampliaron (Centro de ayuda, Garantía, Contacto).

**Checkout** (`StoreCheckoutPage.tsx`): `PAYMENT_OPTIONS` queda solo con `mercadopago`; el radio de retiro en local sale del formulario y el default de `shipping_type` pasa a `'delivery'`; `Building2` sale del import de lucide porque quedaba sin usar. La FAQ de retiro del centro de ayuda pasó de "sí" a "no" en la misma tanda.

### Validación

- `tsc --noEmit` limpio · `npm run build` OK · Vitest **47/47** · ESLint sin errores nuevos (los 5 de `StoreLayout.tsx` son preexistentes: se contaron antes y después del cambio).
- Prueba en navegador real (Playwright, dev server): 11 secciones y 63 preguntas renderizadas, JSON-LD `FAQPage` presente, buscador filtrando (14 resultados para "talle", mensaje de sin resultados OK), deep link `#faq-cuanto-tarda` abriendo la respuesta correcta, alias `#faq` scrolleando, mobile 390px sin scroll horizontal.
- Checkout verificado en navegador con el carrito sembrado en `localStorage` (el backend de dev no estaba levantado): no menciona transferencia, efectivo ni retiro; el único radio de envío es `delivery` y queda seleccionado; pide la dirección; sin scroll horizontal en 390px.

### Qué falta (lo importante para la próxima sesión)

1. **Los T&C siguen mencionando transferencia, efectivo y retiro** (`legal/TermsPage.tsx`, secciones 8 y 9). Se dejaron así por decisión explícita del usuario. No es urgente —describen medios que el comprador ya no puede elegir, no le prometen algo que no va a recibir— pero si la decisión se vuelve definitiva conviene alinearlos, junto con desactivar `bank_transfer` en el backend (mismo patrón que `cash`, con su test de contrato).
2. **Costo del primer cambio de talle**: sin definir (el texto hoy dice que se informa antes de confirmar). El documento recomienda el primero sin cargo.
3. **Medidas reales por producto**: las tablas publicadas son de referencia general.
4. Merge de `feature/centro-de-ayuda` y `npm run deploy` del frontend (FTP) — el backend no cambió.

### Cómo retomar

```bash
cd frontIndians && git checkout feature/centro-de-ayuda
npm run dev            # /tienda/ayuda
```

El contenido está todo en `src/pages/store/help/helpContent.ts`; los plazos, en `HELP_POLICY` al principio de ese archivo.
