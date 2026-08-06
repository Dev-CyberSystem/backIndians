# Auditoría funcional y técnica — Módulo Tienda Online (Indians)

**Etapa 1 y 2: Relevamiento y Diagnóstico**
Fecha: 2026-08-03 · Alcance: `backIndians` + `frontIndians` (módulo tienda / ecommerce)
Estado: **sin cambios de código implementados** — este documento es para aprobación previa.

---

## 1. Resumen ejecutivo

El módulo de tienda online está **funcionalmente operativo para el camino feliz** (navegar → carrito → checkout → MercadoPago/efectivo/transferencia → estados de despacho → seguimiento por token). La calidad del código es buena: TypeScript estricto, servicios separados de controladores, validación con `express-validator`, rate limiting por endpoint, comprobantes en Cloudinary con URLs firmadas, precios recalculados en backend, descuento de stock atómico y máquina de estados centralizada.

Sin embargo, **el circuito no cierra como sistema comercial completo**. Los hallazgos críticos son:

| # | Hallazgo crítico | Impacto |
|---|---|---|
| C-1 | **Cancelar / devolver un pedido NO devuelve el stock ni libera el cupón.** No existe ninguna ruta de código que incremente `stock_quantity`. | Pérdida permanente de stock vendible. Cada pago rechazado o abandonado quema inventario para siempre. |
| C-2 | **`BACKEND_PUBLIC_URL` no está seteada en `.env`** → el `notification_url` que se manda a MercadoPago apunta a `http://localhost:3000`. El webhook **nunca llega** en producción. | Los pagos solo se acreditan si el cliente vuelve al sitio y hace polling. Pagos aprobados que quedan como "pendiente de pago" indefinidamente. |
| C-3 | **`MP_WEBHOOK_SECRET` no está configurada** → `verifyWebhookSignature()` devuelve `true` sin validar nada. | Cualquiera que conozca la URL puede disparar el webhook. Mitigado parcialmente porque el estado se re-consulta contra la API de MP, pero es una superficie de ataque abierta (DoS / enumeración de payment ids). |
| C-4 | **No existe factura fiscal.** El "comprobante" es un PDF generado con PDFKit, sin numeración fiscal, sin CAE, sin punto de venta, sin integración ARCA/AFIP, y **no se persiste ninguna entidad de factura para pedidos de tienda**. | Riesgo impositivo. Las ventas online no se declaran desde el sistema. El PDF se llama "factura" en la UI y en el email, lo cual es engañoso. |
| C-5 | **Ninguna modificación de stock de productos de catálogo deja movimiento auditable.** `stock_movements` existe pero es solo para materiales/telas de fábrica (`stock_items`). | Cero trazabilidad de inventario de tienda. Imposible conciliar o investigar diferencias. |
| C-6 | **El total confirmado por el cliente no incluye el envío.** El checkout muestra "Envío: se calcula al pagar" y confirma un total sin flete; el backend suma `shipping_cost` y cobra más. | El cliente confirma un monto y se le cobra otro. Riesgo de contracargos y de reclamos de Defensa del Consumidor. |
| C-7 | **La tienda online está desconectada de caja, facturación y reportes administrativos.** `StoreOrder` no aparece en `cash.service`, `invoice.service` ni `dashboard.service`. | No hay conciliación posible entre lo vendido online, lo cobrado y lo facturado. |
| C-8 | **No hay ningún proceso programado (cron/job).** No expiran pedidos impagos, no se liberan reservas, no se reintentan webhooks perdidos. | Pedidos `pending_payment` eternos con stock descontado. |

Adicionalmente hay **~20 hallazgos de prioridad Alta/Media** detallados en la sección 7.

**Recomendación:** no reescribir. El diseño base es correcto y las correcciones críticas son acotadas (una tabla nueva de movimientos, una función de restitución de stock, variables de entorno, y el desacople de reserva vs. descuento definitivo). Plan en 4 fases en la sección 10.

---

## 2. Mapa funcional del módulo

### 2.1 Arquitectura general

```
frontIndians (React 19 + Vite + TS + Zustand + TanStack Query + Tailwind)
   ├── /tienda/*          → tienda pública (StoreLayout)
   └── /ecommerce/*       → panel admin de la tienda

backIndians (Node 20 + Express 4 + Sequelize 6 + MySQL)
   └── /api/v1/store/*    → rutas públicas + admin de tienda

Integraciones externas
   ├── MercadoPago  (SDK v3 — preferences, payments, webhook)
   ├── Cloudinary   (imágenes de producto + comprobantes `authenticated`)
   ├── Resend / SMTP (emails transaccionales)
   ├── Google OAuth (login de compradores)
   ├── Cloudflare Turnstile (anti-bot en registro)
   └── Socket.io + SSE (notificaciones en tiempo real al admin / tienda)
```

### 2.2 Tres dominios de venta coexistentes (importante)

El sistema tiene **tres circuitos de venta independientes** que no comparten entidades:

| Dominio | Entidades | Factura | Caja | Stock |
|---|---|---|---|---|
| **Fábrica (producción a pedido, B2B)** | `Order`, `OrderItem`, `Invoice`, `InvoicePayment` | `invoices` (interna, `FAC-YYYYMMDD-NNNN`) | sí (`cash_transactions`) | `stock_items` + `stock_movements` (telas) |
| **Catálogo mayorista** | `CatalogOrder`, `CatalogOrderItem`, `CatalogInvoice`, `CatalogInvoicePayment` | `catalog_invoices` | parcial | descuenta `catalog_products.stock_quantity` (sin movimiento) |
| **Tienda online (B2C)** | `StoreOrder`, `StoreOrderItem`, `StoreOrderStatusHistory`, `StoreCoupon`, `StoreCustomer`, `StoreAddress` | **ninguna entidad** (solo PDF al vuelo) | **no** | descuenta `catalog_products/_sizes.stock_quantity` (sin movimiento) |

Los dominios 2 y 3 **comparten el mismo stock físico** (`catalog_products.stock_quantity` / `catalog_product_sizes.stock_quantity`) pero con reglas y momentos de descuento distintos, y ninguno registra movimientos.

### 2.3 Inventario de archivos involucrados

**Backend — núcleo del módulo**

| Archivo | Líneas | Rol |
|---|---|---|
| `src/services/store.service.ts` | 1437 | Todo el dominio tienda: productos públicos, cupones, checkout, pagos, estados, tracking, PDF, métricas |
| `src/controllers/store.controller.ts` | 645 | 40+ handlers, webhook, SSE, upload de comprobante |
| `src/routes/store.routes.ts` | 190 | Rutas públicas + admin, validadores, rate limiters |
| `src/services/mercadopago.service.ts` | 141 | Preferences, consulta de pagos, validación de firma |
| `src/services/store.auth.service.ts` | 258 | Registro/login/Google/refresh de compradores |
| `src/services/storeAnalytics.service.ts` | 571 | Eventos de comportamiento, trending, audiencia |
| `src/services/abandonedCart.service.ts` | 203 | Detección y recupero de carritos abandonados |
| `src/services/store.wishlist.service.ts` | — | Favoritos |
| `src/config/storeOrderFlow.ts` | 70 | Máquina de estados (labels, transiciones, requisitos) |
| `src/utils/money.ts` | 25 | `roundPrice` — redondeo a entero (≤0,50 abajo) |
| `src/utils/store.pdf.ts` | — | Generación del "comprobante" PDF |
| `src/utils/email.service.ts` | 330+ | Plantillas y envío de emails por estado |
| `src/utils/emailQueue.ts` | 63 | Cola en proceso con reintentos (`setImmediate`) |
| `src/middlewares/storeAuth.ts` | 42 | `requireStoreAuth` / `optionalStoreAuth` |
| `src/middlewares/rateLimit.ts` | 90 | 8 limitadores por endpoint |
| `src/middlewares/turnstile.ts` | 85 | Anti-bot (fail-open) |

**Backend — modelos**
`StoreOrder`, `StoreOrderItem`, `StoreOrderStatusHistory`, `StoreCoupon`, `StoreCustomer`, `StoreAddress`, `StoreWishlist`, `StoreEvent`, `StoreCartReminder`, `CatalogProduct`, `CatalogProductSize`, `CatalogProductImage`, `Settings`, `User`.

**Backend — migraciones relevantes**
`031` store_customers · `032` store_addresses · `033` store_orders + items + coupons · `034/036/038` seeds de settings · `039` descuentos y popup · `040` estados de despacho · `041` métodos de pago · `042/053` comprobantes · `043` índice email · `047` índices de performance · `048` wishlist · `049` eventos · `051/052/054` tokens de cliente · `055` cart reminders · `066` tracking token.

**Frontend — tienda pública**
`pages/store/StoreLandingPage.tsx` (463) · `StoreProductsPage.tsx` (661) · `StoreProductDetailPage.tsx` (522) · `StoreCartPage.tsx` (133) · `StoreCheckoutPage.tsx` (352) · `StoreCheckoutFlowPages.tsx` (279 — espera de pago / transferencia / éxito / fallo) · `StoreAccountPage.tsx` (563) · `StoreAuthPage.tsx` (582) · `StoreOrderTrackingPage.tsx` (85) · `StoreFavoritesPage.tsx` · `StoreHelpPage.tsx`
`components/store/`: `CartDrawer`, `ProductCard`, `StoreLayout` (594), `StoreChatbot` (374), `OrderTrackingTimeline`, `Turnstile`, `StoreField`, `SmartProductSections`
`store/`: `storeCartStore.ts` (Zustand + persist localStorage), `storeAuthStore.ts`, `storeWishlistStore.ts`
`api/store.ts` (537) · `utils/price.ts` · `hooks/useStoreTracker.ts`

**Frontend — panel admin**
`pages/ecommerce/EcommerceOrdersPage.tsx` (735) · `EcommercePage.tsx` (592) · `EcommerceSettingsPage.tsx` (543) · `EcommerceAnalyticsPage.tsx` (358) · `CouponsPage.tsx` (336)

---

## 3. Flujo real de compra (verificado en código)

```
1. Cliente navega          GET /store/products (cache 20s), /products/filters (cache 60s)
                           Filtros: search, category, gender, tag, size, garment_type, precio, orden
                           Solo productos con show_in_store=1 AND active=1

2. Detalle + talle         GET /store/products/:id
                           Precio mostrado = effectivePrice() = roundPrice(public_price ?? price,
                           menos discount_percentage). Stock visible por talle.

3. Agregar al carrito      100% CLIENTE. Zustand + localStorage ('store-cart').
                           NO valida stock. NO valida límite. NO consulta al backend.
                           key = `${productId}:${sizeName}`

4. Carrito                 Recalcula subtotal en el cliente con el unitPrice CONGELADO
                           al momento de agregar (nunca se refresca).

5. Cupón (opcional)        POST /store/coupons/validate {code, subtotal}
                           Valida vigencia, max_uses, min_purchase. Devuelve descuento.
                           NO reserva el cupón.

6. Checkout (form)         Datos del comprador + pickup/delivery + dirección + notas +
                           método de pago. Muestra "Envío: se calcula al pagar".
                           Total mostrado = subtotal − descuento  (SIN envío) ← problema

7. Confirmar               POST /api/v1/store/checkout  (rate limit 25/15min por IP,
                           optionalStoreAuth → customerId si hay JWT)

   BACKEND — createStoreOrder():
   a) Resuelve productos (show_in_store + active). Producto ausente → 400.
   b) RECALCULA precio en backend con roundPrice(). Ignora cualquier precio del cliente. ✔
   c) Valida stock (lectura, sin lock).
   d) Valida cupón → descuento.
   e) Costo de envío: setting `shipping_cost`, gratis si supera `free_shipping_min`.
   f) total = subtotal − descuento + envío
   g) TRANSACCIÓN (con hasta 3 reintentos ante colisión de order_number):
        - genera ECOM-YYYYMMDD-NNNN (SELECT MAX + 1, protegido por índice único)
        - INSERT store_orders (status='pending_payment', tracking_token aleatorio 48 hex)
        - bulkCreate store_order_items (snapshot de título, talle, precio unitario)
        - UPDATE ... SET stock_quantity = stock_quantity - N WHERE id=? AND stock_quantity >= N
          → si afecta 0 filas: AppError 409 y rollback   ✔ evita sobreventa
        - UPDATE store_coupons SET used_count = used_count+1 WHERE max_uses IS NULL
          OR used_count < max_uses  → si 0 filas: 409 y rollback   ✔
   h) Emite socket 'notification:store_order_created' (fire & forget)
   i) Si método = mercadopago → createPreference() con external_reference = order_number,
      un único ítem "Pago pedido ECOM-..." por el total, notification_url =
      `${BACKEND_PUBLIC_URL}/api/v1/store/webhook/mp`, auto_return solo si https.
      Guarda mp_preference_id.
   j) Email de confirmación (try/catch silencioso).

8. Pago
   ├─ MercadoPago:  frontend hace window.open(init_point, '_blank') y navega a
   │                /tienda/checkout/pago, que hace polling cada 4s a
   │                GET /store/orders/:n/status + botón "Ya pagué, confirmar"
   │                → POST /store/payment/confirm
   ├─ Efectivo:     va directo a /checkout/exito. Pedido queda pending_payment.
   └─ Transferencia: muestra CBU/alias/titular desde Settings y permite subir
                     hasta 2 comprobantes → Cloudinary `authenticated`.
                     Pedido queda pending_payment hasta verificación manual.

9. Acreditación    Webhook MP  → handleStoreWebhook(paymentId)
                                → getPaymentInfo(paymentId) contra la API de MP  ✔
                                → busca por external_reference
                                → applyPaymentResult()
                   ó confirmStorePayment() (retorno del cliente / polling), que además
                     puede buscar el pago por external_reference si no hay payment_id.

   mapMpStatusToOrderStatus():
     approved                                → 'paid'
     pending | in_process | authorized       → 'pending_payment'
     rejected | cancelled | refunded | charged_back → 'cancelled'

   applyPaymentResult() actualiza mp_payment_id/mp_status SIEMPRE, y llama a
   recordStoreOrderStatusChange(..., enforceTransition:false).
   Idempotente por comparación de estado: si el estado no cambia, no escribe
   historial ni manda mail.   ✔

10. Stock          Ya fue descontado en el paso 7g. No pasa nada más acá.

11. "Factura"      NO se genera nada. El PDF se arma on-demand cuando el admin
                   descarga/envía, o cuando el cliente lo baja desde Mi Cuenta.
                   No hay tabla, ni número, ni CAE, ni estado.

12. Notificación   Email por estado vía cola en proceso (setImmediate + 3 reintentos).

13. Preparación    Admin cambia estados en /ecommerce/pedidos.
                   PATCH /store/admin/orders/:id/status (admin | billing)
                   Valida transición contra STORE_ORDER_TRANSITIONS.
                   'shipped' exige courier_name + tracking_number.  ✔
                   Escribe StoreOrderStatusHistory con changed_by.  ✔

14. Entrega        'delivered' → fija vencimiento del link de seguimiento
                   (setting `tracking_link_expiry_days`, default 30 días).

15. Cierre         No existe. 'cancelled' y 'returned' son solo etiquetas:
                   no tocan stock, ni cupón, ni pago, ni caja.
```

---

## 4. Estados actuales

### Estado del pedido (`store_orders.status`, ENUM) — único estado que existe

| Estado | Label |
|---|---|
| `pending_payment` | Pendiente de pago |
| `paid` | Pagado |
| `processing` | En preparación |
| `review` | En revisión |
| `awaiting_courier` | Esperando el correo |
| `shipped` | En camino |
| `delivered` | Entregado |
| `cancelled` | Cancelado |
| `delayed` | Demorado |
| `returned` | Devuelto |

**Transiciones** (`config/storeOrderFlow.ts`, validadas en backend):

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
cancelled        → (terminal)
```

### Estados que NO existen como dimensión propia

| Dimensión | Situación actual |
|---|---|
| **Estado de pago** | Solo `mp_status` (string libre de MP, `NULL` para efectivo y transferencia). No hay `payment_status` propio. Un pedido en efectivo pagado en mostrador no tiene forma de registrarse como cobrado salvo moviéndolo a `paid`. |
| **Estado de facturación** | No existe. |
| **Estado de preparación** | Mezclado dentro del estado del pedido (`processing`, `awaiting_courier`). |
| **Estado del envío** | Mezclado (`shipped`, `delivered`, `delayed`). Solo `courier_name` + `tracking_number` como texto. |
| **Estado de devolución** | Solo la etiqueta `returned`. No hay entidad de devolución, ni parcial, ni motivo, ni ítems. |
| **Reintegros** | No existe absolutamente nada. |

**Problema estructural derivado:** al haber una sola columna de estado, marcar un pedido como `shipped` o `cancelled` sobreescribe la información de pago. Un pedido pagado que se cancela pierde la señal de "pagado" en el listado — solo queda `mp_status='approved'` como rastro.

---

## 5. Base de datos

### `store_orders` (verificado en migración 033 + 040/041/042/053/066)

- PK `id`, `order_number` UNIQUE STRING(30)
- FK `customer_id` → `store_customers` `ON DELETE SET NULL`
- FK `coupon_id` → `store_coupons` `ON DELETE SET NULL`
- Índices: `customer_id`, `status`, `createdAt`, `customer_email` (043), `tracking_token` UNIQUE (066), + índices de performance (047)
- Montos: `DECIMAL(12,2)` ✔ (con getters que convierten a `float` en JS — ver hallazgo A-8)
- `shipping_address` JSON (snapshot)
- Snapshot de comprador: `customer_name`, `customer_email`, `customer_phone` ✔

### `store_order_items`

- FK `store_order_id` → `store_orders` `ON DELETE CASCADE`
- FK `catalog_product_id` → `catalog_products` `ON DELETE RESTRICT` ✔ (protege histórico)
- Snapshot de `product_title`, `size_name`, `unit_price`, `subtotal` ✔
- **No guarda `catalog_product_size_id`** → si se renombra un talle, se pierde el vínculo exacto (impide restituir stock de forma confiable).

### `store_order_status_history`

- `previous_status`, `new_status`, `note`, `changed_by` (FK users), `createdAt` ✔ traza inmutable correcta.

### Tablas que faltan

- Movimientos de stock de productos de catálogo
- Pagos de tienda (entidad propia, hoy son 3 columnas `mp_*` en el pedido)
- Facturas / comprobantes de tienda
- Eventos de webhook procesados (idempotencia por `event_id`)
- Devoluciones / reintegros / notas de crédito

---

## 6. Matriz de roles y permisos (actual)

Roles del sistema: `admin`, `billing`, `workshop`, `seller` + comprador de tienda (`StoreCustomer`, JWT separado).

| Acción | Endpoint | Roles habilitados |
|---|---|---|
| Ver pedidos de tienda | `GET /store/admin/orders` | admin, billing |
| Ver detalle de pedido | `GET /store/admin/orders/:id` | admin, billing |
| Cambiar estado | `PATCH /store/admin/orders/:id/status` | admin, billing |
| Regenerar link de seguimiento | `POST .../regenerate-tracking` | admin, billing |
| Descargar / enviar "factura" | `GET|POST .../invoice`, `/send-invoice` | admin, billing |
| Gestionar cupones (CRUD) | `/store/admin/coupons` | admin, billing |
| Métricas y analytics | `/store/admin/metrics`, `/event-analytics`, `/audience` | admin, billing |
| Carritos abandonados + envío | `/store/admin/abandoned-carts` | admin, billing |
| Alta/edición/precio de producto | `/catalog/products` | admin, billing |
| Ajustar stock de producto | `PATCH /catalog/products/:id/stock` | admin, billing |
| Cliente ve sus pedidos | `GET /store/me/orders` | comprador autenticado |
| Seguimiento público | `GET /store/track/:token` | público (token opaco 48 hex) |

**Observaciones:**

- ✔ Toda la autorización está en el backend (middleware `authorize`), no solo ocultando botones.
- ⚠️ `admin` y `billing` tienen **exactamente los mismos permisos** en todo el módulo de tienda. No hay separación entre quien opera pedidos y quien toca dinero/precios/cupones.
- ⚠️ No existen roles de operador/encargado de stock. `workshop` y `seller` no tienen acceso a la tienda (razonable hoy, pero limita delegar la preparación).
- ⚠️ No hay permiso diferenciado para acciones sensibles (cancelar un pedido pagado, ajustar stock, emitir/anular comprobantes) — cualquiera con `billing` puede hacer todo.
- ✔ Aislamiento de pedidos entre clientes: `getStoreOrderByNumberForCustomer` y `getStoreOrderTrackingForCustomer` filtran por `customer_id` o (`customer_id IS NULL` + email coincidente). Correcto.

---

## 7. Hallazgos detallados

> Formato: **[ID] Prioridad — Título** · Qué pasa · Por qué es problema · Dónde · Impacto · Cómo se resuelve · ¿Migración?

### CRÍTICOS

---

**[C-1] CRÍTICO — El stock nunca se restituye**

- **Qué pasa:** El stock se descuenta en `createStoreOrder()` al crear el pedido (antes de pagar). No existe ninguna línea de código en todo el backend que haga `stock_quantity + N` para productos de catálogo. Verificado con `grep -rn "stock_quantity"` en `services/` y `controllers/`.
- **Por qué es problema:** Un pago rechazado (`mp_status: rejected` → `status: cancelled`), un carrito abandonado tras el checkout, o una cancelación administrativa dejan el stock descontado para siempre. En una tienda con rotación normal, el stock de sistema diverge del físico en semanas.
- **Dónde:** `src/services/store.service.ts:650-674` (descuento), ausencia en `recordStoreOrderStatusChange()` (línea 861) y en `applyPaymentResult()` (línea 1065).
- **Impacto:** Pérdida de ventas por productos que figuran sin stock. Diferencia irrecuperable entre stock administrativo y real. Es el hallazgo de mayor impacto económico directo.
- **Cómo se resuelve:** Implementar `restoreStoreOrderStock(order, reason, userId)` dentro de la transacción de cambio de estado, disparada al entrar en `cancelled` o `returned` — con marca de idempotencia en el pedido (`stock_restored_at`) para no restituir dos veces. Definir explícitamente que `returned` desde `delivered` puede requerir decisión manual (producto defectuoso no vuelve al stock vendible).
- **Migración:** Sí. `ALTER TABLE store_orders ADD stock_restored_at DATETIME NULL`. Además, revisión manual del stock actual con conteo físico antes de activar (el desvío histórico no se puede reconstruir sin movimientos).

---

**[C-2] CRÍTICO — El webhook de MercadoPago no llega a producción**

- **Qué pasa:** `createStoreOrder()` arma `notification_url` con `process.env.BACKEND_PUBLIC_URL || 'http://localhost:3000'`. La variable **no está definida en `.env` ni en `.env.example` del entorno relevado**.
- **Por qué es problema:** MercadoPago intenta notificar a `http://localhost:3000/api/v1/store/webhook/mp`, que no existe fuera de la máquina de MP. La acreditación de pagos queda enteramente a cargo del polling del frontend (`/checkout/pago`, cada 4s) y del botón "Ya pagué".
- **Dónde:** `src/services/store.service.ts:507` y `:742`.
- **Impacto:** Si el cliente paga y cierra la pestaña, o paga desde el celular con la app de MP, el pedido **queda en `pending_payment` para siempre**. El admin ve un pedido impago con dinero acreditado en MercadoPago. Es la causa más probable de descuadres pedido↔cobro.
- **Cómo se resuelve:** (a) Setear `BACKEND_PUBLIC_URL` en Railway con el dominio público del backend. (b) Fallar de forma ruidosa en arranque si `NODE_ENV=production` y la variable no está o es localhost. (c) Agregar un job de reconciliación que consulte MP por `external_reference` para pedidos `pending_payment` con más de N minutos.
- **Migración:** No. Configuración + código de arranque.

---

**[C-3] CRÍTICO (seguridad) — Firma del webhook no validada**

- **Qué pasa:** `verifyWebhookSignature()` empieza con `if (!secret) return true;` y `MP_WEBHOOK_SECRET` no está configurada.
- **Por qué es problema:** El endpoint `POST /api/v1/store/webhook/mp` es público y sin autenticación. Un tercero puede invocarlo con cualquier `data.id`.
- **Mitigación existente:** ✔ El handler **no confía en el body**: consulta `getPaymentInfo(paymentId)` contra la API de MP y valida que el `external_reference` empiece con `ECOM-`. Un atacante no puede marcar un pedido como pagado sin un pago real en la cuenta de MP.
- **Riesgo residual:** DoS (cada request dispara una llamada a la API de MP), enumeración de payment ids ajenos, y ausencia de rate limiting específico en este endpoint (queda solo bajo el `generalLimiter` de 500/min).
- **Dónde:** `src/services/mercadopago.service.ts:24-25`, `src/controllers/store.controller.ts:260-280`, `src/routes/store.routes.ts:142`.
- **Cómo se resuelve:** Configurar `MP_WEBHOOK_SECRET` en el panel de MP y en Railway. Cambiar el fail-open por fail-closed en producción. Agregar rate limiter propio al webhook. Agregarla a `.env.example`.
- **Migración:** No.

---

**[C-4] CRÍTICO — No hay factura fiscal ni entidad de comprobante**

- **Qué pasa:** El "comprobante" se genera con PDFKit (`utils/store.pdf.ts`) en el momento de la descarga, a partir de los datos vivos del pedido. No se persiste, no tiene numeración propia, no tiene tipo de comprobante, ni CUIT/condición IVA del comprador, ni discriminación de impuestos, ni CAE, ni punto de venta. No existe integración con ARCA/AFIP ni con ningún proveedor fiscal en las dependencias del proyecto.
- **Por qué es problema:**
  1. **Riesgo impositivo:** las ventas online no generan comprobante fiscal desde el sistema.
  2. **La UI y el email lo llaman "factura"** (`factura-ECOM-xxxx.pdf`, botón "Reenviar factura", `sendOrderInvoiceEmail`) — es un comprobante interno, no una factura.
  3. **Es mutable:** si se edita el pedido después, el PDF "reimpreso" sale distinto. No hay reimpresión fiel.
  4. No hay notas de crédito, anulaciones, ni numeración correlativa.
- **Dónde:** `src/utils/store.pdf.ts`, `store.service.ts:1311-1373`, `controllers/store.controller.ts:434-472`, `EcommerceOrdersPage.tsx`.
- **Impacto:** Alto y de naturaleza regulatoria. Requiere validación de un contador argentino.
- **Cómo se resuelve (por etapas):**
  1. **Inmediato (bajo riesgo):** renombrar en UI/email/archivo a "Comprobante de compra" / "Resumen del pedido" y agregar la leyenda "Documento no válido como factura". Esto es una corrección de honestidad, no técnica.
  2. **Fase 2:** crear entidad `store_invoices` (número, tipo, fecha, estado, snapshot inmutable de conceptos y montos, PDF almacenado) para tener reimpresión fiel y trazabilidad.
  3. **Fase 4 (decisión de negocio):** integrar facturación electrónica (ARCA WSFEv1 o un proveedor tipo TusFacturas/Facturante), con manejo de certificados, ambientes homologación/producción, CAE + vencimiento, reintentos, y política explícita para el caso "pago aprobado + factura no emitible".
- **Migración:** Sí, en fase 2 (tabla nueva, sin tocar datos existentes).

---

**[C-5] CRÍTICO — Cero trazabilidad de movimientos de stock de tienda**

- **Qué pasa:** `stock_movements` (con `previous_quantity`, `new_quantity`, `type`, `user_id`, `notes`) existe pero está atada a `stock_item_id` → `stock_items`, que son **materiales de fábrica (telas)**. Los productos de catálogo modifican `catalog_products.stock_quantity` / `catalog_product_sizes.stock_quantity` directamente, sin dejar rastro, desde: checkout de tienda, pedidos de catálogo mayorista (`catalog.service.ts:413`), y ajuste manual del admin (`catalog.service.ts:214`).
- **Por qué es problema:** Ante una diferencia de inventario es imposible saber qué pasó, quién lo hizo, ni cuándo. No se puede conciliar ventas contra stock. No se cumple el requisito de auditoría del punto 9 del pedido.
- **Dónde:** `src/models/StockMovement.ts`, `services/catalog.service.ts:214,413`, `services/store.service.ts:662-673`.
- **Impacto:** Alto. Bloquea conciliación, investigación de faltantes y control interno.
- **Cómo se resuelve:** Nueva tabla `catalog_stock_movements` con: `catalog_product_id`, `catalog_product_size_id`, `type` (sale/return/cancel/adjustment/in/out), `quantity`, `previous_quantity`, `new_quantity`, `reason`, `store_order_id` / `catalog_order_id`, `user_id` (nullable para procesos automáticos), `source` (store/catalog/manual), `notes`, `createdAt`. Escribir el movimiento **dentro de la misma transacción** que modifica el stock, en un único servicio centralizado (`stockLedger.service.ts`) que sea el ÚNICO punto que toca `stock_quantity`.
- **Migración:** Sí. Tabla nueva + índices. No modifica datos existentes.

---

**[C-6] CRÍTICO — El total confirmado por el cliente no incluye el envío**

- **Qué pasa:** `StoreCheckoutPage.tsx` calcula `displayTotal = subtotal − descuento` y el resumen muestra `Envío: "Se calcula al pagar"`. El diálogo de confirmación dice literalmente `Total a pagar: ${displayTotal}`. El backend calcula `total = subtotal − descuento + shippingCost` y cobra ese monto en MercadoPago.
- **Por qué es problema:** El cliente acepta un monto y se le cobra otro, sin haberlo visto nunca. Es un problema legal (Ley de Defensa del Consumidor, información previa del precio final) y una causa directa de contracargos y abandono.
- **Dónde:** `frontIndians/src/pages/store/StoreCheckoutPage.tsx:173-178, 126, 313`; backend `store.service.ts:591-599`.
- **Impacto:** Alto: reputacional, legal y financiero.
- **Cómo se resuelve:** Endpoint `POST /store/checkout/quote` que reciba items + cupón + tipo de envío y devuelva el desglose calculado por el backend (subtotal, descuento, envío, total). El checkout muestra exactamente eso, y el `POST /checkout` valida que el total que el cliente vio coincida con el recalculado (si difiere, 409 con el nuevo desglose para reconfirmar). Esto además resuelve A-3 y A-4.
- **Migración:** No.

---

**[C-7] CRÍTICO — Tienda desconectada de caja, facturación y reportes**

- **Qué pasa:** `StoreOrder` no se referencia en `cash.service.ts`, `invoice.service.ts`, `dashboard.service.ts` ni en `order.service.ts`. Verificado con grep. La única visibilidad es `getStoreMetrics()` (`store.service.ts:1377`), que agrega totales de pedidos con estado en `['paid','processing','shipped','delivered']`.
- **Por qué es problema:**
  - Un cobro en efectivo o por transferencia de la tienda **no entra a caja**.
  - No hay reporte que cruce pedidos creados / pagados / cobrados / facturados / stock movido.
  - `getStoreMetrics` **excluye `review`, `awaiting_courier`, `delayed` y `returned`** del cálculo de facturación: un pedido pagado que está "En revisión" o "Demorado" desaparece de los ingresos. Y un pedido `returned` sigue sin descontarse del revenue si nunca pasó por esos estados.
- **Dónde:** ausencia transversal; `store.service.ts:1394-1395`.
- **Impacto:** Alto. Imposibilita el control financiero y la conciliación.
- **Cómo se resuelve:** (a) Corregir el criterio de `getStoreMetrics` para basarse en estado de PAGO, no de despacho. (b) Registrar automáticamente una transacción de caja al confirmar cobro en efectivo/transferencia. (c) Reporte de conciliación con las anomalías del punto 15 del pedido (pago sin pedido, pedido pagado sin comprobante, venta sin movimiento de stock, cancelado con stock no restaurado, etc.).
- **Migración:** Sí, al vincular caja (`store_order_id` en `cash_transactions` o tabla puente).

---

**[C-8] CRÍTICO — No existe ningún proceso programado**

- **Qué pasa:** No hay `node-cron` ni ningún scheduler en las dependencias. El único `setInterval` del proyecto es el keepalive del SSE.
- **Por qué es problema:** Sin jobs no puede haber: expiración de pedidos impagos, liberación de stock reservado, reconciliación de pagos perdidos (agrava C-2), reintento de emails agotados, ni limpieza de tokens vencidos.
- **Dónde:** transversal.
- **Impacto:** Alto, y es el habilitador de C-1 y C-2.
- **Cómo se resuelve:** Incorporar un scheduler simple (`node-cron` en el proceso, o Railway cron ejecutando un script) con tres jobs iniciales: (1) reconciliar `pending_payment` con MP; (2) expirar pedidos impagos > N horas y restituir stock; (3) alertar sobre inconsistencias detectadas.
- **Migración:** No (sí un setting configurable para la ventana de expiración).

---

### ALTOS

**[A-1] ALTO — Doble clic / doble POST crea pedidos duplicados con doble descuento de stock**
El único freno es el estado `submitting` del frontend (`StoreCheckoutPage.tsx:132`). No hay idempotencia en `POST /store/checkout`: dos requests concurrentes generan dos `StoreOrder` y descuentan stock dos veces. El rate limiter (25/15min) no protege contra esto.
*Solución:* header `Idempotency-Key` (UUID generado al montar el checkout) + tabla o columna única; devolver el pedido existente ante repetición. *Migración:* sí (columna + índice único).

**[A-2] ALTO — El stock se descuenta antes de pagar, y no se libera nunca**
Combinado con C-1 y C-8: el modelo actual es "descuento definitivo al crear el pedido". Con MercadoPago, entre crear el pedido y pagar hay minutos de exposición; si el cliente no paga, el stock se pierde. *Solución:* separar `stock_reserved` de `stock_quantity`, con reserva al crear el pedido, expiración configurable, y descuento definitivo al acreditar el pago. Alternativa de menor riesgo para fase 1: mantener el descuento inmediato pero agregar restitución automática por cancelación/expiración. *Migración:* sí.

**[A-3] ALTO — Los precios del carrito nunca se refrescan**
`storeCartStore` congela `unitPrice` al momento de agregar y persiste en localStorage indefinidamente. Un carrito de hace un mes muestra precios viejos hasta el checkout, donde el backend recalcula silenciosamente. El cliente ve un total y paga otro. *Solución:* el endpoint `/checkout/quote` (C-6) revalida y el frontend muestra un aviso explícito de "los precios de tu carrito cambiaron". *Migración:* no.

**[A-4] ALTO — El carrito no valida stock ni disponibilidad hasta el checkout**
Se puede agregar cantidad ilimitada de un producto sin stock (el frontend no consulta nada; la validación de `items.*.quantity` acepta hasta 1000). Un producto que se desactiva o se queda sin stock mientras está en el carrito solo falla al confirmar, con un error genérico. *Solución:* validación al agregar (usando el stock del producto ya cargado) + revalidación en `/checkout/quote` con detalle por ítem. *Migración:* no.

**[A-5] ALTO — No existe circuito de devoluciones ni reintegros**
`returned` es una etiqueta sin efectos. No hay: devolución parcial, ítems devueltos, motivo, decisión de reingreso a stock, reintegro total/parcial, nota de crédito, ni registro de la diferencia entre lo vendido y lo reintegrado. No hay integración con la API de refunds de MercadoPago. *Solución:* entidad `store_returns` + `store_return_items` + `store_refunds`, con máquina de estados propia y efectos definidos sobre stock/pago/comprobante. *Migración:* sí (tablas nuevas).

**[A-6] ALTO — No hay entidad de pago; los datos viven en 3 columnas del pedido**
`mp_preference_id`, `mp_payment_id`, `mp_status` en `store_orders`. Consecuencias: no se guarda la respuesta completa del proveedor, ni comisiones, ni fecha de acreditación, ni moneda; no se pueden registrar reintentos ni múltiples intentos de pago; no hay pago mixto; efectivo y transferencia no tienen dónde registrar el cobro. *Solución:* tabla `store_payments` (1:N con el pedido) con `provider`, `external_id`, `amount`, `currency`, `status`, `paid_at`, `raw_response` JSON, `fee_amount`, `net_amount`. *Migración:* sí, con backfill desde las columnas actuales.

**[A-7] ALTO — No hay idempotencia por evento de webhook**
`handleStoreWebhook` es idempotente *por resultado* (si el estado no cambia, no reescribe historial ni manda mail) — lo cual es una buena mitigación. Pero no se guarda el `id` del evento de MP, no hay protección contra concurrencia (dos webhooks simultáneos pueden entrar a `applyPaymentResult` a la vez, sin lock sobre el pedido), y **eventos desordenados sobreescriben el estado**: si llega `approved` y después `pending` (retry tardío), el pedido vuelve a `pending_payment`. *Solución:* tabla `webhook_events` con `provider` + `event_id` UNIQUE; `SELECT ... FOR UPDATE` sobre el pedido dentro de la transacción; ignorar transiciones hacia atrás comparando fechas de pago. *Migración:* sí.

**[A-8] ALTO — Los montos se manipulan como `float` en JavaScript**
La base usa `DECIMAL(12,2)` correctamente ✔, pero los getters de `StoreOrder` hacen `parseFloat(...)` y toda la aritmética (`subtotal += itemSubtotal`, sumas de métricas, `reduce` de revenue) ocurre en `number` de JS. La regla de negocio de redondeo a entero (`roundPrice`) mitiga el problema en el precio final, pero las métricas y los descuentos porcentuales acumulan error. *Solución:* centralizar toda la aritmética monetaria en enteros (centavos) o adoptar `decimal.js`; nunca sumar floats en reportes. *Migración:* no.

**[A-9] ALTO — El cupón se consume al crear el pedido y no se libera al cancelar**
`used_count` se incrementa atómicamente en la transacción de checkout ✔, pero un pedido cancelado o con pago rechazado no lo decrementa. Un cupón de 10 usos se agota con 10 checkouts fallidos. Además no hay límite por cliente ni registro de qué cliente usó qué cupón. *Solución:* liberar en la misma operación que restituye stock (C-1); tabla `store_coupon_redemptions` para límite por cliente y auditoría. *Migración:* sí.

**[A-10] ALTO — Métricas de facturación con criterio incorrecto**
`getStoreMetrics` filtra por `status IN ('paid','processing','shipped','delivered')`. Excluye `review`, `awaiting_courier` y `delayed` (pedidos pagados que sí facturaron) e incluye pedidos en efectivo/transferencia que fueron movidos a `paid` sin cobro verificado. `returned` no descuenta. *Solución:* calcular sobre estado de pago real, una vez que exista (A-6). *Migración:* no.

**[A-11] ALTO — `admin` y `billing` son indistinguibles en todo el módulo**
No hay separación de deberes: quien prepara pedidos puede cambiar precios, crear cupones, y (una vez implementados) cancelar y reintegrar. *Solución:* introducir permisos granulares (`store.orders.read`, `store.orders.cancel`, `store.refunds.execute`, `catalog.price.write`, `stock.adjust`) o al menos un rol `operator` limitado a estados de despacho. *Migración:* sí, si se persisten permisos.

---

### MEDIOS

**[M-1] MEDIO — `getStoreOrderStatusByNumber` es público y los números son adivinables**
Los `order_number` son `ECOM-YYYYMMDD-NNNN` secuenciales. El endpoint es público (rate limit 120/min). ✔ Bien resuelto en cuanto a datos: solo devuelve `order_number`, `status`, `mp_status` — sin montos ni PII. Riesgo residual: enumeración de volumen de ventas por día. *Solución:* considerar exigir el email además del número, o mover el polling al `tracking_token`.

**[M-2] MEDIO — Turnstile en modo fail-open y solo en registro**
Sin `TURNSTILE_SECRET_KEY` (no está en el `.env` relevado) la verificación anti-bot está desactivada; y ante timeout de Cloudflare también deja pasar. Solo protege `/auth/register`, no el checkout. *Solución:* configurar la clave; evaluar Turnstile en checkout de invitados.

**[M-3] MEDIO — El carrito no se fusiona al iniciar sesión**
El carrito vive en localStorage por navegador. No se persiste por cliente ni se fusiona al loguearse. Hay merge de wishlist (`/me/wishlist/merge`) pero no de carrito. Un cliente que arma el carrito en el celular y compra en la compu pierde todo. *Solución:* carrito persistido server-side para clientes autenticados con merge al login. *Migración:* sí (tabla nueva).

**[M-4] MEDIO — MercadoPago se abre en `window.open` a otra pestaña**
Bloqueadores de popups lo cortan silenciosamente en muchos navegadores móviles; el cliente queda en la pantalla "Esperando tu pago" sin haber visto nada. Además el carrito ya fue vaciado (`clear()` antes de redirigir), así que si falla no puede reintentar. *Solución:* redirección en la misma pestaña (o botón explícito), y vaciar el carrito solo tras confirmación de pago.

**[M-5] MEDIO — Sin verificación de disponibilidad al confirmar pagos de transferencia/efectivo**
Un pedido en efectivo o transferencia se mueve a `paid` manualmente sin ningún registro del monto cobrado, la fecha, ni quién lo verificó (más allá de la nota de texto libre en el historial). No hay validación de que el comprobante corresponda al monto. *Solución:* formulario de confirmación de cobro con monto, fecha y medio → registro en `store_payments` + caja.

**[M-6] MEDIO — Datos fiscales del comprador no se solicitan**
No hay CUIT/DNI, razón social ni condición frente al IVA en el checkout ni en `store_customers`. Imposibilita emitir factura A y complica la B. *Solución:* campos opcionales en el checkout, obligatorios si se elige factura A. *Migración:* sí.

**[M-7] MEDIO — El catálogo no tiene SKU, costo, margen ni impuestos**
`CatalogProduct` tiene `price`, `public_price`, `discount_percentage`, `stock_quantity`. No hay SKU/código único, ni costo, ni margen, ni alícuota de IVA, ni "precio anterior" real, ni fechas de vigencia de la promoción (el descuento es un porcentaje permanente hasta que alguien lo saque a mano). *Solución:* extender el modelo; agregar `promo_starts_at` / `promo_ends_at`. *Migración:* sí.

**[M-8] MEDIO — `store_order_items` no guarda el `catalog_product_size_id`**
Guarda `size_name` como texto. Si se renombra o elimina un talle, no hay forma confiable de saber a qué fila de `catalog_product_sizes` restituir el stock. Bloquea parcialmente la solución de C-1. *Solución:* agregar la columna (nullable) y poblarla en adelante; para pedidos históricos, resolver por `size_name` con fallback. *Migración:* sí.

**[M-9] MEDIO — El email de confirmación falla en silencio**
`createStoreOrder` envuelve `sendOrderConfirmationEmail` en `try {} catch {}` vacío (línea 765) sin loguear. ✔ Correcto que no revierta la venta; ✗ incorrecto que no quede rastro. Los emails de cambio de estado sí usan `emailQueue` con reintentos y logging estructurado — el de confirmación no. *Solución:* usar `enqueueEmail` también acá.

**[M-10] MEDIO — No hay bandeja de reenvío de notificaciones fallidas**
`emailQueue` agota 3 reintentos y loguea `emailQueue.exhausted`. Nadie mira ese log. No hay UI para ver qué mails fallaron ni reenviarlos. *Solución:* tabla `email_log` con estado + acción de reenvío en el panel.

**[M-11] MEDIO — El costo de envío es un valor plano global**
Un único setting `shipping_cost` + `free_shipping_min`. Sin zonas, sin cálculo por CP, sin integración logística. La documentación (`documentos/enviosADomicilio*.png`) sugiere que se evaluó Correo Argentino/Andreani, pero no está implementado. *Solución:* tabla de zonas por CP como paso intermedio.

**[M-12] MEDIO — `getStoreOrderTrackingForCustomer` permite acceso por email de invitado**
Un cliente que registra una cuenta con el email `x@y.com` accede automáticamente a todos los pedidos de invitado hechos con ese email, sin verificación adicional. ✔ El registro exige verificación de email, lo que mitiga bastante. Riesgo residual bajo pero conviene documentarlo como decisión consciente.

**[M-13] MEDIO — `store.service.ts` con 1437 líneas y 8 responsabilidades**
Productos públicos + cupones + checkout + pagos + estados + tracking + PDF + métricas en un mismo archivo. Alto costo de mantenimiento y riesgo de regresión. *Solución:* dividir en `store.catalog`, `store.checkout`, `store.payments`, `store.orders`, `store.reporting`.

**[M-14] MEDIO — Lógica de estados duplicada entre backend y frontend**
`STORE_STATUS_LABELS` y `STORE_ORDER_TRANSITIONS` existen en `backIndians/src/config/storeOrderFlow.ts` y replicados en el frontend (`EcommerceOrdersPage.tsx` importa equivalentes locales). Si divergen, el admin ve opciones que el backend rechaza. *Solución:* exponer la configuración vía endpoint o paquete compartido.

**[M-15] MEDIO — La validación de stock previa (paso c) es inútil y confunde**
`createStoreOrder` valida stock leyendo (línea 549-560) y luego lo revalida atómicamente en el UPDATE (línea 662). La primera validación no aporta seguridad —solo un mensaje más lindo— pero da la falsa impresión de que protege. Además genera dos mensajes distintos (400 vs 409) para el mismo problema. *Solución:* documentarlo explícitamente o unificar el mensaje de error.

---

### BAJOS

**[B-1]** Sin límite máximo de unidades por producto por pedido (validador acepta hasta 1000).
**[B-2]** `generateStoreOrderNumber` usa `SELECT ... ORDER BY id DESC` + parseo de string; funciona gracias al índice único y al retry, pero es frágil. Preferible una secuencia o tabla de contadores.
**[B-3]** El sitemap/SEO y el chatbot (`StoreChatbot.tsx`, 374 líneas) no fueron auditados en profundidad; el chatbot consulta el endpoint público de estado de pedido.
**[B-4]** `listStoreOrders` no valida `date_from`/`date_to` con `express-validator` (se parsean con `new Date()` sin control) — `Invalid Date` produce resultados vacíos silenciosos.
**[B-5]** No hay validación de tipo/tamaño de archivo documentada en la ruta de comprobante más allá de `multer` (revisar `middlewares/upload.ts`).
**[B-6]** `payment_proof_url` limitado a 2 comprobantes por diseño; sin justificación evidente y sin forma de reemplazar uno erróneo.
**[B-7]** Sin monitoreo/alertas de negocio: nadie se entera si dejan de entrar pedidos, si MP falla, o si un webhook viene rechazando.

---

## 8. Riesgos de seguridad — evaluación consolidada

| Vector | Estado | Nota |
|---|---|---|
| Manipulación de precios desde el navegador | ✅ **Protegido** | El backend recalcula todo desde la BD e ignora precios del cliente (`store.service.ts:541-545`). |
| Manipulación del monto enviado a la pasarela | ✅ Protegido | `overrideAmount` = total calculado en backend. |
| Manipulación de cantidades | ⚠️ Parcial | Validado (int 1–1000) y limitado por stock, pero sin tope de negocio. |
| Inyección SQL | ✅ Protegido | Sequelize parametriza; los `sequelize.literal` usan `sequelize.escape()` o valores enteros derivados de `Math.trunc(Number(...))`. |
| XSS | ✅ Razonable | React escapa por defecto; existe `utils/escapeHtml.ts` y `sanitize.ts` para las plantillas de email. |
| CSRF | ✅ N/A | API stateless con JWT en header `Authorization`, sin cookies de sesión. |
| Acceso a pedidos de otros clientes | ✅ Protegido | Filtrado por `customer_id`/email en backend. Tokens de tracking opacos de 48 hex. |
| Enumeración de pedidos | ⚠️ Parcial | `order_number` predecible, pero el endpoint público no expone PII ni montos. |
| Protección de webhooks | ❌ **Abierto** | Ver C-3. |
| Exposición de secretos | ✅ Correcto | Todo por env vars; `.env` en `.gitignore`. **Nota: existe un `.env.bak` versionado en el repo — revisar y eliminar.** |
| Logs con información sensible | ✅ Razonable | `pino` estructurado; no se loguean tokens ni contraseñas. Verificar que `raw_response` de MP no se loguee entero si se implementa A-6. |
| Rate limiting | ✅ Bueno | 8 limitadores específicos + backstop general. Falta uno en el webhook. |
| Carga de archivos | ⚠️ Revisar | Cloudinary `authenticated` + URLs firmadas ✔ (buena práctica). Validar tipo/tamaño en `upload.ts`. |
| Datos de tarjeta | ✅ Correcto | Nunca tocan el backend — todo vía checkout hosteado de MercadoPago. |
| Sesiones y tokens | ✅ Bueno | JWT separados para admin y comprador, con `session_version` para invalidación (migración 052) y expiración de tokens de verificación (051). |
| Dependencias vulnerables | ⏳ Pendiente | Correr `npm audit` en ambos proyectos (no ejecutado en este relevamiento). |

---

## 9. Casos de prueba — resultado esperado del análisis estático

| # | Caso | Comportamiento actual (según código) |
|---|---|---|
| 1 | Compra normal con stock | ✅ Funciona |
| 2 | Compra del último producto | ✅ Funciona (UPDATE condicional) |
| 3 | Dos clientes, última unidad, simultáneo | ✅ **Protegido** — uno recibe 409 y rollback |
| 4 | Producto sin stock | ✅ Rechaza en checkout (400/409). ⚠️ El carrito lo permitió agregar |
| 5 | Producto desactivado en el carrito | ⚠️ Falla al confirmar con "Producto N no disponible" (mensaje pobre, sin indicar cuál) |
| 6 | Cambio de precio antes del checkout | ❌ **Falla silenciosa** — se cobra el precio nuevo sin avisar (A-3) |
| 7 | Cupón válido | ✅ Funciona |
| 8 | Cupón vencido | ✅ Rechaza correctamente |
| 9 | Pago aprobado | ⚠️ Solo si el webhook llega (C-2) o el cliente vuelve al sitio |
| 10 | Pago rechazado | ⚠️ Pasa a `cancelled`. ❌ **No restituye stock ni cupón** (C-1, A-9) |
| 11 | Pago pendiente | ✅ Queda `pending_payment` |
| 12 | Pago aprobado tardío | ❌ Sin webhook, no se entera nunca (C-2, C-8) |
| 13 | Webhook repetido | ✅ Idempotente por comparación de estado |
| 14 | Webhook con importe incorrecto | ❌ **No se compara el importe** contra `total_amount` |
| 15 | Webhook con firma inválida | ❌ **Aceptado** (C-3), mitigado porque revalida contra la API de MP |
| 16 | Recarga durante el pago | ✅ Polling por `order` en la query string lo recupera |
| 17 | Doble clic en confirmar | ❌ **Crea dos pedidos** con doble descuento de stock (A-1) |
| 18 | Transferencia pendiente | ⚠️ Funciona el upload; la verificación es 100% manual sin registro estructurado |
| 19 | Cancelación antes de pagar | ❌ **No restituye stock** |
| 20 | Cancelación después de pagar | ❌ No restituye stock, no reintegra, no anula comprobante |
| 21-24 | Devoluciones y reintegros (parcial/total) | ❌ **No implementado** |
| 25 | Error de facturación con pago aprobado | N/A — no hay facturación |
| 26 | Error de notificación | ✅ Correcto: no revierte la venta, reintenta 3 veces, loguea. ⚠️ Sin bandeja de reenvío |
| 27 | Reserva de stock que vence | ❌ **No existe el concepto** |
| 28 | Pedido enviado que no debe restaurar stock | ✅ Trivialmente correcto (nunca restaura nada) |
| 29 | Cliente accede a pedido de otro | ✅ **Protegido** |
| 30 | Usuario sin permisos ajusta stock / reintegra | ✅ Backend valida rol. ⚠️ `billing` puede todo (A-11) |

**Cobertura de tests existente:** 20 suites en `backIndians/src/__tests__/api/` (incluye `purchase-flow.test.ts`, `mp.test.ts`, `store-public.test.ts`, `store-tracking.test.ts`, `store-analytics.test.ts`) + Playwright en `e2e/`. **Requieren BD y servidor levantados** — no se ejecutaron en este relevamiento para no tocar datos reales. `tsc --noEmit` se lanzó y no reportó errores en la salida obtenida (ejecución lenta en el entorno de análisis; conviene reconfirmarlo localmente).

---

## 10. Plan de implementación propuesto

### Fase 1 — Correcciones críticas (bloqueantes)

| # | Tarea | Prioridad | Depende de | Archivos | BD | Riesgo | Criterio de aceptación |
|---|---|---|---|---|---|---|---|
| 1.1 | Setear `BACKEND_PUBLIC_URL` y `MP_WEBHOOK_SECRET`; fail-fast en producción; agregar a `.env.example` | Crítica | — | `.env`, `config/`, `server.ts`, `mercadopago.service.ts` | No | Bajo | El webhook llega y se registra; firma inválida → 401 |
| 1.2 | Ledger de stock: tabla `catalog_stock_movements` + servicio único `stockLedger` | Crítica | — | nueva migración, `stockLedger.service.ts`, `store.service.ts`, `catalog.service.ts` | Sí (tabla nueva) | Medio | Toda modificación de stock deja movimiento con antes/después/motivo/usuario |
| 1.3 | Restitución de stock y cupón al cancelar/expirar, idempotente (`stock_restored_at`) | Crítica | 1.2 | `store.service.ts`, migración | Sí (columna) | Medio | Cancelar un pedido devuelve el stock exactamente una vez |
| 1.4 | Idempotencia en checkout (`Idempotency-Key`) | Crítica | — | `store.routes.ts`, `store.controller.ts`, `store.service.ts`, migración | Sí | Bajo | Doble POST → un solo pedido |
| 1.5 | Idempotencia y orden de webhooks: tabla `webhook_events` + lock `FOR UPDATE` + validación de importe/moneda | Crítica | 1.1 | `store.service.ts`, migración | Sí (tabla nueva) | Medio | Webhook repetido/desordenado/con importe distinto no corrompe el pedido |
| 1.6 | Endpoint `/checkout/quote` + total con envío visible + revalidación al confirmar | Crítica | — | `store.routes.ts`, `store.service.ts`, `StoreCheckoutPage.tsx` | No | Bajo | El total confirmado === el total cobrado, siempre |
| 1.7 | Renombrar "factura" → "comprobante de compra" + leyenda "no válido como factura" | Crítica | — | `store.pdf.ts`, `email.service.ts`, front | No | Muy bajo | Ningún texto de cara al cliente dice "factura" |
| 1.8 | Job de reconciliación de pagos `pending_payment` contra MP | Crítica | 1.1 | nuevo `jobs/`, `package.json` | No | Bajo | Un pago acreditado sin webhook se detecta en < 15 min |
| 1.9 | Eliminar `.env.bak` del repositorio y rotar cualquier credencial que contenga | Crítica | — | repo | No | Bajo | El archivo no está versionado |

### Fase 2 — Consistencia funcional

- 2.1 Entidad `store_payments` (con backfill desde `mp_*`) y `payment_status` separado del estado del pedido.
- 2.2 Estados desacoplados: pedido / pago / preparación / envío / devolución.
- 2.3 Reserva de stock con vencimiento (`stock_reserved`) y descuento definitivo al acreditar el pago.
- 2.4 Circuito de devoluciones y reintegros (`store_returns`, `store_return_items`, `store_refunds`) + refunds de MercadoPago.
- 2.5 Entidad `store_invoices` (comprobante interno persistido, numerado, inmutable, con PDF almacenado).
- 2.6 Registro de cobros de efectivo/transferencia en caja.
- 2.7 Reporte de conciliación con detección de las 8 anomalías del punto 15.
- 2.8 `catalog_product_size_id` en `store_order_items`.
- 2.9 Redenciones de cupón por cliente.

### Fase 3 — Experiencia de usuario

- 3.1 Validación de stock y límites en el carrito, con aviso de cambios de precio/disponibilidad.
- 3.2 Carrito persistido server-side + merge al login.
- 3.3 Redirección a MercadoPago en la misma pestaña; vaciar carrito solo tras confirmación.
- 3.4 Mensajes de error específicos por producto/talle en el checkout.
- 3.5 Panel admin: filtros por método de pago y estado de pago, confirmación de cobro con monto/fecha, acciones de cancelación/devolución con confirmación explícita e irreversibilidad advertida.
- 3.6 Datos fiscales opcionales en el checkout.
- 3.7 Bandeja de notificaciones fallidas con reenvío.

### Fase 4 — Calidad y mantenimiento

- 4.1 Split de `store.service.ts` en 5 servicios.
- 4.2 Unificar la configuración de estados entre backend y frontend.
- 4.3 Aritmética monetaria en enteros/decimal.
- 4.4 Tests: unitarios de reglas de negocio (redondeo, cupones, transiciones), de integración de los 30 casos del punto 17, y E2E Playwright del flujo completo.
- 4.5 Permisos granulares y separación de deberes.
- 4.6 Monitoreo, alertas y métricas de negocio.
- 4.7 Evaluación de facturación electrónica ARCA/proveedor + validación con contador.
- 4.8 `npm audit` y actualización de dependencias.

---

## 11. Arquitectura funcional recomendada (resumen)

**Momento de cada operación:**

| Evento | Stock | Pago | Comprobante | Caja |
|---|---|---|---|---|
| Crear pedido | **Reserva** (`stock_reserved += n`) | Intento creado (`pending`) | — | — |
| Pago acreditado | **Descuento definitivo** (`stock -= n`, `reserved -= n`) + movimiento `sale` | `paid` | Emitir comprobante | Registrar ingreso |
| Pago rechazado / expirado | **Liberar reserva** + liberar cupón | `rejected`/`expired` | — | — |
| Cancelación antes de envío | Liberar reserva o restituir + movimiento `cancel` | Reintegro si estaba pagado | Nota de crédito | Registrar egreso |
| Devolución (post entrega) | Restituir **solo si el ítem es revendible** (decisión explícita) + movimiento `return` | Reintegro total/parcial | Nota de crédito | Registrar egreso |
| Envío / entrega | Sin efecto sobre stock | Sin efecto | Sin efecto | Sin efecto |

**Principios:**
1. Un único servicio (`stockLedger`) puede tocar el stock, siempre dentro de transacción y siempre dejando movimiento.
2. Estado del pedido, del pago, de la preparación, del envío y de la devolución son dimensiones **independientes**.
3. Todo efecto lateral (mail, socket, factura) es asíncrono y **nunca** revierte una operación financiera confirmada.
4. Todo lo que viene de afuera (webhook, retorno del cliente) es idempotente y verificado contra la fuente.
5. El backend es la única fuente de verdad para precios, descuentos, envío y totales.

---

## 12. Preguntas abiertas para el negocio

1. **Facturación:** ¿Indians factura hoy las ventas online por fuera del sistema? ¿Se quiere integrar facturación electrónica (ARCA/proveedor)? ¿Se emiten facturas A?
2. **Momento de descuento del stock:** ¿reserva al crear + descuento al pagar (recomendado), o descuento inmediato con expiración?
3. **Ventana de expiración de pedidos impagos:** ¿24h? ¿48h? ¿Distinto para MercadoPago vs. transferencia?
4. **Devoluciones:** ¿el producto devuelto vuelve al stock vendible por defecto, o requiere revisión?
5. **Reintegros:** ¿se ejecutan desde MercadoPago manualmente o se quiere disparar desde el sistema?
6. **Envíos:** ¿costo plano actual está bien, o se necesita zonificación por CP / integración con un correo?
7. **Roles:** ¿hace falta un rol de operador que solo mueva estados de despacho sin tocar precios ni dinero?

---

## 13. Próximo paso

Este documento cierra las Etapas 1 y 2. **No se modificó código.**

Al aprobar, se recomienda arrancar por **Fase 1 en el orden 1.1 → 1.9**, con las tareas 1.1, 1.7 y 1.9 primero por ser de riesgo casi nulo e impacto inmediato.
