# 06 — API interna e integraciones externas

Todos los endpoints internos cuelgan de `/api/v1` (montaje en `backIndians/src/routes/index.ts`). Roles: `admin` | `billing` | `workshop` | `seller` (staff); comprador de tienda no tiene roles, solo autenticado/no autenticado.

## Endpoints internos por router

### `/auth` — `auth.routes.ts` (staff)
| Método | Ruta | Auth | Notas |
|---|---|---|---|
| POST | `/login` | pública | rate limit 10/15min |
| POST | `/refresh` | pública | — |
| POST | `/logout` | autenticado | no-op real, ver [BR-AUTH-002](03-BUSINESS-RULES.md) |
| GET | `/me` | autenticado | — |
| POST | `/forgot-password` | pública | rate limit 5/h |
| POST | `/reset-password` | pública | rate limit 10/15min |

### `/users` — `user.routes.ts` — todo `authorize('admin')`
CRUD de usuarios internos: `GET /`, `POST /`, `PUT /:id`, `PATCH /:id/toggle`, `POST /:id/resend-welcome`, `PATCH /:id/password`, `DELETE /:id`.

### `/clients` — `client.routes.ts`
`GET /`, `GET /:id` → `admin,billing,seller`. `POST /`, `PUT /:id` → `admin,billing,seller`. `DELETE /:id` → `admin`.

### `/orders` — `order.routes.ts` — todo autenticado
`GET /`, `GET /:id`, `GET /:id/pdf`, `GET /:id/history` → cualquier rol. `POST /` → `admin,billing,seller`. `PUT /:id` → cualquier rol (permisos finos en el service). `DELETE /:id` → `admin`. `POST/DELETE /:id/images` → `admin,billing,seller`. `POST/DELETE /:id/items/:itemId/size-chart` → imagen de tabla de talles. `GET /:id/checklist` → cualquier rol; `POST /:id/checklist` → `workshop,admin`.

### `/stock` — `stock.routes.ts`
`authorize('admin','billing','workshop')` salvo `/available`. Categorías (`GET/POST/PUT`, `DELETE` solo admin), movimientos (`GET/POST`), materiales (`GET`, `POST/PUT` admin+billing, `DELETE` admin+billing), `/metrics`.

### `/invoices` — `invoice.routes.ts`
`GET /`, `GET /by-order/:orderId`, `GET /:id`, `GET /:id/pdf` → cualquier rol autenticado. `PUT /:id`, `POST /:id/payments` → `admin,billing`.

### `/cash` — `cash.routes.ts` — todo `authorize('admin','billing')`
`/summary`, cuentas (CRUD+toggle), categorías (CRUD+toggle).
`GET /audit` → **solo `admin`**: consulta de la auditoría inmutable de caja (`cash_audit_events`, migración 090), filtrable por `entity_type`/`entity_id`/`action`/`user_id` con paginación backend. **No existe ningún endpoint de escritura o borrado de auditoría, y no debe agregarse**: la tabla es append-only y el modelo bloquea `update`/`destroy` por hook.

**Transacciones (rediseñadas en la Fase 2 del plan de corrección de caja, 2026-08-06 — ver `BR-CASH-003`):**
`GET /transactions` (filtros incl. `status`), `GET /transactions/:id`, `POST /transactions` (acepta `idempotency_key` opcional). **`PUT` y `DELETE` de transacciones ya NO existen — no agregarlos de vuelta.** En su lugar:
- `PATCH /transactions/:id` → edita solo `description`/`notes`/`category_id`; nunca campos financieros aunque el body los traiga.
- `POST /transactions/:id/reverse` → `{ reason (≥10 chars), amount? }`, único camino para corregir un importe. Crea un contraasiento (tipo/cuenta invertidos), soporta reversión parcial, deja el original intacto salvo `status`/`reversed_at`/`reversed_by`.

### `/catalog` — `catalog.routes.ts`
`POST /webhook/mp` → **sin auth** (webhook MP del catálogo mayorista). Resto autenticado. Categorías CRUD → `admin,billing`. Productos: lectura abierta, escritura `admin,billing`; `PATCH /products/:id/stock`, `PUT /products/:id/sizes`, imágenes (máx 3/producto). Pedidos: creación `admin,billing,seller`; `PATCH /orders/:id/status`, `POST /orders/:id/payment` (genera preferencia MP). Facturas de catálogo: CRUD, pagos, imágenes.

### `/store` — `store.routes.ts` (el más grande, mezcla público + comprador + admin)
- **Público**: `/settings` (cache 60s), `/events` (SSE), auth de comprador (`register`, `verify-email`, `login`, `google`, `refresh`, `forgot/reset-password`), `/track`, `/trending`, `/products*`, `/coupons/validate`, `/checkout/quote`, `POST /checkout` (con `Idempotency-Key`, `checkoutLimiter`), `/payment/confirm`, `/orders/:orderNumber/status`, `/track/:token`, `POST /orders/:orderNumber/payment-proof`, `POST /webhook/mp` (`webhookLimiter`).
- **Comprador autenticado** (`requireStoreAuth`): `/me`, `/me/addresses`, `/me/orders`, `/me/orders/:orderNumber/invoice`, `/tracking`, `/me/wishlist*`.
- **Admin** (`authenticate` + `authorize('admin','billing')`): `/admin/orders*`, `/admin/returns*`, `/admin/coupons*`, `/admin/metrics`, `/admin/event-analytics`, `/admin/audience`, `/admin/abandoned-carts`.

### `/` (raíz de `/api/v1`) — `afip.routes.ts` — todo `authorize('admin','billing')`
`POST /invoices/:id/afip`, `POST /catalog/invoices/:id/afip`, `POST /store/orders/:id/afip`, `GET /afip/stats`.

### `/costs` — `cost.routes.ts` — todo `authorize('admin','billing')`
`GET /items?category=`, `POST /preview`, `GET /orders/:orderId`, `GET /clients/:clientId`, `GET/PUT /clients/:clientId/garments/:garmentTypeId`, `GET .../history`.

### `/master` — `master.routes.ts`
Lectura abierta a todo rol autenticado; escritura `admin` (cost-category también `billing`). Tipos de prenda, tipos de tela, talles.

### `/dashboard` — `dashboard.routes.ts` — todo `authorize('admin','billing')`
`GET /summary`, `GET /sellers`.

### `/settings` — `settings.routes.ts` — todo `authorize('admin','billing')`
`GET /`, `PUT /`.

### `/logs` — `logs.routes.ts` — pública (a propósito)
`POST /client` (rate limit 60/min) — ingesta de logs del frontend.

### `/upload` — `upload.routes.ts` — autenticado
`POST /` — sube a Cloudinary.

### `/products` — `product.routes.ts` — autenticado, escritura `admin`
CRUD del catálogo genérico legado (`Product`/`ProductCategory`) — **sin uso funcional confirmado en el resto de la app**, ver [05-DATABASE.md](05-DATABASE.md) inconsistencia #1.

## Integraciones externas

### AFIP/ARCA (facturación electrónica)
- **Estado**: Implementado y verificado en código, commiteado; **deshabilitado en producción** por defecto (`afip_enabled=false`, sin certificado real cargado).
- **Cómo**: WSAA (autenticación por certificado, TRA firmado con CMS/PKCS#7 vía `node-forge`) + WSFEv1 (SOAP, `soap` package) para solicitar CAE.
- **Servicio**: `backIndians/src/services/afip.service.ts`.
- **Gate de seguridad**: `assertAfipEnabled()` — ver [BR-AFIP-001](03-BUSINESS-RULES.md).
- **Env vars**: `AFIP_CERT_BASE64`, `AFIP_KEY_BASE64` (certificado/clave en base64; vacías por defecto).
- **Settings relacionados** (tabla `settings`, no env): `afip_enabled`, `afip_environment` (`homo`/`prod`), `afip_punto_venta`, `afip_concepto_default`.
- **Frontend**: `frontIndians/src/components/afip/AfipButton.tsx`, `AfipSendModal.tsx`, `src/api/afip.ts`.

### MercadoPago (pagos)
- **Estado**: Implementado y verificado — Checkout Pro (Preference), no QR dinámico de cobro presencial.
- **Servicio**: `backIndians/src/services/mercadopago.service.ts` — `createPreference`, `getPreference`, `getPaymentInfo`, `searchPaymentsByReference`, `verifyWebhookSignature` (HMAC-SHA256, fail-closed en producción si falta `MP_WEBHOOK_SECRET`).
- **Webhooks**: `POST /catalog/webhook/mp` (catálogo mayorista) y `POST /store/webhook/mp` (tienda) — ambos con verificación de firma e idempotencia vía tabla `webhook_events`.
- **Reconciliación**: job programado (`backIndians/src/jobs/reconcilePayments.ts`) cada ~10 min, para pagos cuyo webhook no llegó.
- **Env vars**: `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` (obligatoria en producción, el server no arranca sin ella).
- **Frontend**: sin SDK embebido; redirect a `init_point`/`sandbox_init_point`, polling de estado en `StoreCheckoutPendingPage`. En catálogo mayorista se renderiza el link como QR (`qrcode.react`), no es la API de QR de MP.

### Email — Resend (tienda) + SMTP (panel admin)
- **Estado**: Implementado y verificado. Cola **en proceso**, no persistente (documentado explícitamente en el código — no sobrevive un reinicio).
- **Resend** (`backIndians/src/utils/email.service.ts`): verificación de cuenta, confirmación de pedido, pago aprobado/rechazado, comprobante de compra, cambio de estado de pedido (uno por transición configurada como notificable), reset de password de tienda, carrito abandonado.
- **SMTP** (`backIndians/src/utils/mailer.ts`): bienvenida y reset de password de usuarios internos del sistema.
- **Cola**: `backIndians/src/utils/emailQueue.ts` — `setImmediate` + reintentos con backoff (máx 3 intentos), en memoria de proceso.
- **Env vars**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- **Dominio de envío**: `@indians.com.ar` (default hardcodeado si no hay env).

### Cloudinary (almacenamiento de imágenes)
- **Estado**: Implementado y verificado.
- **Uso**: imágenes de pedidos, tabla de talles, productos de catálogo (hasta 3 por producto, normalizadas a 3:4 / 1200x1600), comprobantes de transferencia (URLs **firmadas/autenticadas**, no públicas), logos.
- **Config**: `backIndians/src/config/cloudinary.ts`.
- **Env vars**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

### Google OAuth (login social de tienda)
- **Estado**: Implementado y verificado, opcional (si no hay `client_id` configurado, el botón no aparece).
- **Regla**: exige `email_verified=true` del lado de Google — ver [BR-AUTH-004](03-BUSINESS-RULES.md).
- **Env vars**: `GOOGLE_CLIENT_ID` (backend); `VITE_GOOGLE_CLIENT_ID` (frontend).

### Cloudflare Turnstile (anti-bot)
- **Estado**: Implementado, opcional (graceful no-op sin site key).
- **Uso**: registro de compradores en la tienda.
- **Env vars**: `TURNSTILE_SECRET_KEY` (backend); `VITE_TURNSTILE_SITE_KEY` (frontend).

### Andreani (courier) — **NO implementado**
- **Estado**: Planificado, no implementado. Sin código funcional — solo mencionado en documentos de auditoría como decisión de negocio pendiente (requiere research spike de la API: cotización, etiqueta, tracking, credenciales).
- Lo que existe hoy es tracking **manual**: el admin carga transportista + número de guía como texto libre; el sistema genera un link de seguimiento propio (`tracking_token`) y manda mails, sin llamar a ninguna API externa de logística.

### Socket.io (tiempo real interno, no es integración externa)
- Autenticado con JWT del sistema; eventos: `order_created`, `status_changed`, `invoice_created`, `store_order_created`, `store_payment`.
- Config: `backIndians/src/config/socket.ts`; cliente: `frontIndians/src/hooks/useSocket.ts`.

## Variables de entorno (solo nombres, agrupadas — no se leyeron valores reales)

### Backend (`backIndians/.env.example`)
| Grupo | Variables |
|---|---|
| Servidor | `PORT`, `NODE_ENV` |
| DB | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (prod usa `MYSQL_URL`) |
| JWT sistema | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` |
| JWT tienda (no en `.env.example`, con fallback en código) | `STORE_JWT_SECRET`, `STORE_JWT_REFRESH_SECRET` |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| CORS/Frontend | `FRONTEND_URL` (puede ser CSV) |
| Email tienda | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Email sistema | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Anti-bot | `TURNSTILE_SECRET_KEY` |
| Jobs | `RECONCILE_JOB_ENABLED`, `RECONCILE_STALE_MINUTES`, `ORDER_EXPIRY_HOURS` |
| MercadoPago | `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` |
| AFIP | `AFIP_CERT_BASE64`, `AFIP_KEY_BASE64` |
| Google OAuth | `GOOGLE_CLIENT_ID` |
| URLs públicas | `STORE_URL`, `BACKEND_PUBLIC_URL` (no en `.env.example`: `SYSTEM_URL`, fallback a `FRONTEND_URL`) |
| Testing/seguridad | `RATE_LIMIT_DISABLED` (comentada por defecto) |
| Logging | `LOG_LEVEL`, `SERVICE_NAME` |

`server.ts` (`validateEnv()`) exige `JWT_SECRET`+`JWT_REFRESH_SECRET` siempre, y en producción además `BACKEND_PUBLIC_URL` (no localhost) y `MP_WEBHOOK_SECRET` — el proceso no arranca sin esto.

### Frontend (`frontIndians/.env.example`)
| Grupo | Variables |
|---|---|
| API/backend | `VITE_API_URL`, `VITE_SOCKET_URL` |
| SEO/dominios | `VITE_STORE_URL`, `VITE_SYSTEM_URL`, `VITE_SITE_NAME`, `VITE_DEFAULT_SEO_TITLE`, `VITE_DEFAULT_SEO_DESCRIPTION`, `VITE_DEFAULT_OG_IMAGE`, `VITE_GOOGLE_SITE_VERIFICATION` |
| Anti-bot/OAuth | `VITE_TURNSTILE_SITE_KEY`, `VITE_GOOGLE_CLIENT_ID` |
| Deploy FTP (en `.env.deploy`, sin prefijo `VITE_`, solo Node/script) | `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FTP_DIR`, `FTP_SECURE` |

## Actualizar este documento cuando…

Se agregue/quite un endpoint, cambien los roles requeridos, se integre un nuevo servicio externo, o cambie una variable de entorno.
