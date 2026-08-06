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
2. ~~Los 5 pedidos cancelados históricos sin stock restituido~~ — **resuelto
   2026-08-04**: eran clientes semilla de test (`@example.com`, coinciden
   con `Users.txt`), se borraron de la DB de dev (`DELETE` dentro de
   transacción, cascada correcta a `store_order_items`, sin movimientos de
   stock huérfanos — no tenían, son anteriores al ledger de 1.2).
3. ~~Fase 2 — respuestas a la sección 12~~ — **resuelto 2026-08-04**, ver
   sección siguiente.

---

## Fase 2 — decisiones de negocio (sección 12 de la auditoría original)

Respondidas por vos el 2026-08-04, verbatim:

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Facturación | Hoy no se factura por afuera del sistema. Ya existe un módulo de facturación con ARCA armado (branch `integracionarca`, sin mergear). Factura A no se emite hoy. |
| 2 | Momento de descuento de stock | **Reserva al crear + descuento al pagar** (alternativa "recomendada" del documento, no el descuento inmediato que implementó Fase 1). |
| 3 | Ventana de expiración de pedidos impagos | **48 hs, misma ventana para MercadoPago y transferencia** (no diferenciada por medio de pago). |
| 4 | Devoluciones | **Requiere revisión** (coincide con lo que ya implementa 1.3: el producto no vuelve solo al stock vendible). |
| 5 | Reintegros | **Se ejecutan desde MercadoPago manualmente** — no hace falta integrar la API de reintegros de MP. |
| 6 | Envíos | Hay que integrarse con **Andreani** (no alcanza con costo plano/zonificación simple). |
| 7 | Roles | **No hace falta** un rol operador separado — A-11 queda como está. |

**Nota importante sobre la pregunta 2:** esto es un cambio de diseño respecto
de lo que Fase 1 (tarea 1.2/1.3) implementó — hoy el stock se descuenta
inmediato al crear el pedido (`createStoreOrder` → `stockLedger.adjustStock`)
y se restituye solo si se cancela. Pasar a "reserva al crear + descuento al
pagar" es una tarea de Fase 2 todavía sin desglosar (implica una tabla/estado
de reserva con vencimiento — que además calza con la pregunta 3, la ventana
de 48hs).

### Hallazgo: el módulo de facturación AFIP/ARCA ya existe

Al investigar la pregunta 1, encontré que el módulo de facturación
electrónica AFIP/ARCA **ya está construido**, en un commit de la branch
`integracionarca` (backend: 23 archivos; frontend: 7 archivos), pero nunca
se mergeó a `fixauditoria` y la branch quedó ~5-6 semanas desactualizada. Te
propuse un plan de merge seguro (sin usar `git merge` real, para no arrastrar
historia no deseada) y confirmaste "arranca con eso".

**Estado: Resuelto (merge completo, pendiente tu OK para commitear).**

**Técnica usada:** simulación de merge de solo lectura (`git merge-tree
--write-tree`) para identificar qué archivos combinan limpio (extraídos con
`git show <tree>:<path>`) vs. cuáles tienen conflicto real; archivos que
`fixauditoria` nunca tocó desde la divergencia se adoptaron completos
(`git checkout integracionarca -- <path>`); los conflictos reales (4 en
backend, 2 en frontend) se resolvieron a mano. Nunca se hizo un merge real de
git ni se tocó ninguna rama/working tree existente.

**Backend — archivos nuevos:**
- `src/services/afip.service.ts` — WSAA (autenticación, firma CMS con
  `node-forge`) + WSFEv1 (autorización de comprobantes vía SOAP,
  `FECompUltimoAutorizado`/`FECAESolicitar`), cálculo de IVA, numeración
  correlativa. Exporta `sendInvoiceToAfip`, `sendCatalogInvoiceToAfip`,
  `sendStoreOrderToAfip`, `getAfipStats`.
- `src/controllers/afip.controller.ts` + `src/routes/afip.routes.ts` — 3
  endpoints de envío (`admin`/`billing`) + `GET /afip/stats`.
- `src/__tests__/api/afip.test.ts` — 6 casos, mockea `soap` por completo y
  genera su propio certificado self-signed en runtime (no requiere
  `AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` reales para testear). Cubre firma/
  parseo real, cálculo de IVA, numeración correlativa, persistencia de CAE,
  rechazo de AFIP → estado `error`, no reenvío si ya está enviado, 403 para
  vendedor.

**Backend — migraciones nuevas** (renumeradas de 050-054 a **074-078**,
fecha `20260804`, para no romper la convención de numeración monótona del
proyecto — no hay colisión funcional real, `sequelize-cli` ordena por nombre
completo incluida la fecha, pero mezclar dos series "050" distintas hubiera
sido confuso de leer). Cada una con guarda `describeTable`/`if (!table.x)`
que las originales de `integracionarca` no tenían:
- `20260804-074-add-condicion-iva-to-clients.js`
- `20260804-075-add-afip-to-invoices.js`
- `20260804-076-add-afip-to-catalog-invoices.js`
- `20260804-077-add-afip-to-store-orders.js`
- `20260804-078-seed-afip-settings.js` (siembra `afip_enabled=false`,
  `afip_environment=homo`, `afip_punto_venta=''`, `afip_concepto_default=1`
  con `INSERT IGNORE`, no pisa configuración existente)

**Backend — archivos modificados:**
- `src/models/StoreOrder.ts`, `src/routes/index.ts`,
  `src/services/catalog.service.ts` — combinados desde el árbol de merge
  simulado (conservan intactas las adiciones de Fase 1: `stock_restored_at`,
  `idempotency_key`, `mp_payment_date`, el refactor del ledger).
- `src/models/Client.ts`, `src/models/Invoice.ts`,
  `src/models/CatalogInvoice.ts`, `src/services/invoice.service.ts`,
  `seeders/create-admin.ts`, `seeders/sellers.ts`, `seeders/index.ts` —
  adoptados completos de `integracionarca` (confirmado que `fixauditoria`
  nunca los tocó desde la divergencia).
- `src/services/settings.service.ts` — agregadas las 4 claves AFIP a
  `VALID_KEYS`.
- `src/services/order.service.ts` — **fix bundleado en el mismo commit de
  origen, no específico de AFIP, portado igual por ser pequeño y de mismo
  patrón que ya existe:** `generateOrderNumber()` pasó de `COUNT` a
  `MAX`-de-existentes + reintento (`MAX_ORDER_ATTEMPTS = 5` capturando
  `UniqueConstraintError`), mismo patrón que ya usaba `store.service.ts`
  para los números `ECOM-`. Corrige una condición de carrera real en la
  numeración de pedidos internos (`PED-`).
- `.env.example` — sección nueva documentando `AFIP_CERT_BASE64`/
  `AFIP_KEY_BASE64` y qué se configura en Settings en vez de en variables de
  entorno.
- `package.json`/`package-lock.json` — nuevas dependencias `soap`,
  `node-forge`, `@types/node-forge` (vía `npm install`, no a mano).

**Frontend — archivos nuevos:** `src/api/afip.ts`,
`src/components/afip/AfipButton.tsx`, `src/components/afip/AfipSendModal.tsx`.

**Frontend — archivos modificados:**
- `src/pages/admin/DashboardPage.tsx`, `src/pages/billing/InvoicesPage.tsx` —
  combinados desde el árbol de merge simulado (auto-merge limpio).
- `src/types/index.ts` — conflicto real resuelto a mano (la rama
  `fixauditoria` había agregado campos propios de costos/marca/settings en
  las mismas zonas del archivo desde la divergencia): tipos nuevos
  `AfipStatus`/`AfipFields`/`AfipSendParams`/`AfipStats`; `Client` con
  `condicion_iva`; `Invoice`/`CatalogInvoice extends AfipFields`;
  `CompanySettings` con los 4 campos AFIP; el `client` inline de
  `CatalogInvoice.order` con `cuit`/`condicion_iva`.
- `src/api/store.ts` — `StoreOrder extends AfipFields` (para que
  `InvoicesPage.tsx` no necesitara castear `as any` para leer
  `afip_status`/`afip_cae`/etc. del pedido de tienda).
- `src/pages/admin/SettingsPage.tsx` — conflicto real resuelto a mano: el
  form único existente (que ya tenía más campos que la versión base de
  `integracionarca` — `company_website`, `invoice_point_of_sale`, etc., de
  la feature de "modelo de factura" de Fase 1/previa) se separó en dos
  forms independientes con `react-hook-form` namespaced (`company.*` /
  `afip.*`, cada uno con su propio submit y mutation), preservando todos los
  campos de empresa existentes y agregando la tarjeta nueva "Facturación
  electrónica AFIP / ARCA" (habilitada, ambiente homo/prod, punto de venta,
  concepto por defecto) tal como la tenía `integracionarca`.
- Se corrigieron `any` implícitos que trajo el port (`AfipSendModal.tsx`,
  `InvoicesPage.tsx`) tipando correctamente en vez de castear — los `any`
  preexistentes de `DashboardPage.tsx` (imports sin usar, tooltips de
  Recharts) no se tocaron por ser deuda previa no relacionada.

**Verificación:**
- Backend: `npm run typecheck` limpio. Suite completa **31/31 suites,
  169/169 tests**, incluyendo los 6 nuevos de `afip.test.ts`. Columnas AFIP
  confirmadas presentes en `store_orders`/`invoices`/`catalog_invoices`/
  `clients` de la DB de dev (sync automático al levantar el server una vez).
- Frontend: `npx tsc --noEmit` limpio. `npx eslint` sobre todos los archivos
  tocados por este merge: 0 errores (excepto `DashboardPage.tsx`, con deuda
  preexistente no introducida por este cambio, confirmada comparando contra
  `HEAD`).
- **Verificación manual en navegador** (Playwright, admin logueado): página
  de Configuración muestra la tarjeta AFIP nueva debajo de Datos de la
  empresa, con todos los campos previos intactos. Dashboard muestra la
  tarjeta "Facturación electrónica AFIP" con totales agregados. Facturas
  muestra el botón AFIP por fila reflejando el estado real (pendiente/
  reintentar/enviado con nro. de comprobante) y el modal "Enviar a AFIP" abre
  correctamente prellenado con CUIT/condición IVA del cliente. Cero errores
  de consola en las 3 pantallas.

**Pendiente:** nada de este trabajo está commiteado todavía (backend ni
frontend) — falta tu OK explícito para commitear, como es la norma en este
proyecto. Además, el módulo solo queda **disponible**, no habilitado
(`afip_enabled=false` por default) — activarlo en producción requiere además
configurar `AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` (certificado real de ARCA) y
`company_cuit`, que son acciones tuyas.

### Fase 2 — desglose de tareas

| Tarea | Depende de | Estado |
|---|---|---|
| 2.1 | 1.2 | **Resuelto** — ver detalle abajo. |
| 2.2 | 2.1 | **Resuelto** — ver detalle abajo. |
| 2.3 | — | **Resuelto** — ver detalle abajo. |
| 2.4 | 2.1 | **Resuelto** — ver detalle abajo. |
| 2.5 | Merge AFIP (resuelto) | **Resuelto (código) — falta certificado real, acción tuya** — ver detalle abajo. |
| 2.6 | — | Pendiente (necesita research spike). |
| 2.7 | 2.1, 2.3 | **Resuelto** — ver detalle abajo. |
| 2.8 | — | **Resuelto** — ver detalle abajo. |

---

### 2.1 — Reserva de stock con vencimiento

**Estado: Resuelto.**

Implementa la decisión de negocio #2 ("reserva al crear + descuento al
pagar") — reemplaza el modelo de descuento inmediato que había implementado
Fase 1 (tareas 1.2/1.3).

**Diseño confirmado con el usuario antes de implementar:** no se creó una
entidad `store_payments` separada (la sugería el plan original de la
auditoría) — se resolvió con columnas nuevas en `store_orders`
(`stock_reserved_at`, `stock_confirmed_at`) + un contador `stock_reserved`
en `catalog_products`/`catalog_product_sizes`. Más simple, reutiliza el
ledger existente (1.2) y el patrón de idempotencia por columna que ya usaba
1.3 (`stock_restored_at`).

- **Migraciones** `20260804-079/080` (columna `stock_reserved` en
  `catalog_products`/`catalog_product_sizes`, default 0), `081`
  (`store_orders.stock_reserved_at`/`stock_confirmed_at`), `082` (backfill:
  pedidos históricos anteriores a 2.1 se marcan `stock_confirmed_at =
  createdAt` — bajo el modelo viejo TODO pedido creado ya había descontado
  stock real de verdad, nunca hubo una reserva intermedia; sin este backfill,
  `restoreStoreOrderStock` los trataría erróneamente como "solo reservados"),
  `083` (agrega `'reserve'`/`'release'` al ENUM de `catalog_stock_movements.type`).
- **`stockLedger.service.ts`**: `adjustStock()` gana un parámetro `field`
  (`'stock_quantity'` default, o `'stock_reserved'`). Para `stock_reserved`
  con `requireAvailable`, valida que la reserva no supere el stock físico
  real (en vez de solo chequear negatividad) — mismo lock de fila, misma
  transacción del caller, mismo movimiento auditable.
- **`createStoreOrder`**: el loop que antes descontaba `stock_quantity`
  (`type:'sale'`) ahora reserva (`type:'reserve', field:'stock_reserved'`).
  Se guarda `stock_reserved_at` en el pedido.
- **`confirmStoreOrderStock`** (nueva función, mismo patrón que
  `restoreStoreOrderStock`): convierte la reserva en descuento definitivo —
  libera `stock_reserved` (`type:'release'`) y descuenta `stock_quantity`
  real (`type:'sale'`) en dos movimientos separados dentro de la misma
  transacción. Idempotente por `stock_confirmed_at`. Enganchada en
  `recordStoreOrderStatusChange`: se dispara al salir de `pending_payment`
  hacia cualquier estado que no sea `cancelled` (no solo `newStatus==='paid'`
  — cubre también que el admin salte directo a `processing` con un pago en
  efectivo/transferencia confirmado a mano). Cubre los 3 caminos existentes
  sin cambios adicionales: webhook de MP, reconciliación (1.8) y cambio
  manual del admin — los tres pasan por `recordStoreOrderStatusChange`.
- **`restoreStoreOrderStock`** (1.3) ahora bifurca según
  `stock_confirmed_at`: si el pago ya se había confirmado, restituye stock
  real (comportamiento de 1.3 sin cambios); si no, libera la reserva sin
  tocar `stock_quantity`. Se extrajo `resolveStoreOrderItemSize()` como
  helper compartido con `confirmStoreOrderStock` para no duplicar la
  resolución de talle (FK directo de 1.10, o fallback por texto).
- **`computeOrderTotals`** (checkout + quote de 1.6): el chequeo de
  disponibilidad pasa de `stock_quantity < cantidad` a `(stock_quantity -
  stock_reserved) < cantidad` — cierra el hueco de sobreventa entre carritos
  concurrentes que dejaba abierto el modelo de Fase 1. Mismo cambio en el
  filtro de talles de `computeStoreFilterOptions`.
- **API pública de la tienda** (`listStoreProducts`/`getStoreProduct`):
  ahora exponen `stock_reserved` junto a `stock_quantity` en las tallas (ya
  se exponía sin querer a nivel producto, por no tener `attributes`
  restringido). No se usa todavía en el front de la tienda — ver exclusión
  abajo.

**Exclusión documentada (a propósito, mismo criterio que las de 1.2):** el
frontend de la tienda (`StoreProductDetailPage.tsx`, `ProductCard.tsx`)
sigue mostrando `stock_quantity` física, no `stock_quantity - stock_reserved`
— un comprador puede ver "5 en stock" con 3 ya reservadas por otros
carritos. **No es un hueco de seguridad**: el checkout real y el quote
(`/checkout/quote`, 1.6) sí usan la disponibilidad correcta y rechazan con
400 si no alcanza — el comprador nunca paga de más ni compra algo
inexistente, solo puede ver un cartel optimista hasta que confirma. Corregir
la vitrina es UX (queda para 3.1 de la auditoría original, "aviso de cambios
de disponibilidad").

**`saveProductSizes` (admin, edita talles de un producto) — mismo hueco ya
documentado en 1.2:** destruye y recrea las filas de `catalog_product_sizes`
en cada guardado, lo que también resetea `stock_reserved` a 0 si el admin
edita talles con reservas activas. No se tocó (mismo criterio de alcance que
1.2: el rediseño de esa función es un cambio de mayor riesgo, no específico
de esta tarea).

**Tests:** nuevo `src/__tests__/api/stock-reservation.test.ts` (4 casos): el
checkout reserva sin tocar `stock_quantity`; confirmar el pago libera la
reserva y descuenta stock real (movimientos `reserve→release→sale` en
orden); cancelar antes de pagar libera la reserva sin tocar `stock_quantity`;
un checkout que supera lo disponible (ya reservado por otro pedido) responde
400 aunque `stock_quantity` física siga siendo positiva. Se actualizaron
además los tests existentes que asumían el descuento inmediato de Fase 1
(`stock-restoration.test.ts`, `store-order-item-size-id.test.ts`,
`checkout-idempotency.test.ts`, `stock-ledger.test.ts`) para reflejar el
nuevo modelo — y se corrigió el helper `findPurchasable()` (usado por varios
tests de otras tareas) para que elija productos por disponibilidad real
(`stock_quantity - stock_reserved`), no por `stock_quantity` física, porque
reservas sin confirmar/cancelar de otros tests de la misma corrida podían
dejar productos sin nada disponible aunque su stock físico siguiera
positivo. Suite completa: **32/32 suites, 173/173 tests.**

**Verificación:** `npm run typecheck` limpio. Columnas y ENUM nuevo
confirmados en la DB de dev (`npm run dev` una vez + `describeTable`).

---

### 2.2 — Expiración automática de pedidos impagos a 48hs

**Estado: Resuelto.**

Implementa la decisión de negocio #3 ("48hs, mismo tiempo para MercadoPago y
transferencia"), sobre la reserva de stock de 2.1.

- **`src/jobs/expireStaleOrders.ts`** (nuevo, mismo patrón que
  `reconcilePayments.ts`/`reportInconsistencies.ts` de 1.8): busca pedidos
  `pending_payment` con `createdAt` de más de `ORDER_EXPIRY_HOURS` (default
  48) y los cancela vía `recordStoreOrderStatusChange(..., 'cancelled')` —
  no reimplementa nada: hereda gratis la liberación de la reserva de stock
  (2.1, `restoreStoreOrderStock`), la liberación del cupón y el mail
  "cancelado" al comprador (la plantilla ya existía). Un error en un pedido
  no frena el resto del lote.
- **Enganchado en `src/jobs/scheduler.ts`**: corre cada hora (`0 * * * *`) —
  con una ventana de 48hs no hace falta más frecuencia que los 10 min de
  `reconcilePendingPayments`.
- **`ORDER_EXPIRY_HOURS`** nueva env var en `.env.example` (default 48).

**Dos exclusiones de diseño, no pedidas explícitamente pero necesarias para
no cancelar pedidos que en los hechos están bien** (mismo criterio que las
decisiones no obvias de 1.5/1.6 — documentadas, no asumidas en silencio):

1. **Efectivo queda afuera.** La pregunta original de la auditoría
   (sección 12, #3) comparaba MercadoPago vs. transferencia — efectivo
   implica pago/retiro en persona, un perfil de riesgo distinto a "pago
   online abandonado". No tiene sentido cancelarlo solo por tiempo.
2. **Transferencia con comprobante ya subido (`payment_proof_url`) queda
   afuera.** El comprador ya hizo su parte (subió el comprobante); lo único
   que falta es que un admin lo revise y confirme. Cancelarlo automáticamente
   cancelaría un pedido que en los hechos puede estar pagado. Sin
   comprobante subido, expira igual que MercadoPago (nunca llegó a intentar
   pagar). Un pedido de transferencia "colgado" esperando revisión por mucho
   tiempo es candidato para el reporte de conciliación de 2.7, no para
   cancelación automática.

**Tests:** nuevo `src/__tests__/api/expire-stale-orders.test.ts` (5 casos):
MercadoPago vencido se cancela y libera la reserva; transferencia vencida
sin comprobante se cancela igual; transferencia vencida CON comprobante NO
se cancela (reserva sigue en pie); efectivo no expira nunca automáticamente;
un pedido reciente (dentro de la ventana) no se toca. Suite completa:
**33/33 suites, 178/178 tests.**

**Verificación:** `npm run typecheck` limpio. Levanté el server real
(`npm run dev`) para confirmar que el scheduler arranca sin romper nada —
apareció el log `jobs.scheduler.started` mencionando los 3 jobs (10 min /
1 hora / diario 03:00).

---

### 2.3 — Conectar la tienda a caja

**Estado: Resuelto.**

Cierra la parte de cobros de C-7 ("La tienda online está desconectada de
caja, facturación y reportes administrativos"): al confirmarse el pago de un
pedido de tienda (mismo disparador de 2.1 — salir de `pending_payment` hacia
cualquier estado no cancelado), se registra automáticamente el ingreso en
`cash_transactions`.

**Dos puntos de diseño reales que aparecieron al implementar, resueltos con
el usuario antes de escribir código** (pregunta explícita vía opción
múltiple, eligió la recomendada):
1. **`cash_transactions.created_by` es NOT NULL**, pero no hay ningún admin
   humano detrás de una confirmación automática (webhook de MP, job de
   reconciliación/expiración). Se resolvió creando un usuario **"Sistema"**
   seedeado (migración 084, `active:false`, password inutilizable — nunca
   puede loguearse, solo existe como ancla de FK). Si un admin confirmó el
   pago a mano, se le atribuye a él/ella; si fue automático, al usuario
   Sistema.
2. **No existía ninguna cuenta de caja marcada como "la de la tienda
   online".** Se resolvió con un setting nuevo `store_cash_account_id`
   (Configuración → Tienda online → sección "Caja") — UNA sola cuenta para
   MercadoPago, efectivo y transferencia juntos (no una por método de pago,
   para no pedirle al usuario configurar de más sin que lo haya pedido).

**Backend:**
- **Migraciones**: `084` (usuario Sistema), `085` (categoría del sistema
  "Ventas tienda online", `is_system:true`, income), `086` (agrega
  `'store_order'` al ENUM `cash_transactions.reference_type`), `087`
  (`store_orders.cash_recorded_at`, idempotencia — separada de
  `stock_confirmed_at` a propósito: si falla por falta de cuenta configurada,
  un reintento futuro no depende de que el stock, que sí se confirmó bien,
  se vuelva a tocar).
- **`cash.service.ts`**: se extrajo `createTransactionCore()` (validación +
  efecto en saldo + insert) de `createTransaction()`, y se agregó
  `createSystemTransaction()` — misma lógica, pero requiere una transacción
  externa en vez de abrir la propia (mismo patrón que `stockLedger.
  adjustStock`), para que la carga en caja sea atómica con la confirmación
  del pago, no un efecto secundario best-effort tipo mail.
- **`store.service.ts`**: `recordStoreOrderCashIncome()` (privada, misma
  forma que `confirmStoreOrderStock`/`restoreStoreOrderStock`) — si
  `store_cash_account_id` no está configurado, **no bloquea la confirmación
  del pago** (la plata ya se cobró; el asiento es una consecuencia
  administrativa), solo loguea un warning. Enganchada en
  `recordStoreOrderStatusChange` junto a `confirmStoreOrderStock`.
- **`settings.service.ts`**: `store_cash_account_id` agregado a
  `VALID_KEYS`.

**Frontend**: nueva sección "Caja" en `EcommerceSettingsPage.tsx` (Select
poblado con `GET /cash/accounts`), placeholder "Sin configurar — no se
registran ingresos automáticos" cuando no hay nada seteado.

**Tests:** nuevo `src/__tests__/api/store-cash-income.test.ts` (3 casos):
admin marca un pedido en efectivo como pagado a mano → ingreso creado,
atribuido a él; pago confirmado automáticamente (mock de
`searchPaymentsByReference`, mismo patrón que `reconcile-payments.test.ts`)
→ atribuido al usuario Sistema; sin cuenta configurada → el pago se confirma
igual, sin crear ningún asiento. Suite completa: **34/34 suites,
181/181 tests.**

**Verificación:** `npm run typecheck` (backend) y `npx tsc --noEmit` +
`eslint` (frontend, archivo tocado) limpios — el único warning de eslint en
`EcommerceSettingsPage.tsx` es preexistente (confirmado con `git stash`).
Verificación manual en navegador (Playwright): la sección "Caja" aparece en
Configuración → Tienda online con el Select y el placeholder correctos, cero
errores de consola.

---

### 2.4 — Circuito de devoluciones con revisión

**Estado: Resuelto.**

Implementa la decisión de negocio #4 ("requiere revisión, nunca automático")
y deja una base informativa para la #5 (reintegros manuales desde MP).

**Tres puntos de diseño confirmados con el usuario antes de implementar**
(vía pregunta de opción múltiple, eligió las 3 recomendadas):
1. **Quién inicia la devolución**: solo el admin desde el panel — sin
   autoservicio para el comprador en esta tarea (no se tocó la tienda
   pública ni el seguimiento).
2. **El botón genérico que pasaba un pedido directo a "Devuelto" con un
   click** (vía `STORE_ORDER_TRANSITIONS`, sin motivo ni detalle de ítems)
   se **reemplazó** por el flujo nuevo — `delivered`/`shipped` ya no listan
   `returned` como transición genérica, tanto en el backend
   (`storeOrderFlow.ts`) como en su espejo del frontend (`api/store.ts` —
   **hallazgo del testing**: hay una copia duplicada de
   `STORE_ORDER_TRANSITIONS` en el frontend, deuda ya anotada en la
   auditoría original como 4.2 "unificar configuración de estados
   backend/frontend", pendiente).
3. **La revisión es por ítem**: cada línea devuelta se marca
   `resellable`/`not_resellable` individualmente, no una decisión única para
   toda la devolución.

**Backend:**
- **Migraciones** `088` (`store_returns`: status pending_review/approved/
  rejected, reason, refund_status none/pending/refunded + monto/fecha,
  requested_by/reviewed_by/reviewed_at/review_notes) y `089`
  (`store_return_items`: store_return_id, store_order_item_id, quantity,
  condition nullable hasta revisar, restocked_at de idempotencia).
- **`storeReturns.service.ts`** (nuevo, no se agregó a `store.service.ts`
  para no seguir haciendo crecer ese archivo ya señalado como candidato a
  split en 4.1): `createStoreReturn` (valida que el pedido esté `delivered`
  y que los ítems/cantidades sean válidos contra el pedido, transiciona a
  `returned` reusando `recordStoreOrderStatusChange` con
  `enforceTransition:false`), `reviewStoreReturn` (por ítem: `resellable` →
  movimiento `return` del ledger — tipo que existía en el ENUM desde 1.2 sin
  usar hasta ahora — `not_resellable` → sin efecto en stock; idempotente por
  lock de fila + chequeo de `status==='pending_review'`),
  `updateStoreReturnRefund` (solo actualiza el campo informativo, nunca
  llama a MercadoPago).
- **`store.service.ts`**: se exportó `resolveStoreOrderItemSize` (ya
  existía, privada) para reutilizarla en `storeReturns.service.ts` sin
  duplicar la resolución de talle (FK directo de 1.10 o fallback por
  `size_name`).
- **Endpoints** (`admin`/`billing`): `GET /store/admin/returns` (lista,
  filtra por `status` y `order_id`), `GET /store/admin/returns/:id`,
  `POST /store/admin/orders/:id/returns`, `PATCH /store/admin/returns/:id/review`,
  `PATCH /store/admin/returns/:id/refund`.

**Frontend:**
- **`StoreReturnManager.tsx`** (nuevo componente): reemplaza el botón
  "Devuelto" en el detalle del pedido — muestra las devoluciones existentes,
  botón "Registrar devolución" (solo si `status==='delivered'`) con
  selector de cantidad por ítem, y modal de revisión con toggle
  Revendible/No revendible por ítem + sección de reintegro (solo
  informativa, con aviso explícito de que no dispara nada externo).
- **`api/store.ts`**: tipos `StoreReturn`/`StoreReturnItem` + métodos
  `storeAdminApi.returns.*`. **Bug encontrado y corregido durante el
  testing en navegador**: el endpoint de listado devuelve `meta` (paginado)
  — el interceptor de axios ya transforma esa respuesta a
  `PaginatedResponse<T>`, pero el tipo declarado era `StoreReturn[]` directo;
  tipeaba bien pero en runtime `r.data` era `{data, total, page, ...}`, no
  el array — la lista de devoluciones quedaba silenciosamente vacía. Se
  corrigió a `PaginatedResponse<StoreReturn>` + `.then(r => r.data.data)`.
- **`EcommerceOrdersPage.tsx`**: embebe `<StoreReturnManager>` en el detalle
  del pedido. Como crear una devolución cambia el `status` del pedido pero
  la respuesta de esa llamada no devuelve el pedido actualizado, se agregó
  un callback `onOrderUpdated` que refresca el `detail` local con
  `storeAdminApi.orders.getById` — si no, la sección "Cambiar estado" seguía
  mostrando las transiciones válidas para el estado viejo hasta cerrar y
  reabrir el modal.

**Tests:** nuevo `src/__tests__/api/store-returns.test.ts` (7 casos):
registrar una devolución pasa el pedido a `returned` sin tocar stock;
aprobar con ítem `resellable` restituye stock real (movimiento `return`);
aprobar con `not_resellable` no restituye; rechazar no toca stock; no se
puede devolver un pedido no entregado (409); el endpoint genérico ya no
permite pasar directo a `returned` (409); actualizar `refund_status` es
puramente informativo. Se actualizó `store-transitions.test.ts` (esperaba
`shipped/delivered → returned` válidas, ahora `false`). Suite completa:
**35/35 suites, 189/189 tests** (más el flaky preexistente de siempre,
`factory-garment-types.test.ts`, reconfirmado en aislado).

**Verificación:** `npm run typecheck` (backend) y `npx tsc --noEmit` +
`eslint` (frontend, archivos nuevos/tocados) limpios — los 3 errores de
`EcommerceOrdersPage.tsx` son preexistentes (confirmado con `git stash`).
Verificación manual end-to-end en navegador (Playwright): pedido llevado por
API hasta `delivered`, devolución registrada desde la UI real, revisada y
aprobada con un ítem marcado revendible — stock, badges de estado, historial
y reintegro se vieron correctos en cada paso, cero errores de consola. El
bug del `PaginatedResponse` se encontró y corrigió durante esta verificación
(la lista de devoluciones aparecía vacía hasta el fix).

---

### 2.5 — Activar facturación AFIP en pedidos de tienda

**Estado: Resuelto en lo que depende de código — el resto requiere acción
manual tuya (certificado real de ARCA).**

El módulo AFIP ya estaba mergeado desde antes de Fase 2 (ver hallazgo en
[project-tienda-fase2-decisiones]) con envío manual funcionando (botón en
Facturas → pestaña Tienda Online). Al investigar qué faltaba para
"activarlo" encontré un bug de seguridad real, no solo trabajo pendiente:

**Hallazgo: el toggle "Habilitada/Deshabilitada" de Configuración → AFIP no
hacía nada.** Ningún punto del código chequeaba `afip_enabled` antes de
mandar una factura real a ARCA — un admin podía dejarlo "deshabilitado" en
la UI y el botón de envío igual mandaba comprobantes reales si el
certificado estuviera cargado. Se corrigió sin preguntar (bug de seguridad
obvio, no una decisión de negocio): `assertAfipEnabled()` corta ANTES de
tocar el registro (ni siquiera lo marca `afip_status:'error'` — deshabilitado
significa deshabilitado, no "intento fallido") en los 3 puntos de envío
(`sendInvoiceToAfip`, `sendCatalogInvoiceToAfip`, `sendStoreOrderToAfip`,
todos comparten el núcleo `sendToAfip`).

**Decisión de negocio confirmada con el usuario**: el envío a AFIP de
pedidos de tienda **sigue siendo manual** (no automático al confirmarse el
pago) — más seguro mientras el certificado real todavía está en trámite en
ARCA y no hubo pruebas en producción. Queda documentado para reconsiderar
más adelante si se quiere automatizar (mismo patrón de enganche que
`confirmStoreOrderStock`/`recordStoreOrderCashIncome` en
`recordStoreOrderStatusChange`, no implementado a propósito).

**Backend:** `src/services/afip.service.ts` — nueva función
`assertAfipEnabled()`, llamada al inicio de las 3 funciones públicas de
envío.

**Tests:** `afip.test.ts` — se agregó `afip_enabled:'true'` al `beforeAll`
(si no, los 6 casos existentes hubieran empezado a fallar con el nuevo
gate) y un caso nuevo (7): con `afip_enabled:'false'`, el envío se rechaza
(422, mensaje claro), el registro NO queda marcado `afip_status:'error'`
(sigue `null`) y no se llegó a llamar al mock de `soap` (verificado contando
`loginCalls`). Suite completa: **35/35 suites, 190/190 tests.**

**No se tocó el frontend a propósito**: el botón AFIP ya muestra el mensaje
de error claro vía toast cuando el envío falla (incluido "deshabilitada"
ahora); no se agregó un chequeo preventivo que deshabilite el botón antes de
hacer el click (requeriría traer el setting `afip_enabled` a cada fila de
las 3 pestañas de Facturas) — el backoff es aceptable, un click de más con
un toast claro no amerita esa complejidad extra en esta tarea.

**Pendiente — acción tuya, no de código:**
1. Completar el trámite de certificado en ARCA (autogestión de
   certificados) y cargar `AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` en Railway.
2. Configurar `company_cuit` (ya existe como setting) y `afip_punto_venta`
   con los datos reales.
3. Recién ahí activar el toggle `afip_enabled` en Configuración — hasta
   entonces, aunque se active, cualquier envío va a fallar con "company_cuit
   no configurado" o similar (validación que ya existía).

**Verificación:** `npm run typecheck` limpio. Server real levantado
(`npm run dev`) sin errores.

---

### 2.7 — Reporte de conciliación ampliado

**Estado: Resuelto.**

El documento de auditoría original menciona "las 8 anomalías del punto 15
del pedido" — esa numeración pertenece al prompt original que generó el
diagnóstico, no a un archivo al que tengo acceso hoy. En vez de adivinar esa
lista, diseñé las 4 detecciones nuevas directamente a partir de lo que
efectivamente se construyó en 2.1-2.5 y que puede desincronizarse en
producción — cada una verificable contra código real, no contra una
referencia que no puedo confirmar.

Extiende `src/jobs/reportInconsistencies.ts` (1.8, job diario 03:00) con 4
chequeos nuevos, mismo criterio que los 2 originales (son estados que NUNCA
deberían pasar por el flujo normal — señal de un bug o un job caído, no un
flujo esperado):

1. **Reservas de stock vencidas sin liberar** (2.1/2.2): pedido
   `pending_payment` con `stock_reserved_at` de más del doble de
   `ORDER_EXPIRY_HOURS` — indica que `expireStaleOrders` (2.2, corre cada
   hora) dejó de correr o está fallando en silencio.
2. **Pedidos pagados sin registro en caja** (2.3): `stock_confirmed_at` no
   nulo pero `cash_recorded_at` nulo. No es necesariamente un bug de código
   — la causa más probable es que falte configurar
   `store_cash_account_id` — pero es plata que hoy no aparece en la
   conciliación, vale que el admin lo sepa.
3. **Comprobantes con envío a AFIP en error** (2.5): cuenta
   `afip_status='error'` en facturas de pedidos, de catálogo y pedidos de
   tienda juntos — señala qué necesita un "Reintentar AFIP" manual.
4. **Devoluciones aprobadas hace más de 7 días sin actualizar el
   reintegro** (2.4): `StoreReturn.status='approved'` +
   `refund_status='none'` con `reviewed_at` viejo — el reintegro se hace
   manual desde MercadoPago (decisión #5), esto solo avisa que quedó sin
   seguimiento, no dispara nada.

**Tests:** nuevo `src/__tests__/api/report-inconsistencies-2-7.test.ts` (5
casos): detecta una reserva vencida sin expirar; detecta un pedido pagado
sin caja; detecta una factura con `afip_status='error'` (fixture propio,
sin mockear `soap` — no hace falta, solo se lee el estado ya persistido);
detecta una devolución aprobada hace 10 días sin reintegro; una devolución
aprobada HOY no se marca (verificado contra la misma condición que usa el
job). **Bug propio encontrado al escribir el fixture**: `orders.order_number`
es `STRING(20)` — mi primer intento de número de orden (`QA-CONC-<timestamp>`,
21 caracteres) lo excedía y tiraba un error de MySQL; corregido con el mismo
patrón compacto (`toString(36)`) que ya usaba `afip.test.ts`. Suite completa:
**36/36 suites, 195/195 tests.**

**Verificación:** `npm run typecheck` limpio. Server real levantado
(`npm run dev`) sin errores.

---

### 2.8 — Cupón: 1 uso por cliente

**Estado: Resuelto. Cierra el desglose original de Fase 2 (2.1 a 2.8) —
queda pendiente 2.6 (Andreani, research spike) sin arrancar.**

Se suma al `max_uses` global que ya existía (límite total de usos del
cupón, sin importar quién): ahora, además, ningún cliente puede usar el
mismo cupón dos veces.

- **`hasCustomerUsedCoupon()`** (nueva, en `store.service.ts`): identifica
  al comprador por `customer_id` si está logueado, si no por
  `customer_email` (el checkout de invitado siempre lo manda). Un pedido
  `cancelled` no cuenta como "usado" — mismo criterio que ya usa
  `restoreStoreOrderStock` (1.3) para liberar el `used_count` global al
  cancelar.
- **`validateCoupon()`** gana 2 parámetros opcionales (`customerId`,
  `customerEmail`) y el chequeo nuevo. Sin ninguno de los dos (quote
  anónimo) no se puede chequear — se resuelve en el checkout real, que
  siempre tiene identidad (backend decide, mismo principio de 1.6).
- **`computeOrderTotals`/`getCheckoutQuote`/`createStoreOrder`**: se hizo
  pasar la identidad del comprador a través de toda la cadena.
- **Rutas `/store/coupons/validate` y `/store/checkout/quote`** ganaron
  `optionalStoreAuth` (mismo middleware que ya usa `/checkout`) para que un
  comprador logueado vea el rechazo ya en el paso de aplicar el cupón (antes
  de llegar a confirmar) — sin este cambio, esas dos rutas eran 100%
  anónimas y no había forma de saber quién es el comprador logueado hasta
  el checkout real. No hizo falta tocar el frontend: `storeApi` ya manda el
  JWT del comprador en cada request si existe sesión.
- **Frontend: no se tocó nada.** Verificado por inspección que el
  interceptor de error de `storeApi` (`api/store.ts`) ya extrae
  `err.response.data.message` y arma un `Error` real — el mensaje nuevo
  ("Ya usaste este cupón antes...") se muestra en el toast existente sin
  cambios de código.

**Tests:** nuevo `src/__tests__/api/coupon-per-customer.test.ts` (4 casos):
un invitado usa el cupón una vez, un segundo pedido con el mismo email lo
rechaza; un email distinto sí puede usarlo; un pedido cancelado no cuenta
como "usado" (el cliente puede volver a usarlo); un comprador logueado
(JWT minteado directo con `STORE_JWT_SECRET`, sin pasar por el flujo de
registro/verificación de email para no complicar el fixture) — el rechazo
se detecta por `customer_id` incluso en `/coupons/validate` sin mandar el
email en el body, gracias al `optionalStoreAuth` nuevo. Suite completa:
**37/37 suites, 199/199 tests.**

**Verificación:** `npm run typecheck` limpio.

---

## Fase 2 — cierre

El desglose completo de Fase 2 (2.1 a 2.8) está resuelto, con la única
excepción de **2.6 (integración con Andreani)**, que sigue sin arrancar
porque necesita un research spike de su API (cotización, generación de
etiqueta, tracking, credenciales) antes de poder desglosarse en tareas
concretas — sigue pendiente de que decidas cuándo encararlo.

### Qué quedó funcionando

- **Reserva de stock con vencimiento** (2.1): el checkout reserva, no
  descuenta stock real hasta que se confirma el pago.
- **Expiración automática a 48hs** (2.2): job por hora, misma ventana para
  MercadoPago y transferencia; efectivo y transferencias con comprobante ya
  subido no expiran solas.
- **Conexión con caja** (2.3): ingreso automático al confirmarse el pago,
  usuario "Sistema" para confirmaciones sin admin humano detrás.
- **Devoluciones con revisión por ítem** (2.4): reemplaza el click directo a
  "Devuelto"; solo lo marcado revendible vuelve al stock.
- **Facturación AFIP/ARCA mergeada y con gate de seguridad real** (merge +
  2.5): módulo completo disponible, envío manual, más el fix del toggle
  `afip_enabled` que no bloqueaba nada.
- **Reporte de conciliación ampliado** (2.7): detecta reservas vencidas sin
  liberar, pedidos pagados sin caja, comprobantes AFIP en error y
  devoluciones sin seguimiento de reintegro.
- **Cupón 1 uso por cliente** (2.8): además del límite global que ya
  existía.

### Acciones tuyas todavía pendientes (ninguna es de código)

1. **MercadoPago** (1.1): generar la "Firma secreta" del webhook en el panel
   de MP y setear `MP_WEBHOOK_SECRET` + `BACKEND_PUBLIC_URL` en Railway
   *antes* de desplegar — el backend no arranca en producción sin ellas.
2. **Rotar credenciales** (1.9): las que estaban en `.env.bak` y en
   `Users.txt` (prioridad: `DB_PASSWORD`, `JWT_SECRET`/
   `JWT_REFRESH_SECRET`, `MP_ACCESS_TOKEN`, `CLOUDINARY_API_SECRET`,
   `RESEND_API_KEY`, `SMTP_PASS`).
3. **Certificado AFIP real** (2.5): completar el trámite en ARCA, cargar
   `AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` en Railway, configurar
   `company_cuit`/`afip_punto_venta` reales, y recién ahí activar el toggle
   `afip_enabled` en Configuración.
4. **Configurar la cuenta de caja de la tienda** (2.3): en Configuración →
   Tienda online → Caja, elegir qué cuenta recibe los cobros — sin esto, el
   reporte de conciliación (2.7) va a seguir marcando "pedidos pagados sin
   registro en caja".
5. **Decidir cuándo encarar 2.6** (Andreani) — o si preferís dejarlo fuera
   del alcance por ahora.

### Deuda técnica anotada durante el trabajo (no bloqueante, no resuelta)

- **`STORE_ORDER_TRANSITIONS` duplicado entre backend
  (`config/storeOrderFlow.ts`) y frontend (`api/store.ts`)** — hallazgo del
  testing de 2.4: cualquier cambio futuro a las transiciones de estado de
  pedidos de tienda tiene que tocar los dos archivos o el frontend queda
  desincronizado en silencio. Coincide con la tarea 4.2 de la auditoría
  original ("unificar configuración de estados backend/frontend").
- Los 162 errores/11 warnings preexistentes de ESLint en `frontIndians`
  (anotados desde 1.7) siguen sin tocar — quedan para Fase 4.
- El frontend de la tienda pública sigue mostrando `stock_quantity` física
  en vez de la disponible (`stock_quantity - stock_reserved`, 2.1) — no es
  un hueco de seguridad (el checkout/quote sí valida bien), es una mejora
  de UX que quedó anotada como tarea 3.1 de la auditoría original.

### Referencia de commits de esta sesión

**`backIndians`** (rama `fixauditoria`):

| Commit | Tarea |
|---|---|
| `35ae47d` | 1.7 — renombrar "factura" a "comprobante de compra" |
| `c9d585a` | 1.9 — higiene de secretos (`.env.bak`) |
| `5ea6ef2` | 1.1 — configuración y seguridad del webhook de MercadoPago |
| `ff7e78f` | 1.2 — ledger de stock |
| `0e40c6c` | 1.3 — restitución de stock y liberación de cupón |
| `5a44a12` | 1.4 — idempotencia en el checkout |
| `2c26b34` | 1.10 — `catalog_product_size_id` en `store_order_items` |
| `a8b87d9` | 1.5 — idempotencia y robustez de webhooks |
| `98f0f41` | 1.6 — total correcto en el checkout |
| `7367251` | 1.8 — jobs de reconciliación e inconsistencias (cierra Fase 1) |
| `4e7cd68` | Merge del módulo AFIP/ARCA desde `integracionarca` |
| `02a969c` | 2.1 — reserva de stock con vencimiento |
| `c140540` | 2.2 — expiración automática a 48hs |
| `3a15c24` | 2.3 — conectar la tienda a caja |
| `4d04d70` | 2.4 — devoluciones con revisión por ítem |
| `d49ff4d` | 2.5 — gate de seguridad `afip_enabled` |
| `b4ec708` | 2.7 — reporte de conciliación ampliado |
| `be5124c` | 2.8 — cupón 1 uso por cliente (cierra el desglose de Fase 2) |

**`frontIndians`** (rama `fixauditoria`):

| Commit | Tarea |
|---|---|
| `0819968` | 1.7 — renombrar "factura" a "comprobante de compra" |
| `04fdc6a` | 1.4 — enviar Idempotency-Key en el checkout |
| `61c5f58` | 1.6 — mostrar total real (con envío) antes de confirmar |
| `721a8f0` | Merge de la UI del módulo AFIP/ARCA |
| `9f03cea` | 2.3 — sección Caja en configuración de tienda online |
| `50b2890` | 2.4 — UI de devoluciones con revisión por ítem |

Las tareas sin fila en `frontIndians` (1.1, 1.2, 1.3, 1.5, 1.8, 1.9, 1.10,
2.1, 2.2, 2.5, 2.7, 2.8) fueron 100% backend — no necesitaron cambios de
frontend.
