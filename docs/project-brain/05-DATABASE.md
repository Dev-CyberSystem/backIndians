# 05 — Base de datos

## Motor

MySQL (dialecto `mysql2` vía Sequelize 6.37). Charset `utf8mb4` / collation `utf8mb4_unicode_ci` a nivel `define`. Conexión: `MYSQL_URL`/`MYSQL_PUBLIC_URL` en producción (Railway) o `DB_HOST/PORT/NAME/USER/PASSWORD` en desarrollo. Fuente: `backIndians/src/config/db.ts`, `backIndians/config/sequelize.js`.

## Mecanismo particular de este proyecto: migraciones + `sync()` + `ensureSchema` + `dedupeIndexes`

Esto es lo primero que hay que entender antes de tocar el esquema, porque no es el patrón Sequelize estándar:

1. **Producción** (Railway): `railway.toml` corre `npm run migrate` (= `sequelize-cli db:migrate`) antes de `npm start` en cada deploy. El esquema de producción se gobierna por las 91 migraciones de `backIndians/migrations/`.
2. **Desarrollo**: `connectDB()` (`src/config/db.ts`), si `NODE_ENV !== 'production'`, corre `dedupeIndexes()` y luego `sequelize.sync()` **sin `{ alter: true }`** — esto crea tablas que falten pero **no altera** columnas de tablas que ya existen. Comentario explícito en el código: en desarrollo se busca evitar tener que migrar a mano constantemente, pero `sync()` sin alter se queda corto para cambios de columnas.
3. Por eso existe **`src/config/ensureSchema.ts`**, llamado siempre (dev y producción) desde `server.ts` inmediatamente después de `connectDB()`: aplica de forma idempotente un subconjunto de cambios de esquema que `sync()` no cubre (columnas de `garment_types`, ENUMs de `store_orders.status`, columnas/índice de `tracking_token`, seed de `tracking_link_expiry_days`). Tiene guardas explícitas para no reconstruir un ENUM de MySQL si el valor ya existe (un `ALTER` de ENUM bloquea la tabla).
4. **`src/config/dedupeIndexes.ts`** existe porque `sync()` en desarrollo, ejecutado repetidas veces con tablas que tienen referencias cíclicas, puede recrear índices únicos/FK duplicados con nombres autogenerados distintos — y MySQL tiene un **límite de 64 índices por tabla**. `dedupeIndexes()` recorre `information_schema`, agrupa por firma (unicidad + columnas) y borra los duplicados numerados, dejando uno.

**Consecuencia operativa**: cambiar el esquema en este proyecto casi siempre requiere **dos ediciones** si el cambio es de los que `ensureSchema.ts` replica (ver inconsistencia #5 abajo) — o una sola si es un cambio nuevo que solo necesita migración (`sync()` en dev alcanza para tablas nuevas completas). Antes de crear una migración, revisar si `ensureSchema.ts` necesita el mismo cambio reflejado para que desarrollo sin migrar (`sync()`) siga viendo el mismo esquema que producción.

## Migraciones — resumen por bloques (91 archivos, `backIndians/migrations/`, rango `000` a `089`)

Todas usan guards idempotentes (`describeTable`/`showAllTables`/`information_schema`) para poder correr sobre un esquema que ya pudo haberse creado por `sync()`.

| Rango | Fecha | Tema |
|---|---|---|
| 000–010 | 2026-05-13/14 | Esquema base: `users`, `clients`, `orders`, `order_items` (ficha técnica inicial), `invoices`, `order_images`, `order_status_history`, `garment_types`, `fabric_types`, `size_charts`, `password_reset_tokens`, `order_number`+`seller_id`, ENUMs de estado iniciales |
| 011–017 | 2026-05-15 / 06-01/02 | `settings` (key-value), extensión de `invoices` (descuentos/extras), `stock_categories`/`stock_movements`, índices simples en `orders`/`invoices`/`stock_items`, `session_version` |
| 018 | 2026-06-05/06 | **Caja** (`cash_accounts`, `cash_transaction_categories`, `cash_transactions`) y **catálogo mayorista** (`catalog_products`, `catalog_product_images`, `catalog_orders`, `catalog_order_items`) — dos migraciones distintas comparten el número 018 (ver inconsistencia #3) |
| 019–028 | 2026-06-06/07/10 | Catálogo: stock, talles (`catalog_product_sizes`), `catalog_invoices`, `catalog_invoice_images`, pagos parciales (`invoice_payments`, `catalog_invoice_payments`), índices compuestos, multi-tela + tabla de talles en `order_items` |
| 029 | 2026-06-17 | Estados `sewing`/`stamping`, `players_data` (JSON) en `order_items` |
| 030–049 | 2026-06-19 a 06-27 | **Tienda online**: `store_customers`, `store_addresses`, `store_coupons`, `store_orders`, `store_order_items`, seeds de settings de landing, categoría/género en catálogo, descuentos, métodos de pago (`payment_method`, comprobantes de transferencia), índice por email, `product_categories` (sin uso posterior, ver inconsistencia #1), **controles de producción** (`order_checklist_checks` + ENUM ampliado, migración 046), índices de performance de tienda, `store_wishlist`, `store_events` |
| 050–058 | 2026-07-01 a 07-10 | Estado de mail de bienvenida, expiración de token de verificación, `session_version` de tienda, comprobantes con `public_id` de Cloudinary, índice de verificación, `store_cart_reminders`, seed de talles (14), ficha técnica: puño, separación marca/escudo |
| 059–066 | 2026-07-24 | **Costos de prendas por cliente**: `cost_category`, `garment_cost_items` (maestro), `garment_costs`+`garment_cost_versions`+`garment_cost_version_items` (versionado), `order_cost_details` (snapshot), `garment_types.client_id`, unique compuesto `(client_id, name)`, **tracking de pedidos de tienda** (`tracking_token`, `store_order_status_history`) |
| 067–073 | 2026-08-04 | Ledger de stock de catálogo (`catalog_stock_movements`), `stock_restored_at`, `idempotency_key`, `catalog_product_size_id` en `store_order_items` (+ backfill), `webhook_events` (idempotencia), `mp_payment_date` |
| 074–078 | 2026-08-04 | **AFIP/ARCA**: `clients.condicion_iva`, bloque de 12 columnas AFIP replicado en `invoices`/`catalog_invoices`/`store_orders`, seed de settings `afip_*` (renumeradas desde 050-054 de la branch `integracionarca` para no chocar) |
| 079–089 | 2026-08-04 | **Fase 2 de auditoría de tienda**: `stock_reserved` en catálogo, columnas de reserva/confirmación de stock en `store_orders` (+ backfill de datos históricos), ENUM `reserve`/`release`, usuario "Sistema" (ancla de FK para procesos automáticos), categoría de caja del sistema, `reference_type='store_order'`, `cash_recorded_at`, **devoluciones** (`store_returns`, `store_return_items`) |
| 090 | 2026-08-06 | **Auditoría inmutable de caja** (`cash_audit_events`): Fase 1 del plan de corrección del módulo de caja. Tabla **append-only** — sin `updatedAt`, con hooks de modelo que bloquean `update`/`destroy`, y sin ningún endpoint de escritura (solo `GET /cash/audit`, restringido a `admin`). Registra `entity_type`/`entity_id`/`action`, usuario, `before_json`/`after_json`, motivo, IP, user-agent y `correlation_id` (cruzable con el log HTTP de Pino). Ver `backIndians/documentos/PLAN_CORRECCION_CAJA_2026-08-06.md` |
| 091 | 2026-08-06 | **Inmutabilidad y reversión de `cash_transactions`**: Fase 2 del plan de corrección de caja. Agrega `status` (`active`/`reversed`), `reversal_of_id` (self-FK), `reversal_reason`, `reversed_at`/`reversed_by`, `idempotency_key`. **`idempotency_key` es único a nivel de índice, pero deliberadamente NO tiene `unique: true` en el atributo del modelo Sequelize** (a diferencia de `store_orders.idempotency_key`, migración 069) — declararlo en ambos lados genera un índice duplicado bajo `sync()` en desarrollo, que hoy `dedupeIndexes.ts` tiene que limpiar en cada arranque para `store_orders`. No repetir ese patrón en columnas `idempotency_key` nuevas. ⚠️ **Bug conocido en `down()` (hallado en la Fase 7 de validación, 2026-08-07, sin corregir a propósito):** `db:migrate:undo:all` falla en esta migración con `Cannot drop index 'idx_cash_transactions_reversal_of': needed in a foreign key constraint` — el índice de `reversal_of_id` se intenta borrar antes que la FK que lo usa. Solo afecta el camino de rollback (nunca se ejecuta en producción, que solo corre migraciones hacia adelante); no se corrige acá porque la migración ya está commiteada (regla de `CLAUDE.md`: no editar una migración existente). Si algún día hace falta un rollback real de esta migración, hay que borrar primero la FK de `reversal_of_id` y recién después el índice. |
| 092 | 2026-08-06 | **Reversión automática de caja en cancelaciones/devoluciones**: Fase 4 del plan de corrección de caja. Agrega `cash_reversed_at` a `store_orders` (cancelación total) Y a `store_returns` (cada devolución) — **dos columnas separadas, no una**: `store_returns.refunded_amount`/`refund_status` permiten devoluciones parciales y varias devoluciones sobre el mismo pedido, así que la marca de idempotencia tiene que vivir en la devolución, no solo en el pedido. |

Para el detalle migración-por-migración completo (los 91 archivos con su descripción exacta), no se transcribe acá para no duplicar contenido difícil de mantener — está relevado y puede volver a extraerse leyendo `backIndians/migrations/*.js` en orden; los nombres de archivo son autodescriptivos (`NNN-verbo-descripcion.js`).

## Tablas por dominio

| Dominio | Tablas |
|---|---|
| Usuarios/Auth | `users`, `password_reset_tokens` |
| Clientes | `clients` |
| Pedidos/producción | `orders`, `order_items`, `order_images`, `order_status_history`, `garment_types`, `fabric_types`, `size_charts` |
| Checklist de calidad | `order_checklist_checks` (la definición de qué ítems tiene cada checklist vive en código, `src/config/orderChecklists.ts`, no en DB) |
| Stock de insumos | `stock_items`, `stock_categories`, `stock_movements` |
| Facturas (fábrica) | `invoices`, `invoice_payments` |
| Caja | `cash_accounts`, `cash_transaction_categories`, `cash_transactions` |
| Costos de prendas | `garment_cost_items`, `garment_costs`, `garment_cost_versions`, `garment_cost_version_items`, `order_cost_details` |
| Catálogo mayorista | `catalog_products`, `catalog_product_images`, `catalog_product_sizes`, `catalog_orders`, `catalog_order_items`, `catalog_invoices`, `catalog_invoice_images`, `catalog_invoice_payments`, `catalog_stock_movements` |
| Catálogo genérico (legado, sin uso) | `products`, `product_categories` |
| Tienda — compradores | `store_customers`, `store_addresses` |
| Tienda — carrito/eventos | `store_events`, `store_cart_reminders`, `store_wishlist` |
| Tienda — pedidos | `store_orders`, `store_order_items`, `store_order_status_history`, `store_coupons` |
| Tienda — devoluciones | `store_returns`, `store_return_items` |
| AFIP | sin tabla propia — columnas `afip_*` embebidas en `invoices`, `catalog_invoices`, `store_orders` + settings `afip_*` |
| Settings | `settings` (key STRING PK, value TEXT) |
| Idempotencia/logs | `webhook_events` |

## Modelos y relaciones — puntos relevantes

- ~46 modelos, ~70 asociaciones definidas en `src/models/index.ts`. Ninguna relación `belongsToMany` explícita; las many-to-many (ej. `store_wishlist`) se modelan como tabla puente con PK compuesta + dos `belongsTo`.
- `onDelete: CASCADE` en relaciones de detalle (ítems, imágenes, historial, checks); `SET NULL`/`RESTRICT` en relaciones donde el padre puede desaparecer sin arrastrar al hijo (ej. `client_id` en `catalog_orders`).
- Patrón consistente: getters en el modelo que castean DECIMAL (string en MySQL) a `number` en todos los campos monetarios/cantidades.
- Índice único notable: `order_checklist_checks (order_id, status, item_key)` — ver [BR-ORDER-003](03-BUSINESS-RULES.md).
- `StoreOrder` es el modelo más grande (~35 campos): snapshot del comprador, montos, envío, cupón, MercadoPago, tracking, reserva/confirmación/restitución de stock, caja, comprobantes (x2), AFIP.

## Datos sensibles

- **Nunca en el repo versionado**: `.env`, `.env.bak`, `documentos/Users.txt` (credenciales reales en texto plano — confirmado en `.gitignore`, no leído por esta auditoría por instrucción explícita).
- **Passwords de seed**: los seeders de desarrollo (`admin@textil.com`, `vendedor@textil.com`, etc.) usan contraseñas genéricas de ejemplo tipo `Admin123!` — no son secretos reales, están pensadas para entornos locales/demo.
- **`seeders/reset-admin-prod.ts`**: contiene, dentro de un comentario de instrucciones de uso, un ejemplo de comando con valores que podrían ser credenciales reales de producción — **señalado como riesgo a confirmar y potencialmente rotar**, no reproducido en esta documentación.
- Comprobantes de pago de la tienda (transferencias) se suben a Cloudinary con URLs **firmadas/autenticadas** (`authenticated`), no públicas.

## Inconsistencias detectadas (verificadas, no corregidas — este documento es de diagnóstico)

1. **`products`/`product_categories` sin uso funcional**: `Product` tiene modelo (`tableName: 'products'`) pero **ninguna migración crea esa tabla** — solo existiría en un entorno donde `sync()` la creó. `ProductCategory` sí tiene migración (045) pero ningún service/route la referencia. Ninguno de los dos se usa fuera de `models/index.ts` y `seeders/index.ts`. Candidatos a limpieza, pendiente de confirmar con el equipo si hay planes de reactivarlos.
2. **Numeración de migración duplicada**: `20260605-018-create-cash-flow.js` y `20260606-018-create-catalog-tables.js` comparten el número `018` (el prefijo de fecha desambigua para `sequelize-cli`, no rompe nada, pero indica un merge de branches en paralelo sin renumerar). El rango 074-078 (AFIP) fue **explícitamente renumerado** desde 050-054 por el mismo motivo (comentado en el propio archivo).
3. **Índices posiblemente redundantes**: `idx_orders_created_at` (migración 016, columna única `createdAt`) vs. `idx_orders_created_at_status` (migración 024, compuesto `createdAt, status`) — MySQL puede resolver por la columna líder del compuesto, haciendo el primero candidato a redundante. Mismo patrón en `invoices` (`issue_date` vs `issue_date, status`). Ninguno fue eliminado después.
4. **Lógica de esquema duplicada entre migraciones y `ensureSchema.ts`**: las migraciones 059/063/064/065/066 están replicadas casi línea por línea en `ensureSchema.ts` (intencional, para que dev sin migrar vea el mismo esquema). Riesgo: si se edita un lado sin el otro, dev y producción divergen silenciosamente.
5. **`Order.order_number` — modelo vs. migración**: el modelo TS lo declara `allowNull: true`, mientras que la migración 005 lo deja `NOT NULL` tras backfill. No es necesariamente un bug (puede ser solo imprecisión de tipado), pero conviene confirmar contra `DESCRIBE orders` en la base real antes de asumir cuál es la fuente de verdad.
6. **`OrderChecklistCheck` define su índice único tanto en el modelo (`indexes:` en las opciones de `Model.init`) como en la migración 046** — con `sync()` activo en desarrollo esto puede generar un segundo índice con nombre autogenerado, exactamente el escenario que `dedupeIndexes()` existe para mitigar.
7. **`store_wishlist` sin `timestamps` estándar**: usa `timestamps: false` + columna manual `created_at` (snake_case), rompiendo la convención `createdAt`/`updatedAt` camelCase del resto del proyecto.

## Efectos de operaciones importantes (resumen)

| Operación | Efecto en cascada |
|---|---|
| Confirmar pago de un pedido de tienda | resta stock real (`stock_confirmed_at`), registra ingreso en caja (`cash_recorded_at`, requiere `store_cash_account_id` configurado), dispara mail de confirmación |
| Cancelar/expirar un pedido de tienda | restituye stock reservado o confirmado (`stock_restored_at`), libera cupón usado |
| Aprobar una devolución (ítem `resellable`) | restituye stock (`restocked_at`) |
| Editar una hoja de costos (`GarmentCost`) | crea nueva `GarmentCostVersion`; pedidos ya creados no cambian (snapshot en `OrderCostDetail`) |
| Enviar a AFIP | solo si `afip_enabled='true'`; actualiza `afip_status`/`afip_cae`/`afip_cae_vto` en el documento correspondiente |

## Actualizar este documento cuando…

Se agregue una migración, se cree/modifique un modelo, o se corrija alguna de las inconsistencias listadas arriba (mover a "histórica" con referencia al commit que la resolvió).
