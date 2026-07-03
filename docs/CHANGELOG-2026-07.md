# Cambios — Julio 2026

Documento de referencia del trabajo realizado sobre **backIndians** (backend) y
**frontIndians** (frontend/tienda). Ordenado por tema, con el _qué_, el _por qué_,
los archivos tocados y los pasos de deploy.

> Resumen ejecutivo: endurecimiento de seguridad completo, sincronización en
> vivo sistema↔tienda, logo/branding en facturas y mails, optimización de la
> base (índices + pool MySQL), fix del funnel de conversión, y una nueva sección
> de **analytics de audiencia + carritos abandonados** con email de recupero.
> Todo verificado: `tsc`, build de producción y **109 tests** en verde.

---

## 1. Endurecimiento de seguridad

### Prioridad alta
- **Socket.io ahora exige JWT del sistema** (`io.use` en `src/config/socket.ts`).
  Los eventos en vivo llevan PII de clientes (nombres, emails, totales) y el
  backend es público; sin auth, cualquiera podía conectarse y escucharlos. La
  tienda pública **no** usa socket.io (usa SSE), así que no se ve afectada.
- **Stock atómico en el checkout** (`src/services/store.service.ts`). El
  descuento de stock se hace con `UPDATE ... WHERE stock_quantity >= qty` dentro
  de la transacción (409 si se agotó). Elimina la sobreventa cuando dos clientes
  compran el último ítem a la vez.
- **Retry ante colisión de número de pedido**: dos checkouts simultáneos podían
  generar el mismo `ECOM-YYYYMMDD-NNNN` → el segundo cliente recibía un 500 en
  pleno pago. Ahora reintenta hasta 3 veces regenerando el número.

### Prioridad media
- **Tokens de verificación de email / reset con vencimiento** (24 h / 1 h) —
  migración **051** (`store_customers.token_expires_at`). Se validan y limpian al
  consumir.
- **`verifyStoreToken` valida `type === 'store_customer'`**: un JWT del sistema
  no puede autenticar en la tienda aunque compartan secreto.
- **Google OAuth exige `email_verified`**: no se vincula la cuenta a un email de
  Google no verificado (anti account-takeover).
- **`GET /store/orders/:n/status` no expone `total_amount`**: los números de
  pedido son secuenciales/adivinables; el endpoint público ya no filtra montos.
- **Cupones `used_count` atómico**: respeta `max_uses` bajo concurrencia.
- **Webhooks de MercadoPago validan firma HMAC** (`x-signature`) si
  `MP_WEBHOOK_SECRET` está seteado. Aplica a los dos webhooks (tienda y
  catálogo). Sin el secreto, comportamiento anterior (el pago igual se verifica
  contra la API de MP).

### Prioridad baja
- **Refresh tokens revocables** — migración **052** (`store_customers.session_version`).
  Un reset de contraseña incrementa `session_version` e invalida los refresh
  tokens previos (antes seguían válidos 30 días).
- **Comprobantes de transferencia con URLs firmadas** — migración **053**
  (`payment_proof_public_id`, `payment_proof_public_id_2`). Se suben a Cloudinary
  como `authenticated` (no accesibles por URL pública) y se sirven con URLs
  firmadas generadas en cada lectura. Compatible con comprobantes viejos
  (públicos, sin `public_id`).
- **Cap de 5 conexiones SSE por IP** y **body JSON limitado a 1 MB** (antes 10 MB).
- **JSON-LD escapado** (`frontIndians/src/components/seo/JsonLd.tsx`): escapa
  `<`, `>`, `&` para que un título de producto con `</script>` no rompa/inyecte
  en la página.

### Dependencias
- Eliminado `nodemailer` (+ `@types/nodemailer`): 0 usos (todo el mail va por
  Resend) y arrastraba un advisory HIGH. `uuid` → `^11.1.1`.
- Frontend `npm audit fix`: parchea `ws`, `form-data`, `react-router`,
  `dompurify` → **0 vulnerabilidades**.

---

## 2. Sincronización en tiempo real sistema ↔ tienda

Dos canales, ambos _fire-and-forget_ (no cortan checkout ni pago):

- **Sistema → Tienda (SSE)**: al cargar/editar/borrar un producto, el backend
  emite `products_changed` (`storeEvents`) → endpoint `GET /store/events` → la
  tienda (`StoreLayout.tsx`, `EventSource`) refresca productos automáticamente.
- **Tienda → Sistema (socket.io)**:
  - `notification:store_order_created` — al crear un pedido en el checkout
    (cualquier método de pago). Antes los pedidos en efectivo/transferencia no se
    veían en vivo hasta el pago.
  - `notification:store_payment` — al acreditarse/rechazarse un pago.

Handlers en `frontIndians/src/hooks/useSocket.ts` (filtran por rol).

---

## 3. Branding en facturas y mails

- **Logo de indians en la cabecera de las facturas PDF** (sistema y tienda):
  isotipo vectorial (extraído del favicon) + wordmark. `src/utils/logo.ts`,
  usado por `pdf.ts` y `store.pdf.ts`.
- **Mails de confirmación de pedido y de factura** ahora usan el template de
  marca compartido (`emailWrapper` de `mailer.ts`): logo, tarjeta, footer.

---

## 4. Optimización de la base de datos

- **Pool MySQL** (`src/config/db.ts`): `max` de 4 → **10**, más
  `enableKeepAlive`, `keepAliveInitialDelay` y `connectTimeout`. Corrige los
  `Aborted_connects` / `Aborted_clients` que se veían en Railway (el pool se
  agotaba en picos y los sockets a `mysql.railway.internal` se cortaban).
- **Índice faltante** — migración **054** (`store_customers.verification_token`):
  los lookups de verify-email/reset eran full scan.
- **Nota de análisis**: casi todas las FKs se declaran con `references:` en las
  migraciones → InnoDB las auto-indexa. Los "Full Joins" / "Table Scan Ratio"
  altos de las métricas son scans de tablas chicas + contadores acumulados, no
  joins sin índice (Slow Queries = 0). No hacía falta agregar más índices.

---

## 5. Fix del funnel de conversión

El dashboard de "Comportamiento" mostraba 0 en carrito/checkout/compras porque el
frontend solo emitía `product_view` y `search`. Se agregaron los eventos
faltantes:
- `cart_add` — `ProductCard.tsx` (quick-add) y `StoreProductDetailPage.tsx`.
- `checkout_start` — `StoreCheckoutPage.tsx` (al montar con ítems).
- `purchase` — `StoreCheckoutPage.tsx` (al confirmarse el pedido, 1 por producto).

El backend ya soportaba los 4 tipos. **Las métricas no son retroactivas**: la
data útil se acumula desde este deploy.

---

## 6. Analytics de audiencia + carritos abandonados (nuevo)

### Métricas de audiencia — `GET /store/admin/audience?period=YYYY-MM`
`getAudienceMetrics()` en `src/services/storeAnalytics.service.ts`:

| Métrica | Cálculo |
|---|---|
| `units_sold` + `units_daily` + `units_monthly` | Unidades de `store_order_items` en pedidos pagados (`paid/processing/shipped/delivered`), por día del período y por mes del año |
| `unique_buyers` | `COUNT(DISTINCT customer_email)` sobre pedidos pagados |
| `registered_customers` + `new_customers` | Total de `store_customers` y nuevos del período |
| `unique_visits` | `COUNT(DISTINCT session_id)` en `store_events` |
| `avg_session_seconds` | `AVG(TIMESTAMPDIFF(SECOND, MIN, MAX))` por sesión (aprox) |

### Carritos abandonados (solo clientes logueados)
`src/services/abandonedCart.service.ts`:
- Reconstruye desde `store_events` los `cart_add` **sin `purchase` posterior**
  (ventana 30 días; antigüedad mínima 3 h para no mailear a quien compra ahora).
- `GET /store/admin/abandoned-carts` — listado accionable (excluye ya recordados).
- `POST /store/admin/abandoned-carts/:customerId/send` — envía el email de
  recupero (`sendAbandonedCartEmail`, template de marca) y registra el
  recordatorio. **Idempotente por carrito**: no reenvía si ya se recordó ese
  mismo carrito (dedup por `sent_at >= last_cart_add`); vuelve a ser elegible si
  el cliente agrega productos nuevos.
- **Envío manual** desde el panel (no hay cron).
- Migración **055**: tabla `store_cart_reminders` + modelo `StoreCartReminder`.

### Frontend
Tab "Comportamiento" de `EcommercePage.tsx`: bloque **Audiencia** (6 KPIs) +
unidades por mes (barras) / por día (tabla) + sección **Carritos abandonados**
con botón "Enviar email" por cliente. API en `frontIndians/src/api/store.ts`
(`storeAdminApi.audience / abandonedCarts / sendAbandonedCart`).

> Depende de que el funnel emita `cart_add` (sección 5). Solo aparecen carritos
> de clientes que agregaron **estando logueados** (son los que tienen email en el
> server).

---

## 7. Pruebas

- **Nuevo robot**: `src/__tests__/api/store-analytics.test.ts` (8 tests).
  Siembra un cliente con un `cart_add` backdateado 5 h, ejercita los endpoints
  admin y verifica el flujo completo: aparece en la lista → se envía el email
  (mockeado) → desaparece por el dedup → reenvío da 400. Cubre también auth (401)
  y la forma de la respuesta de audiencia. Limpia todo al final.
- Suite total: **109 tests / 18 suites** en verde.

### Cómo correr los tests
```bash
cd backIndians
npm run migrate        # DB local migrada (incluye 051–055)
npm run seed           # usuarios admin/roles
npm test               # jest, serial (maxWorkers:1), contra MySQL local
```

---

## 8. Migraciones nuevas (051 → 055)

| # | Tabla / columna | Motivo |
|---|---|---|
| 051 | `store_customers.token_expires_at` | Vencimiento de tokens de verificación/reset |
| 052 | `store_customers.session_version` | Revocación de refresh tokens |
| 053 | `store_orders.payment_proof_public_id(_2)` | URLs firmadas de comprobantes |
| 054 | índice `store_customers.verification_token` | Lookup era full scan |
| 055 | tabla `store_cart_reminders` | Dedup de recordatorios de carrito |

Todas reversibles (`down`) y corren solas en el redeploy por el
`startCommand = "npm run migrate && npm start"` de `railway.toml`.

---

## 9. Variables de entorno nuevas

| Variable | Dónde | Nota |
|---|---|---|
| `MP_WEBHOOK_SECRET` | Railway (backend) | Opcional. Si se setea (valor del panel MP → Webhooks), valida la firma `x-signature` de los webhooks. Sin setear, no rompe nada. |

---

## 10. Checklist de deploy

1. **Backend** (Railway): redeploy → aplica migraciones 051–055 automáticamente.
2. (Opcional) Setear `MP_WEBHOOK_SECRET` en Railway.
3. Confirmar que la variable `MYSQL_URL` del backend referencie el dominio
   **interno** (`mysql.railway.internal`), no el público (`*.proxy.rlwy.net`).
4. **Frontend**: `npm run deploy` (build + FTP a Donweb).
5. Orden sugerido: **primero backend**, después frontend.
6. **Smoke test post-deploy**: login tienda/sistema, un checkout (MP y
   transferencia), subir comprobante y verlo en el admin (URL firmada
   `/authenticated/s--...--/`), navegar la tienda (view → cart → checkout →
   compra) y ver el funnel + audiencia en el panel.
7. **Monitorear en Railway**: `Aborted Connects/Clients` deben dejar de crecer;
   `Slow Queries` en 0.

---

## 11. Deudas conocidas (no bloquean el deploy)

- Paginación del PDF de factura del sistema (pedidos con muchísimos ítems pisan
  el footer; el de tienda ya corta el bucle).
- Tokens en `localStorage` (migrar a cookies httpOnly es un cambio grande).
- Cache CDN de hasta ~20 s en el listado público de productos (decisión de
  performance, no bug).
