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
| 1.10 | M-8 | Pendiente | Ya no bloquea a 1.3 (resuelto con fallback). |
| 1.4 | A-1 | Pendiente | — |
| 1.5 | A-7 | Pendiente (depende de 1.1) | — |
| 1.6 | C-6, A-3, A-4 | Pendiente | — |
| 1.8 | C-8 (parcial) | Pendiente (depende de 1.1) | — |

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

## Preguntas / decisiones pendientes de tu parte

1. ¿Seguimos con **1.10** ahora (agregar `catalog_product_size_id` a
   `store_order_items`, con backfill), para que `restoreStoreOrderStock` deje
   de depender del fallback por `size_name`? Ya no bloquea nada — es una
   mejora de robustez, no una dependencia dura.
2. Los 162 errores/11 warnings preexistentes de ESLint en `frontIndians`:
   confirmado que quedan para Fase 4.
3. ¿Sigo con **1.4** (idempotencia del checkout con `Idempotency-Key`)?
