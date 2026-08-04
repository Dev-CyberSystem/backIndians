# Avance — Corrección Módulo Tienda Online (Indians)

Seguimiento de la implementación del plan de `AUDITORIA_TIENDA_ONLINE_DIAGNOSTICO.md`.
Convención: pendiente / en curso / resuelto / descartado.

> **Nota de estructura de repos:** `indians/` (raíz) no es un repositorio git
> funcional. `backIndians` y `frontIndians` son **dos repos git separados**
> (remotos `Dev-CyberSystem/backIndians` y `Dev-CyberSystem/frontIndians`),
> ambos en la branch `fixauditoria`. Este documento y el resto de
> `documentos/` se movieron a `backIndians/documentos/` (2026-08-04) y ya
> quedan versionados ahí — con la excepción de `Users.txt`, que tiene
> credenciales reales en texto plano y está en `.gitignore` a propósito
> (nunca debe commitearse).

---

## Fase 1 — Correcciones críticas

| Tarea | Hallazgo(s) | Estado | Nota |
|---|---|---|---|
| 1.7 | C-4 (parcial) | **Resuelto** | Ver detalle abajo. |
| 1.9 | Higiene de secretos | **Resuelto (parcial — ver riesgo residual)** | Ver detalle abajo. |
| 1.1 | C-2, C-3 | **Resuelto (código) — pendiente acción manual** | Ver detalle abajo. |
| 1.2 | C-5 | **Resuelto (con 2 exclusiones documentadas)** | Ver detalle abajo. |
| 1.3 | C-1, A-9 | **Resuelto (talle por `size_name`, sin esperar 1.10)** | Ver detalle abajo. |
| 1.10 | M-8 | **Resuelto** | Ver detalle abajo. `restoreStoreOrderStock` (1.3) ahora prefiere el FK. |
| 1.4 | A-1 | **Resuelto** | Ver detalle abajo. |
| 1.5 | A-7 | **Resuelto** | Ver detalle abajo. Casos 13/14/15 de prueba pasan. |
| 1.6 | C-6, A-3, A-4 | **Resuelto** | Ver detalle abajo. Casos 4/5/6 de prueba pasan. |
| 1.8 | C-8 (parcial) | **Resuelto** | Ver detalle abajo. **Fase 1 completa.** |

---

### 1.7 — Renombrar "factura" → "comprobante de compra"

**Estado: Resuelto.**

Archivos tocados (`backIndians`): `src/utils/store.pdf.ts`, `src/utils/email.service.ts`,
`src/controllers/store.controller.ts`, `src/services/store.service.ts` (comentario de sección).
Archivos tocados (`frontIndians`): `src/pages/ecommerce/EcommerceOrdersPage.tsx`,
`src/pages/store/StoreAccountPage.tsx`.

- Título del PDF: `FACTURA` → `COMPROBANTE`.
- Reemplazado el bloque de CAE/"Comprobante autorizado por ARCA" (que era una
  afirmación falsa) por la leyenda **"Documento no válido como factura"** +
  aclaración de que no reemplaza a la factura fiscal.
- Asunto/cuerpo del email, nombre de archivo adjunto (`factura-*.pdf` →
  `comprobante-*.pdf`), mensajes de respuesta del backend y textos/labels del
  panel admin y de "Mi cuenta" en la tienda: todos renombrados.
- Identificadores internos (`sendOrderInvoiceEmail`, `downloadInvoice`,
  endpoints `/invoice`, `/send-invoice`, variable `INVOICE_STATUSES`) se
  dejaron sin tocar a propósito — no son texto de cara al cliente y renombrarlos
  no aporta nada a este hallazgo.

**Decisión de alcance (no pedida explícitamente, la tomé por consistencia con
la razón de ser de C-4):** además de la leyenda, reemplacé el texto
"Comprobante autorizado por ARCA" (que es una afirmación falsa hoy) por la
misma leyenda de descargo. No toqué el resto del layout tipo-factura (casillero
con la letra X/A/B/C, numeración `punto de venta-nro`, discriminación de IVA,
casillero QR) — eso es un rediseño más de fondo y corresponde a la Fase 2
(`store_invoices`), no a un cambio de "muy bajo riesgo".

**Verificación:** `grep -i factura` sobre los 5 archivos no devuelve ningún
texto de cara al cliente (solo aparece dentro de la leyenda misma y en
comentarios internos). `npm run typecheck` (backend) y `npx tsc --noEmit`
(frontend) limpios.

**Hallazgo de lint preexistente (no introducido por esta tarea):**
`npx eslint src --max-warnings=0` en `frontIndians` ya fallaba antes de este
trabajo — 162 errores / 11 warnings en todo el proyecto (hooks condicionales,
`any`, escapes innecesarios, etc.), ninguno en las líneas que edité. No lo
corregí porque está fuera del alcance de 1.7 y tocar esos archivos (algunos
con reglas de hooks rotas) es un cambio de mayor riesgo que amerita su propia
tarea. Lo dejo marcado para que decidas si entra en el plan.

---

### 1.9 — Higiene de secretos (`.env.bak`)

**Estado: Resuelto en el índice de git — riesgo residual en el historial.**

- `.env.bak` estaba trackeado en el repo `backIndians` (`git ls-files` lo
  confirmaba) y el `.gitignore` solo excluía `.env` exacto, no `.env*`.
- Hice `git rm --cached .env.bak` (queda **sin trackear pero sigue en tu
  disco** — no borré el archivo físico, por si lo necesitás antes de rotar
  credenciales).
- Actualicé `backIndians/.gitignore`: agregué `.env.*` con excepción
  `!.env.example`, para que ningún `.env.*` futuro (bak, local, etc.) se
  vuelva a versionar por error.
- **No hice commit** — dejé el `git rm --cached` y el `.gitignore` en el
  working tree para que los revises antes de commitear.

**Riesgo residual importante:** sacar el archivo del commit actual **no lo
borra del historial git**. Hay un commit (`05faa4f "integracion mp"`) que
todavía lo contiene y sigue siendo recuperable con `git show
05faa4f:.env.bak` por cualquiera con acceso al repo remoto. Purgar el
historial (`git filter-repo` / BFG + force-push) es una operación destructiva
que reescribe la historia compartida — **no la hice** sin tu autorización
explícita. La mitigación real es rotar las credenciales, no depender de
borrar el historial.

**Variables que contenía `.env.bak` (nombres únicamente, sin valores) —
rotalas si son las reales de producción:**

```
PORT, NODE_ENV, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN,
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
FRONTEND_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
MP_ACCESS_TOKEN, MP_PUBLIC_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL,
STORE_URL, GOOGLE_CLIENT_ID
```

Prioridad de rotación sugerida: `DB_PASSWORD`, `JWT_SECRET` /
`JWT_REFRESH_SECRET`, `MP_ACCESS_TOKEN`, `CLOUDINARY_API_SECRET`,
`RESEND_API_KEY`, `SMTP_PASS`, `GOOGLE_CLIENT_ID` (si tiene client secret
asociado en otro lado).

---

### 1.1 — Configuración de MercadoPago (webhook)

**Estado: Resuelto en código — falta acción manual tuya en Railway/panel de MP.**

- `backIndians/.env.example`: `BACKEND_PUBLIC_URL` ya estaba documentada
  (dato que corrige a la auditoría original). Agregué `MP_WEBHOOK_SECRET` con
  comentario explicando dónde se genera y para qué sirve.
- `backIndians/src/server.ts` — `validateEnv()`: si `NODE_ENV=production` y
  falta `BACKEND_PUBLIC_URL` (o apunta a localhost/127.0.0.1) o falta
  `MP_WEBHOOK_SECRET`, el arranque falla con `process.exit(1)` y un log
  `startup.envValidation` con el detalle de qué falta.
- `backIndians/src/services/mercadopago.service.ts` —
  `verifyWebhookSignature()`: ahora es **fail-closed en producción** (sin
  secret configurado, rechaza todo). Fuera de producción sigue siendo
  permisivo si no hay secret, pero ahora loguea un WARN
  (`mercadopago.webhookSecretMissing`) en vez de fallar en silencio.
- `backIndians/src/middlewares/rateLimit.ts`: nuevo `webhookLimiter` (30
  req/min por IP).
- `backIndians/src/routes/store.routes.ts`: `POST /webhook/mp` ahora pasa por
  `webhookLimiter` además del `generalLimiter` global.

**Tests:** `src/__tests__/unit/mercadopago.service.test.ts` (nuevo, 6 casos,
sin DB) — cubre fail-closed en producción sin secret, fail-open en dev sin
secret, firma válida, firma inválida, sin header `x-signature`, y `dataId`
que no coincide con el firmado. Los 6 pasan (`npx jest
src/__tests__/unit/mercadopago.service.test.ts`).

**Verificación:** `npm run typecheck` (backend) limpio.

**Acción manual tuya (no la puedo hacer yo):**
1. En el panel de MercadoPago (Tu aplicación → Webhooks) generar la "Firma
   secreta" y copiarla.
2. En Railway, variables del backend: setear `MP_WEBHOOK_SECRET` (el valor
   del punto anterior) y `BACKEND_PUBLIC_URL` (dominio público real del
   backend, sin localhost).
3. Sin esas dos variables seteadas, **el backend no va a arrancar en
   producción** a partir de este cambio (`NODE_ENV=production` + falta
   cualquiera de las dos → `process.exit(1)`). Conviene setearlas *antes* de
   desplegar este cambio para no causar una caída del servicio.

---

### 1.2 — Ledger de stock

**Estado: Resuelto, con 2 exclusiones documentadas (ver abajo).**

- **Migración** `20260804-067-create-catalog-stock-movements.js`: tabla
  `catalog_stock_movements` (id, `catalog_product_id` FK RESTRICT,
  `catalog_product_size_id` FK nullable SET NULL, `type` ENUM(sale/return/
  cancel/adjustment/in/out/transfer), `quantity`/`previous_quantity`/
  `new_quantity`, `reason`, `source` ENUM(store/catalog/manual/system),
  `store_order_id`/`catalog_order_id` FK nullable SET NULL, `user_id` FK
  nullable SET NULL, `notes`, timestamps) + índices por producto/talle/pedido/
  fecha. Con guardas `if (!tables.includes(...))` como la 066.
- **Modelo** `src/models/CatalogStockMovement.ts` + asociaciones en
  `models/index.ts`.
- **Servicio** `src/services/stockLedger.service.ts` — única función
  `adjustStock()`, único punto autorizado a tocar `catalog_products.
  stock_quantity` / `catalog_product_sizes.stock_quantity`. Usa
  `findByPk(..., { lock: Transaction.LOCK.UPDATE })` (mismo patrón que ya
  usaba `stock.service.ts` para el ledger de materiales) dentro de la
  transacción del caller, valida disponibilidad si `requireAvailable` y
  escribe el movimiento en la misma transacción.
- **Refactor de los 3 sitios que tocaban `stock_quantity` directo:**
  1. `store.service.ts` (checkout): mismo comportamiento (409 "Stock
     insuficiente para X" si no alcanza), ahora con movimiento `sale`/`store`
     + `store_order_id`.
  2. `catalog.service.ts` `createCatalogOrder` (pedido mayorista): el
     `Promise.all` con `.decrement()` sin guarda atómica pasa a un loop
     secuencial con `adjustStock(requireAvailable:true)` → movimiento
     `sale`/`catalog` + `catalog_order_id`. Efecto colateral: cierra una
     ventana de sobreventa concurrente que existía ahí (no era un hallazgo
     nombrado en la auditoría, lo detecté al centralizar).
  3. `catalog.service.ts` `adjustProductStock` (ajuste manual admin): pasa a
     `type:'adjustment', source:'manual'`; el controller
     (`catalog.controller.ts`) ahora le pasa `req.user?.id`.

**Decisión tomada (confirmada por vos):** el `user_id` del ledger en pedidos
mayoristas usa `input.seller_id` (no hay campo separado de "quién lo creó"
hoy).

**Exclusiones — 2 sitios que TODAVÍA escriben `stock_quantity` sin pasar por
el ledger** (no estaban nombrados en la ubicación del hallazgo C-5 original,
que solo mencionaba `catalog.service.ts:214,413` y `store.service.ts:
662-673`):
1. `createProduct` (alta de producto nuevo) — el `stock_quantity` inicial se
   escribe directo en el `.create()`. No hay "cantidad anterior" real para
   una fila que no existía, así que no lo forcé por el ledger.
2. `saveProductSizes` — el editor de talles del admin **destruye y recrea**
   todas las filas de `catalog_product_sizes` del producto (con sus
   `stock_quantity`) en cada guardado. Es el único lugar hoy donde se puede
   ajustar el stock de un talle individual, y queda sin auditar. No lo toqué
   porque el "previous_quantity" no se puede atar a una fila estable (el id
   cambia en cada guardado — mismo problema que ya nota M-8/1.10), y mezclar
   ese rediseño en 1.2 aumentaba el riesgo de una tarea que ya era "Medio".

**Tests:** nuevo `src/__tests__/api/stock-ledger.test.ts` (4 casos, contra la
DB real de dev, con fixture propio): ajuste manual deja movimiento
`adjustment`/`manual` con `previous`/`new` correctos y `user_id`; pedido
mayorista deja `sale`/`catalog` con `catalog_order_id`; pedido mayorista sin
stock no descuenta ni deja movimiento (400, chequeo previo no atómico —
comportamiento preexistente, no cambió); checkout de tienda en efectivo deja
`sale`/`store` con `store_order_id`. Corrida completa: **24 suites / 146
tests, todos verdes** (sin regresiones en los tests preexistentes de
checkout, catálogo y stock de materiales).

**Nota técnica de entorno:** la tabla nueva no existía en la DB de dev hasta
que arranqué el server una vez (`npm run dev`) para que `sequelize.sync()`
la creara — el flujo normal de este proyecto en dev (`ensureSchema`/`sync`,
no `sequelize-cli db:migrate`; ver `dev-db-sync-gotchas`). Importante: las
migraciones 059 a 066 figuran como "down" en `sequelize-cli db:migrate:status`
aunque sus tablas/columnas ya existen (se crearon por `sync()`, no por el
CLI) — **no corras `db:migrate` a secas**, aplicaría esas 8 migraciones sin
guardas de idempotencia sobre un esquema que ya las tiene y probablemente
falle o rompa algo. La migración 067 sí es segura de correr sola porque tiene
guarda `if (!tables.includes(...))`.

**Verificación:** grep de `stock_quantity` con asignación fuera de
`stockLedger.service.ts` solo devuelve las 2 exclusiones de arriba (+
declaraciones de tipo en modelos + fixtures de test). `npm run typecheck`
limpio.

---

### 1.3 — Restitución de stock y liberación de cupón

**Estado: Resuelto.**

- **Migración** `20260804-068-store-orders-stock-restored-at.js`:
  `store_orders.stock_restored_at DATETIME NULL` (guarda `describeTable`,
  mismo patrón que la 066).
- **Función nueva** `restoreStoreOrderStock(order, reason, userId, transaction)`
  en `store.service.ts` (exportada, tal como pedía la tarea). Idempotente de
  verdad: relee el pedido con `lock: Transaction.LOCK.UPDATE` **dentro** de la
  transacción del caller y no hace nada si `stock_restored_at` ya está
  seteado — no depende solo de la comparación de estado.
- **Único punto de enganche:** dentro de la transacción interna de
  `recordStoreOrderStatusChange` (que ya es el único lugar por donde pasan
  los 3 caminos hacia `cancelled`: admin manual, webhook de MP, retorno del
  cliente), justo después de escribir `StoreOrderStatusHistory`, solo cuando
  `newStatus === 'cancelled'`. Si algo falla ahí, se revierte también el
  cambio de estado (no queda "cancelado pero sin restituir").
- Por cada `StoreOrderItem`: resuelve el talle por `catalog_product_id` +
  `size_name` (fallback — `store_order_items` todavía no tiene
  `catalog_product_size_id`, ver 1.10 abajo) y llama a
  `stockLedger.adjustStock({ type:'cancel', source:'store', delta:+quantity })`.
  Si el talle no se puede resolver (renombrado/borrado): **no rompe la
  cancelación** — loguea `logger.error` y deja un movimiento `delta:0` con
  nota "revisión manual pendiente" en vez de adivinar dónde ajustar.
- Libera el cupón (`used_count = GREATEST(used_count - 1, 0)` con guarda
  `used_count > 0`, mismo patrón que el incremento del checkout).
- **`returned` queda afuera a propósito** (no dispara restitución) — es
  decisión explícita del admin, tal como pedía la tarea.
- **Fuera de alcance a propósito** (para no invadir 1.5): no toqué el
  `order.update()` sin transacción de `applyPaymentResult` para los campos
  `mp_*`, ni agregué lock/dedupe de eventos de webhook.

**Decisión tomada (confirmada por vos):** no esperé a 1.10 — la resolución
del talle usa `size_name` como único método (el "fallback" que preveía el
propio texto de la tarea), ya que hoy es el único método disponible. Cuando
se haga 1.10, conviene que `restoreStoreOrderStock` prefiera
`catalog_product_size_id` si existe y caiga a `size_name` solo si no.

**Tests:** nuevo `src/__tests__/api/stock-restoration.test.ts` (2 casos,
contra la DB real): cancelar un pedido en efectivo con cupón aplicado
restituye el stock exacto, deja un movimiento `cancel`/`store` con
`previous`/`new` correctos, marca `stock_restored_at` y decrementa
`used_count` del cupón; llamar `restoreStoreOrderStock` una segunda vez sobre
el mismo pedido (directo, no por HTTP — la transición `cancelled→cancelled`
ya está bloqueada por `STORE_ORDER_TRANSITIONS`, así que se prueba la
función en sí) no agrega movimientos ni cambia el stock. Suite completa:
**24/25 suites, 147/148 tests** — la única falla
(`factory-garment-types.test.ts`) es un test preexistente flaky (colisión de
nombre por `Date.now() % 1000`, no relacionado con este cambio), pasa solo
en aislado.

**Verificación:** `npm run typecheck` limpio.

---

### 1.4 — Idempotencia en el checkout

**Estado: Resuelto.**

- **Migración** `20260804-069-store-orders-idempotency-key.js`:
  `store_orders.idempotency_key STRING(64) nullable` + índice único (mismo
  patrón que `tracking_token`).
- **`checkoutValidators`** (`store.routes.ts`): `header('idempotency-key').
  optional().isUUID()` — **opcional**, no rompe nada que no la mande (tests
  viejos, futuros clientes).
- **`createStoreOrder`**: chequeo temprano — si viene la clave y ya existe un
  pedido con ella, lo devuelve directo (sin revalidar carrito ni re-tocar
  stock). Cubre el caso común (el segundo request llega después de que el
  primero ya terminó).
- **Carrera real** (dos requests exactamente simultáneos, ninguno encuentra
  nada en el chequeo temprano): el índice único de la DB es la red de
  seguridad. Se extendió el `catch` que ya manejaba colisión de
  `order_number` (con reintento) para distinguir, vía `err.fields`, si la
  colisión es por `idempotency_key` — en ese caso NO reintenta: busca el
  pedido que sí ganó la carrera y devuelve ESE, sin duplicar el descuento de
  stock.
- **Decisión que tomé** (dijiste "lo más robusto para la aplicación"):
  agregué `getPreference()` en `mercadopago.service.ts` para que, al devolver
  un pedido repetido de MercadoPago, se reconsulte la preference y se
  devuelva un `mp_init_point` fresco (nunca se persiste, solo
  `mp_preference_id`) — si la reconsulta falla, devuelve `null` en vez de
  cortar la respuesta (el pedido ya existe de todas formas).
- **Frontend:** `StoreCheckoutPage.tsx` genera un UUID con `useRef` al
  montar (mismo patrón de fallback que ya usaba `useStoreTracker.ts` para el
  session id) y lo manda en cada submit. `api/store.ts`: `checkout()` ahora
  acepta la key como segundo argumento y la manda como header
  `Idempotency-Key` vía la config de axios de esa llamada puntual (no toca
  el interceptor global).

**Tests:** nuevo `src/__tests__/api/checkout-idempotency.test.ts` (3 casos):
dos POST secuenciales con la misma key → mismo pedido, un solo descuento; dos
POST en **paralelo** (`Promise.all`, carrera real) con la misma key → mismo
invariante (verificado que efectivamente pasa por el camino del
`UniqueConstraintError`, no solo por el chequeo temprano); sin key → sigue
creando dos pedidos (comportamiento sin cambios, regresión cubierta). Suite
completa: **26/26 suites, 151/151 tests** (el test antes flaky pasó esta
vez).

**Verificación:** `npm run typecheck` (backend) y `npx tsc --noEmit`
(frontend) limpios. `npx eslint` sobre los 2 archivos tocados del frontend:
3 problemas, los 3 preexistentes (confirmado con `git diff`, ninguno en mis
líneas).

---

### 1.10 — catalog_product_size_id en store_order_items

**Estado: Resuelto.**

- **Migración 070** (`20260804-070-store-order-items-size-id.js`): columna
  `catalog_product_size_id` nullable + FK `ON DELETE SET NULL` a
  `catalog_product_sizes`, con índice. Mismo patrón (`addColumn` con
  `references` inline) que ya usaba `order_items.stock_fabric_id`.
- **Migración 071** (`20260804-071-backfill-store-order-items-size-id.js`,
  **separada**, tal como pedía la tarea): backfill por
  `UPDATE ... JOIN` que resuelve `(catalog_product_id, size_name)` **solo
  cuando hay coincidencia unívoca** en `catalog_product_sizes` (agrupando por
  producto+talle con `HAVING COUNT(*) = 1`) — si el talle es ambiguo, ya no
  existe, o el ítem no tiene `size_name` (producto sin talles), se deja
  `NULL`. No inventa datos. Idempotente (solo toca filas todavía `NULL`) —
  lo verifiqué corriéndola dos veces contra la DB de dev: la primera
  backfillió 75/75 filas candidatas (sin ambigüedades en los datos actuales),
  la segunda afectó 0.
- `createStoreOrder` ahora guarda `catalog_product_size_id` en cada
  `StoreOrderItem` (ya tenía `item.sizeRecord` resuelto).
- **`restoreStoreOrderStock` (1.3) actualizada**: ahora prefiere
  `item.catalog_product_size_id` directo; el fallback por `size_name` (con
  el log de error si no resuelve) queda solo para pedidos históricos sin
  backfill posible o talles borrados después.

**Tests:** nuevo `src/__tests__/api/store-order-item-size-id.test.ts` —
checkout con talle guarda el FK correcto en el ítem; cancelar usa ese FK
directo (verificado con el movimiento de stock linkeado al talle, no
resuelto por texto). Suite completa: **27/27 suites, 152/152 tests.**

**Verificación:** `npm run typecheck` limpio.

---

### 1.5 — Idempotencia y robustez de webhooks

**Estado: Resuelto.**

- **Migración 072** (`create-webhook-events`): tabla `webhook_events`
  (`provider`, `event_id`, `payload_hash`, `processed_at`, `result`),
  `UNIQUE(provider, event_id)`.
- **Migración 073**: `store_orders.mp_payment_date` — fecha del último pago
  aplicado, para detectar eventos desordenados.
- **`handleStoreWebhook`**: registra el evento en `webhook_events` **antes**
  de consultar a MP. Si ya está `processed_at` (completo), no reprocesa ni
  vuelve a llamar a MP. **Matiz que agregué** (no estaba en el texto
  original, pero me pareció necesario): si el evento existe pero quedó a
  medias (`processed_at` sigue `NULL` porque el proceso se cayó a mitad de
  camino), permite reintentar en vez de descartarlo para siempre — si no, un
  crash entre registrar y terminar de procesar perdería el pago.
- **`applyPaymentResult`** reescrita: ahora abre su propia transacción con
  `SELECT...FOR UPDATE` sobre el pedido (antes eran dos escrituras sueltas
  sin lock). Para esto, `recordStoreOrderStatusChange` ahora puede recibir
  una transacción externa (`options.transaction`) en vez de abrir siempre la
  suya — los demás llamadores (cambio manual del admin) siguen exactamente
  igual.
- **Eventos desordenados**: si la fecha del pago que se está aplicando
  (`date_last_updated` de MP) es más vieja que `mp_payment_date` ya guardado,
  no toca nada — ni status ni los campos `mp_*`.
- **Validación de monto/moneda**: antes de pasar a `paid`, compara
  `transaction_amount`/`currency_id` de MP contra `total_amount` del pedido.
  La moneda se compara contra `'ARS'` fijo (no hay columna `currency` — toda
  la tienda cobra en ARS, ya hardcodeado así al crear la preference). Si no
  coincide: NO acredita, pasa a `review` (salteando la tabla de transiciones,
  igual que ya hace todo el flujo automático de pago —
  `enforceTransition:false`), `logger.error`, y emite
  `notification:store_order_review` por socket (mismo patrón que los dos
  eventos que ya existían).
- **`confirmStorePayment`** (retorno del cliente) comparte `applyPaymentResult`,
  así que queda protegido igual. Tuve que ampliar `searchPaymentsByReference`
  (su segundo camino, cuando no hay `payment_id`) para que también traiga
  monto/moneda/fecha, no solo `id`/`status`.

**Tests:** nuevo `src/__tests__/api/webhook-robustness.test.ts` — no existía
ningún mock del SDK de MercadoPago en el repo, así que agregué el patrón
(`jest.spyOn` sobre `getPaymentInfo`). 3 casos, los 3 de la sección 9 de la
auditoría: 13 (webhook repetido — `getPaymentInfo` se llama una sola vez),
14 (importe incorrecto — queda en `review`, no `paid`, con `logger.error`
verificado), 15 parcial (evento desordenado no retrocede el estado). Suite
completa: **27/28 suites, 154/155 tests** — la única falla es el mismo test
preexistente flaky de siempre (`factory-garment-types.test.ts`), reconfirmado
en aislado.

**Verificación:** `npm run typecheck` limpio.

---

### 1.6 — Total correcto en el checkout

**Estado: Resuelto.**

- **`computeOrderTotals`** (privada, en `store.service.ts`): extraída de
  `createStoreOrder` — resuelve productos, calcula precios (`roundPrice` +
  `discount_percentage`, igual que antes), valida cupón (`validateCoupon`,
  sin cambios) y calcula envío (settings `shipping_cost`/`free_shipping_min`,
  sin cambios). Cambio de comportamiento clave: en vez de tirar `AppError` en
  el primer producto con problema, cada ítem queda marcado
  `disponible`/`motivo` y se sigue evaluando el resto — así el aviso puede
  ser específico por producto (A-4) en vez de genérico.
- **`getCheckoutQuote`** (exportada): wrapper público sobre
  `computeOrderTotals`, sin crear nada — es lo que expone
  `POST /store/checkout/quote` (nuevo, con su propio `quoteLimiter`, 60/10min
  por IP, más generoso que `checkoutLimiter` porque no crea pedidos).
- **`createStoreOrder`** ahora llama a `computeOrderTotals` y:
  1. Si algún ítem no está disponible, tira el mismo tipo de error que antes
     (mismo criterio de negocio: no se puede comprar algo no disponible).
  2. Si el body trae `expected_total` (el total que el frontend mostró) y no
     coincide con el recalculado (tolerancia $1), **409** con el desglose
     nuevo en `errors[0].quote` de la respuesta — usando el mecanismo que ya
     tenía `AppError`, sin tocar el middleware global de errores.
  3. Este refactor **eliminó ~90 líneas duplicadas** de `createStoreOrder`.
- **Frontend** (`StoreCheckoutPage.tsx`): `useQuery` (TanStack Query) que
  llama a `/checkout/quote` cada vez que cambian ítems, tipo de envío o
  cupón, y muestra ese desglose real (reemplaza el cálculo 100% cliente que
  nunca incluía el envío). Manda `expected_total` al confirmar. Si el
  backend devuelve 409, inyecta el desglose nuevo directo en la query cache
  (`queryClient.setQueryData`, sin round-trip extra) y avisa que hay que
  revisar y reconfirmar. Ítems no disponibles se listan con su motivo
  específico y bloquean el botón de confirmar. `StoreCartPage.tsx` no se
  tocó — no tiene `shipping_type` todavía, así que su mensaje genérico sigue
  siendo razonable.

**Tests:** nuevo `src/__tests__/api/checkout-quote.test.ts` (5 casos, con
`shipping_cost` configurado vía `PUT /settings` y restaurado al terminar):
subtotal/total correctos en retiro; envío incluido en el total para
delivery; ítem sin stock marcado `disponible:false` con motivo específico
sin frenar el resto; checkout con `expected_total` desincronizado → 409 con
el desglose nuevo; checkout con `expected_total` correcto → 201 normal.
Suite completa: **29/29 suites, 160/160 tests** (el test antes flaky pasó
esta vez también).

**Verificación manual en navegador:** levanté ambos dev servers y probé el
flujo real con Playwright (agregar al carrito → checkout → elegir envío a
domicilio). Confirmado visualmente: "Envío a domicilio" ya no dice
"Calculado al pagar"; el resumen muestra Subtotal $4.000 + Envío $1.500 =
Total $5.500 correctamente sumado; retiro en local muestra "Envío: Gratis".
Sin errores de consola.

**Verificación:** `npm run typecheck` (backend) y `npx tsc --noEmit` +
`eslint` (frontend, 2 archivos tocados) limpios — los 2 problemas de eslint
en `StoreCheckoutPage.tsx` son preexistentes (confirmado con `git diff`).

---

### 1.8 — Job de reconciliación de pagos

**Estado: Resuelto. Cierra la Fase 1 completa.**

- **Mecanismo elegido (confirmado por vos):** `node-cron` dentro del mismo
  proceso del backend — no agrega infraestructura nueva, Railway ya lo
  mantiene vivo 24/7.
- **`src/jobs/reconcilePayments.ts`** — cada 10 minutos: busca
  `StoreOrder` en `pending_payment` con `payment_method='mercadopago'`
  creados hace más de `RECONCILE_STALE_MINUTES` (default 5), y para cada
  uno llama a `confirmStorePayment({ orderNumber })` — la MISMA función que
  ya usa el retorno del cliente desde MP, así que no reimplementa nada:
  hereda gratis la idempotencia, la validación de monto/moneda y el
  descarte de eventos desordenados de 1.5. 5 min de gracia + 10 min de
  intervalo = un pago acreditado sin webhook se detecta en ≤15 min (cumple
  la aceptación tal cual). Un error en un pedido no frena el resto del lote.
- **`src/jobs/reportInconsistencies.ts`** — job diario (03:00): detecta
  pedidos `cancelled` sin `stock_restored_at` (nunca debería pasar dado el
  diseño de 1.3 — es red de seguridad) y pedidos con `mp_status='approved'`
  que se quedaron en `pending_payment` (nunca debería pasar dado 1.5). Por
  ahora solo `logger.error` estructurado — no hay bandeja de alertas de
  admin persistente todavía (B-7 de la auditoría, queda para Fase 3/4).
- **`src/jobs/scheduler.ts`** + enganche en `server.ts` (después de que el
  server empieza a escuchar). Desactivable con `RECONCILE_JOB_ENABLED=0`;
  siempre desactivado bajo test (`JEST_WORKER_ID`) para no interferir con
  la DB de los tests ni dejar timers colgados.
- Nueva dependencia: `node-cron` (instalada con `npm install`, no a mano).
- Env vars nuevas documentadas en `.env.example`:
  `RECONCILE_JOB_ENABLED` (default activo), `RECONCILE_STALE_MINUTES`
  (default 5).

**Hallazgo real durante el testing (no es un bug, es información):** el job
de inconsistencias, corrido contra la DB de dev, encontró **5 pedidos
cancelados reales sin stock restituido**: `ECOM-20260619-0001`,
`ECOM-20260621-0001`, `ECOM-20260621-0002`, `ECOM-20260622-0001`,
`ECOM-20260622-0002`. Son anteriores a que existiera la restitución
automática (1.3, implementada hoy), así que es exactamente el desvío
histórico que la auditoría original ya anticipaba ("el desvío histórico no
se puede reconstruir sin movimientos" — hallazgo C-1). Te lo dejo marcado
acá para que decidas si conviene un conteo físico / ajuste manual de esos 5
pedidos.

**Tests:** nuevo `src/__tests__/api/reconcile-payments.test.ts` (3 casos,
con `jest.spyOn` sobre `searchPaymentsByReference`, mismo patrón que
`webhook-robustness.test.ts`): un pedido viejo con pago ya aprobado en MP se
acredita solo; un pedido recién creado (dentro de la ventana de gracia) no
se toca ni gasta una llamada a MP; el reporte diario detecta un cancelado
sin restituir (verificado con los 5 casos reales de arriba + 1 inyectado
por el test). Suite completa: **30/30 suites, 163/163 tests.**

**Verificación:** `npm run typecheck` limpio. Además levanté el server real
(`npm run dev`) para confirmar que el scheduler arranca sin romper nada —
apareció el log `jobs.scheduler.started`. De paso until encontré y limpié
dos procesos de dev colgados de pruebas manuales anteriores (1.6) que
habían quedado escuchando en los puertos 3000 y 5173.

---

## Fase 1 — cierre

Los 9 hallazgos críticos con tarea propia en Fase 1 (1.1 a 1.10) están
resueltos en código. Quedan 2 cosas que dependen de vos, no de mí:

1. **Acción manual en Railway** (de la tarea 1.1): generar
   `MP_WEBHOOK_SECRET` en el panel de MercadoPago y setear esa variable +
   `BACKEND_PUBLIC_URL` en Railway **antes** de desplegar — el backend no
   arranca en producción sin ellas.
2. **Rotar credenciales** (de la tarea 1.9): las que estaban en `.env.bak`
   y en `Users.txt` (ver el detalle de cada una más arriba en este
   documento).

El resto del plan original (Fases 2, 3 y 4 — `store_payments`, estados
desacoplados, reserva de stock con vencimiento, devoluciones/reintegros,
`store_invoices`, integración con caja, reporte de conciliación, permisos
granulares, facturación electrónica) depende de decisiones de negocio que
todavía no se tomaron — quedan listadas en la sección 12 del documento de
auditoría original.

---

## Preguntas / decisiones pendientes de tu parte

1. Los 162 errores/11 warnings preexistentes de ESLint en `frontIndians`:
   confirmado que quedan para Fase 4.
2. Los 5 pedidos cancelados históricos sin stock restituido (ver 1.8 arriba,
   `ECOM-20260619-0001` y los otros 4): ¿los ajustamos a mano ahora, o los
   dejamos para cuando hagas el conteo físico?
3. **Fase 2** (`store_payments`, estados desacoplados, reserva de stock con
   vencimiento, devoluciones/reintegros, `store_invoices`, integración con
   caja, reporte de conciliación, permisos granulares, facturación
   electrónica) depende de las respuestas a la sección 12 del documento de
   auditoría original — ¿las charlamos ahora o seguimos con otra cosa
   primero?
