# Seguimiento de estado de pedidos (tienda online) — Indians Textil

## Objetivo

Cuando alguien compra en la tienda online ya se envía un mail de confirmación. A
partir de ahí, desde el panel de administración se van cambiando los **estados del
pedido** (En preparación, En camino, Entregado, etc.) y se cargan el
**transportista** y el **número de envío/seguimiento**. **Cada cambio de estado
dispara automáticamente un mail al comprador** reflejando el nuevo estado, y el
comprador puede **consultar el seguimiento de su pedido** en cualquier momento
mediante un **link único no adivinable** (sin necesidad de login) o desde su
sesión en "Mis pedidos".

Reutiliza la infraestructura existente del ecommerce: el mismo proveedor de mail
(Resend + `emailWrapper` de marca), el mecanismo de roles (`authorize`) y el
modelo de pedidos de tienda (`StoreOrder`).

---

## Flujo de estados

Los estados **no** son strings sueltos: viven en una configuración mantenible
(`backIndians/src/config/storeOrderFlow.ts`) con etiquetas, orden de la línea de
tiempo, transiciones válidas y qué estados exigen datos de despacho.

### Estados (`StoreOrderStatus`)

| Estado             | Etiqueta            | Notas                                             |
| ------------------ | ------------------- | ------------------------------------------------- |
| `pending_payment`  | Pendiente de pago   | Inicial. **No** notifica por mail.                |
| `paid`             | Pagado              | Lo setea el flujo de pago (webhook MP).           |
| `processing`       | En preparación      | Camino feliz.                                     |
| `review`           | En revisión         | Intermedio opcional.                              |
| `awaiting_courier` | Esperando el correo | Intermedio opcional.                              |
| `shipped`          | En camino           | **Exige** transportista + N° de seguimiento.      |
| `delivered`        | Entregado           | Fija el **vencimiento** del token de seguimiento. |
| `cancelled`        | Cancelado           | Estado terminal (sin salidas).                    |
| `delayed`          | Demorado            | Fuera del camino feliz. **Nuevo.**                |
| `returned`         | Devuelto            | Fuera del camino feliz. **Nuevo.**                |

`delayed` y `returned` se **agregaron** al ENUM (antes eran 8 estados, ahora 10).

### Transiciones válidas (`STORE_ORDER_TRANSITIONS`)

Se validan en el **backend** antes de persistir (rechazo `409`):

```
pending_payment  → paid, processing, cancelled
paid             → processing, review, cancelled, delayed
review           → processing, awaiting_courier, cancelled, delayed
processing       → awaiting_courier, shipped, cancelled, delayed
awaiting_courier → shipped, processing, cancelled, delayed
shipped          → delivered, delayed, returned, cancelled
delayed          → processing, awaiting_courier, shipped, cancelled
delivered        → returned
returned         → processing, cancelled
cancelled        → (ninguno)
```

Ejemplos de rechazo: `delivered → processing` (no se retrocede), `paid →
delivered` (no se saltean pasos). El flujo de pago automático (webhook de
MercadoPago) pasa por el mismo punto pero con `enforceTransition: false`, porque
puede saltar estados según el resultado del pago.

### Datos de despacho

`shipped` (En camino) es el único estado que **exige** `courier_name` +
`tracking_number` (`statusRequiresShipping`). Si faltan, el cambio se rechaza con
`400`. Los datos son editables (para corregir un número mal cargado).

---

## Historial de estados (traza inmutable)

Cada cambio agrega una fila en `store_order_status_history` (nunca se pisa):

- `previous_status`, `new_status`
- `changed_by` → FK a `users` (**NULL = cambio automático del sistema**, ej. webhook)
- `note` → nota interna opcional (máx 500 chars)
- `createdAt`

En el detalle del pedido (admin) y en la pantalla de seguimiento del comprador se
dibuja la **línea de tiempo** a partir de este historial (estado inicial
`pending_payment` en `createdAt` + cada cambio con su fecha).

---

## Token de seguimiento y vencimiento

- **`tracking_token`**: identificador **opaco no adivinable**
  (`crypto.randomBytes(24)` → 48 chars hex), único, indexado. Se genera al **crear
  el pedido**. El link público es `${STORE_URL}/seguimiento/:token`.
- **`tracking_token_expires_at`**: se setea al pasar el pedido a **`delivered`**:
  `now + tracking_link_expiry_days` (setting configurable, **default 30 días**).
  Mientras el pedido **no** esté entregado, el link **no** vence.
- Al entrar con un **link vencido** → HTTP **410** con mensaje claro ("El enlace de
  seguimiento expiró"); con un token **inexistente** → **404**. Ninguno expone
  datos del pedido.
- El acceso **logueado** ("Mis pedidos") **no** se ve afectado por el vencimiento:
  el dueño siempre puede ver el seguimiento.
- El admin puede **regenerar** el token (`POST .../regenerate-tracking`); si el
  pedido ya está entregado, renueva también el vencimiento.

> **Privacidad:** la vista de seguimiento es **solo lectura** y se serializa con
> `buildTrackingView`, que expone únicamente: N° de pedido, estado + etiqueta,
> tipo de envío, transportista, N° de seguimiento, fecha de creación, línea de
> tiempo y productos (título/talle/cantidad). **Nunca** montos, email/teléfono,
> notas administrativas, comprobantes de pago ni el propio token.

---

## Notificación por mail en cada cambio de estado

- **Plantillas por estado** (`email.service.ts::sendStoreOrderStatusEmail`): cada
  estado tiene su copy (badge, título, intro) manteniendo la identidad visual del
  mail de confirmación (`emailWrapper`). Incluyen N° de pedido, estado nuevo,
  **transportista + N° de seguimiento** cuando aplica, y el **link a la pantalla de
  seguimiento**.
- **Sin duplicados**: si el estado no cambia realmente, no se escribe historial ni
  se envía mail (idempotente). `pending_payment` no notifica
  (`statusNotifiesCustomer`).
- **Desacoplado del guardado**: el cambio de estado se **persiste primero**; el
  mail se **encola** (`utils/emailQueue.ts`, `enqueueEmail`) y se envía en segundo
  plano con **reintentos + backoff** y **logging estructurado**. Si el mail falla,
  el cambio ya quedó guardado y el error queda logueado para reintento manual.

> **Nota de arquitectura:** el proyecto no tiene una cola real (Redis/Bull). El
> despachador es in-process (`setImmediate` + reintentos). Si en el futuro se
> agrega una cola, solo hay que reemplazar el cuerpo de `enqueueEmail` por el
> `queue.add(...)` correspondiente — el resto del código no cambia.

---

## Permisos

- **Cambiar estados / cargar-editar datos de envío / regenerar token**: solo
  `authenticate` + `authorize('admin', 'billing')` (mismo mecanismo que el resto
  de Administración/Facturación). Se aplica en **backend** (autorización real) y en
  la UI.
- **Seguimiento del comprador**: público **solo** vía el token (respeta el
  vencimiento) **o** vía sesión logueada del dueño. No es accesible enumerando IDs
  secuenciales.

---

## Implementación

### Backend

- **`config/storeOrderFlow.ts`** (nuevo): `STORE_STATUS_LABELS`,
  `STORE_STATUS_FLOW`, `STORE_ORDER_TRANSITIONS`, `isValidStoreTransition`,
  `statusRequiresShipping`.
- **`models/StoreOrderStatusHistory.ts`** (nuevo): tabla
  `store_order_status_history` + asociaciones en `models/index.ts`
  (`StoreOrder.hasMany(... as 'status_history')`, `belongsTo(User, as 'changer')`).
- **`models/StoreOrder.ts`**: estados `delayed`/`returned` en el ENUM; columnas
  `tracking_token` (único) y `tracking_token_expires_at`.
- **`utils/emailQueue.ts`** (nuevo): `enqueueEmail(jobName, task)` (fire-and-forget
  con reintentos) y `sendEmailWithRetry` (variante que espera). Logs
  `emailQueue.sent` / `emailQueue.attemptFailed` / `emailQueue.exhausted`.
- **`utils/email.service.ts`**: `sendStoreOrderStatusEmail(params)` (plantilla por
  estado) y `statusNotifiesCustomer(status)`. El flujo de pago dejó de usar los
  mails ad-hoc `sendPaymentApprovedEmail`/`RejectedEmail` (siguen exportados) y
  ahora usa las plantillas por estado, para que historial y mails sean coherentes.
- **`services/store.service.ts`**:
  - `createStoreOrder`: genera `tracking_token` al crear el pedido.
  - `recordStoreOrderStatusChange(order, newStatus, options)`: **punto único** de
    cambio de estado — valida transición, valida datos de despacho, actualiza,
    escribe historial, fija vencimiento al entregar y encola el mail; idempotente.
  - `updateStoreOrderStatus(id, status, tracking, changedBy, note)` → devuelve
    `{ order, emailQueued }` (el pedido recargado con historial).
  - `applyPaymentResult` (webhook MP) ahora enruta la transición por
    `recordStoreOrderStatusChange` con `enforceTransition: false`.
  - `getStoreOrderById`: incluye `status_history` (con `changer`) ordenado ASC.
  - `getStoreOrderTrackingByToken(token)` (404/410),
    `getStoreOrderTrackingForCustomer(orderNumber, customerId)` (sin vencimiento),
    `regenerateTrackingToken(id)`, `buildTrackingView(order)` (serializer seguro),
    `buildTrackingUrl(token)`.
- **`controllers/store.controller.ts`**: `updateOrderStatus` (toma `changedBy` de
  `req.user`, devuelve `email_queued` dentro de `data`), `regenerateOrderTracking`,
  `getOrderTracking` (público), `getMyOrderTracking` (logueado).
- **`routes/store.routes.ts`**:
  - `GET  /store/track/:token` — público (token 16–64 chars, `paymentStatusLimiter`).
  - `GET  /store/me/orders/:orderNumber/tracking` — logueado (`requireStoreAuth`).
  - `PATCH /store/admin/orders/:id/status` — admin/billing, con validadores
    (`status` en el ENUM, `tracking_number`/`courier_name`/`note` opcionales).
  - `POST /store/admin/orders/:id/regenerate-tracking` — admin/billing.
- **`services/settings.service.ts`**: `tracking_link_expiry_days` agregado a
  `VALID_KEYS` (allowlist de settings).
- **`config/ensureSchema.ts`**: en **desarrollo** (donde se usa `sequelize.sync()`
  sin alterar tablas existentes) agrega de forma idempotente el ENUM ampliado, las
  columnas `tracking_token`/`tracking_token_expires_at` y siembra el setting.

### Migración

**`migrations/20260724-066-store-order-tracking.js`** (producción):

1. `ALTER` del ENUM `store_orders.status` con `delayed` + `returned`.
2. Columnas `tracking_token` (STRING(64), único) y `tracking_token_expires_at`
   (DATE) en `store_orders`.
3. Tabla `store_order_status_history` (+ índice por `store_order_id`).
4. Seed del setting `tracking_link_expiry_days = 30`.

> En **desarrollo** no hace falta correr la migración: `ensureSchema` provisiona
> todo al arrancar. En **producción** correr `npm run migrate`.

### Frontend

- **`api/store.ts`**: tipos `OrderTrackingView`, `TrackingTimelineEntry`,
  `StoreOrderStatusHistoryEntry`; estados `delayed`/`returned` en `StoreOrderStatus`;
  `email_queued` transitorio en `StoreOrder`; espejos del backend
  `STORE_STATUS_LABELS`, `STORE_ORDER_TRANSITIONS`, `statusNotifiesCustomer`,
  `statusRequiresShipping`. Endpoints: `storeAdminApi.orders.updateStatus` (con
  `note`) y `regenerateTracking`; `publicStoreApi.me.tracking(orderNumber)` y
  `publicStoreApi.orderTracking(token)` (usa axios crudo para poder distinguir el
  status HTTP 404 vs 410, que el interceptor de `storeApi` descarta).
- **`components/store/OrderTrackingTimeline.tsx`** (nuevo): línea de tiempo solo
  lectura, **reutilizada** por la pantalla pública y por "Mis pedidos".
- **`pages/store/StoreOrderTrackingPage.tsx`** (nuevo): ruta pública
  `/tienda/seguimiento/:token` (registrada en `router/index.tsx`). Maneja carga,
  **link vencido (410)** y **no encontrado (404)** con pantallas claras. `noindex`.
- **`pages/store/StoreAccountPage.tsx`** (Mis pedidos): botón **"Ver seguimiento"**
  que despliega el timeline inline (`InlineOrderTracking`, vía sesión logueada).
- **`pages/ecommerce/EcommerceOrdersPage.tsx`** (admin): botones de cambio de estado
  **filtrados por transición válida**; **modal de confirmación** que aclara que se
  enviará un mail al comprador + nota interna opcional; feedback según
  `email_queued`; **línea de tiempo** del historial; **copiar/regenerar** el link de
  seguimiento. El link a copiar viene del backend (`tracking_url`, armado con
  `STORE_URL`) — **no** de `window.location.origin`, porque en producción el admin
  corre en el subdominio del sistema y la tienda en el dominio raíz.

## Notas de producción (hardening)

- **La `note` de cada cambio es interna**: se persiste en el historial y se muestra
  **solo al admin** (detalle del pedido). El serializer de seguimiento del comprador
  (`buildTrackingView`) **no** la trae ni la expone (ni pública ni logueada).
- **`ensureSchema` no re-altera el ENUM en cada arranque**: el `ALTER TABLE ...
  MODIFY status ENUM(...)` está **guardado** para ejecutarse solo si faltan
  `delayed`/`returned` (un ALTER de ENUM reconstruye y bloquea la tabla en MySQL, y
  `ensureSchema` corre en cada boot, también en producción).
- **Índices**: `tracking_token` tiene índice **único**; `store_order_status_history`
  tiene índice por `store_order_id`. Todas las lecturas nuevas (por token, por
  pedido) pegan a un índice. El listado de pedidos del admin **no** carga el
  historial (solo el detalle), para mantenerlo liviano.
- **Antes de deployear**: restaurar `STORE_URL` al dominio de la tienda si se cambió
  para pruebas locales.
- **`components/store/StoreField.tsx`** y **`components/store/StoreChatbot.tsx`**:
  se agregaron `delayed`/`returned` a los mapas de etiquetas/colores de estado.

---

## Variables de entorno relevantes

| Variable            | Uso                                                              |
| ------------------- | --------------------------------------------------------------- |
| `RESEND_API_KEY`    | API key de Resend para el envío de los mails.                   |
| `RESEND_FROM_EMAIL` | Remitente (default `noreply@indians.com.ar`).                   |
| `STORE_URL`         | Base de los links de seguimiento (ej. `https://indians.com.ar/tienda`). |

Setting configurable (tabla `settings`, editable desde el sistema):

| Setting                     | Default | Uso                                                    |
| --------------------------- | ------- | ------------------------------------------------------ |
| `tracking_link_expiry_days` | `30`    | Días de vigencia del link **después** de "Entregado".  |

---

## Tests

- **`backIndians/src/__tests__/store-transitions.test.ts`** (puro, sin DB):
  transiciones válidas/ inválidas y qué estados exigen datos de despacho.
- **`backIndians/src/__tests__/store-order-emails.test.ts`** (mock de Resend, sin
  DB): subject/HTML correcto por estado, incluye N° de pedido + link; "En camino"
  incluye transportista + tracking; `pending_payment` **no** envía mail.
- **`backIndians/src/__tests__/api/store-tracking.test.ts`** (integración, requiere
  MySQL migrado + seed admin): cada cambio de estado encola el mail correcto (spy);
  "En camino" sin datos de despacho → 400; seguimiento por token válido devuelve la
  línea de tiempo **sin** filtrar datos internos; token inexistente → 404; token
  vencido → 410.

Correr:

```bash
cd backIndians && npx jest store-transitions store-order-emails   # sin DB
cd backIndians && npx jest store-tracking                         # API (necesita DB+seed)
```

**Los 2 primeros pasan sin DB (15 pruebas).** El de API sigue el patrón de los
tests de integración existentes.

## Prueba end-to-end realizada (jul 2026)

Contra el backend en `localhost:3000` con la DB de desarrollo, se verificó el flujo
completo:

1. Checkout (efectivo) → pedido creado con `tracking_token`, estado
   `pending_payment`.
2. Seguimiento público por token → 200, timeline correcto y **sin** exponer
   `total_amount` / `customer_email` / `tracking_token`.
3. `pending_payment → processing` → `email_queued: true`, historial suma el cambio.
4. `→ shipped` **sin** transportista/N° → **400**.
5. `→ shipped` **con** transportista + tracking → 200, `email_queued: true`.
6. Seguimiento público → "En camino" + transportista + N° + línea de tiempo con
   fechas.
7. Transición inválida `shipped → processing` → **409**.
8. `→ delivered` → fija vencimiento a **+30 días**; link vigente 200.
9. Vencimiento forzado al pasado → link **410** ("El enlace de seguimiento
   expiró").
10. Regenerar token (admin) → nuevo link.

Frontend: `npm run build` (tsc + vite) **pasa**.
