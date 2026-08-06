# Prompt para Claude Code — Implementación de la auditoría de Tienda Online

> Copiá desde `---INICIO---` hasta `---FIN---` y pegalo en Claude Code abierto en la raíz del proyecto (`C:\Users\USURIO\OneDrive\Escritorio\indians`).

---INICIO---

Actuá como arquitecto de software senior y desarrollador full stack, con criterio de especialista en ecommerce, medios de pago, control de stock y prevención de fraude.

## Contexto

Proyecto **Indians**: monorepo con `backIndians` (Node 20 + Express 4 + Sequelize 6 + MySQL + TypeScript), `frontIndians` (React 19 + Vite + TS + Zustand + TanStack Query + Tailwind) y `e2e` (Playwright).

Ya existe una **auditoría funcional y técnica completa** del módulo de tienda online en:

```
documentos/AUDITORIA_TIENDA_ONLINE_DIAGNOSTICO.md
```

**Leelo COMPLETO antes de hacer cualquier otra cosa.** Contiene el mapa funcional, el flujo real de compra verificado en código, el inventario de archivos, los estados actuales, la matriz de permisos, 8 hallazgos Críticos (C-1..C-8), 11 Altos (A-1..A-11), 15 Medios (M-1..M-15), 7 Bajos (B-1..B-7), el resultado esperado de los 30 casos de prueba y el plan en 4 fases.

Los IDs de hallazgo (`C-1`, `A-7`, `M-9`, ...) y los IDs de tarea (`1.1`..`1.9`) de ese documento son el vocabulario común: usalos en commits, comentarios y reportes.

## Objetivo

Implementar el plan de corrección de forma **incremental, segura y verificable**, empezando por la Fase 1 (correcciones críticas).

## Reglas de trabajo — no negociables

1. **Verificá en el código antes de asumir.** El documento de auditoría es un mapa, no la verdad final. Si algo no coincide con lo que ves en el repo, frená y avisame.
2. **No ejecutes acciones destructivas.** Nada de `db:migrate:undo`, `DROP`, `TRUNCATE`, `DELETE` masivos, ni cambios sobre datos o credenciales de producción. No corras seeders contra la base real.
3. **No modifiques migraciones ya ejecutadas.** Siempre generá migraciones nuevas, con `up` y `down` funcionales y reversibles, siguiendo la convención existente (`migrations/YYYYMMDD-NNN-descripcion.js`, con guardas `if (!tables.includes(...))` cuando aplique). La numeración actual llega a `066`.
4. **Compatibilidad con datos históricos.** Ninguna columna nueva puede ser `NOT NULL` sin default sobre tablas con datos. Todo backfill va en su propia migración y debe ser idempotente.
5. **Transacciones + idempotencia** en toda operación que toque dinero o stock. Nada de efectos laterales parciales.
6. **Centralizá, no dupliques.** Si una regla de negocio ya existe (`utils/money.ts`, `config/storeOrderFlow.ts`), reutilizala. Si hay lógica duplicada entre backend y frontend, dejá el backend como fuente de verdad.
7. **Los efectos laterales no revierten operaciones financieras.** Un mail o un socket que falla nunca puede tumbar una venta confirmada. Pero siempre tiene que quedar logueado (`utils/logger.ts`, `utils/emailQueue.ts`).
8. **Logs útiles, sin datos sensibles.** Nada de tokens, contraseñas, números de tarjeta ni payloads completos del proveedor de pago en los logs.
9. **Validá en backend y en frontend.** El frontend mejora la UX; el backend es el que decide.
10. **Después de cada grupo de cambios**, corré:
    - `cd backIndians && npm run typecheck`
    - `cd frontIndians && npx tsc --noEmit && npx eslint src --max-warnings=0`
    - y los tests que apliquen. Si algo falla, arreglalo antes de seguir.
11. **No avances a la siguiente tarea sin mi OK**, salvo que yo te diga explícitamente que sigas de corrido.

## Metodología por tarea

Para **cada** tarea del plan, seguí este ciclo:

1. **Plan breve** (5-10 líneas): qué vas a tocar, qué archivos, qué migración, qué riesgo, cómo se verifica.
2. **Esperá mi aprobación.**
3. **Implementá**: código + migración + tests.
4. **Verificá**: typecheck, lint, tests, y un diff comentado de lo que cambió.
5. **Reportá**: qué se hizo, qué hallazgo cierra, qué quedó pendiente, si requiere acción manual de mi parte (variables de entorno, panel de MercadoPago, conteo físico de stock, etc.).

Mantené un archivo `documentos/AUDITORIA_TIENDA_ONLINE_AVANCE.md` con el estado de cada hallazgo (`pendiente` / `en curso` / `resuelto` / `descartado`), actualizado al cerrar cada tarea.

## Fase 1 — Correcciones críticas (empezá acá)

Ejecutá en este orden. Las tres primeras son de riesgo casi nulo.

### 1.7 · Renombrar "factura" → "comprobante de compra"  [cierra parte de C-4]
El PDF generado no es una factura fiscal. Renombrar en UI, emails, nombre de archivo y textos (`utils/store.pdf.ts`, `utils/email.service.ts`, `controllers/store.controller.ts`, `pages/ecommerce/EcommerceOrdersPage.tsx`, `pages/store/StoreAccountPage.tsx`). Agregar al PDF la leyenda **"Documento no válido como factura"**.
*Aceptación:* ningún texto de cara al cliente dice "factura"; el PDF lleva la leyenda.

### 1.9 · Higiene de secretos
`backIndians/.env.bak` está versionado. Removelo del repositorio, agregá el patrón a `.gitignore` y decime qué credenciales contiene (por nombre de variable, **sin mostrar valores**) para que yo las rote.
*Aceptación:* el archivo no está en el índice de git; `.gitignore` cubre `.env*` salvo `.env.example`.

### 1.1 · Configuración de MercadoPago  [cierra C-2 y C-3]
- Agregar `BACKEND_PUBLIC_URL` y `MP_WEBHOOK_SECRET` a `backIndians/.env.example` con comentarios explicando para qué sirven.
- Validación de arranque (`src/server.ts` o `src/config/`): si `NODE_ENV=production` y `BACKEND_PUBLIC_URL` falta o apunta a localhost → error fatal con mensaje claro. Ídem si falta `MP_WEBHOOK_SECRET`.
- `verifyWebhookSignature()` (`services/mercadopago.service.ts`): fail-**closed** en producción (hoy hace `if (!secret) return true`). En desarrollo puede seguir siendo permisivo, pero logueando un WARN.
- Rate limiter propio para `POST /store/webhook/mp` en `middlewares/rateLimit.ts`.
*Aceptación:* con secret configurado, una firma inválida devuelve 401; el arranque en producción falla ruidosamente si falta configuración.
*Acción manual mía:* setear ambas variables en Railway y generar el secret en el panel de MP. Recordámelo en el reporte.

### 1.2 · Ledger de stock  [cierra C-5]
Nueva tabla `catalog_stock_movements`:
`id`, `catalog_product_id` (FK), `catalog_product_size_id` (FK nullable), `type` ENUM(`sale`,`return`,`cancel`,`adjustment`,`in`,`out`,`transfer`), `quantity`, `previous_quantity`, `new_quantity`, `reason`, `source` ENUM(`store`,`catalog`,`manual`,`system`), `store_order_id` nullable, `catalog_order_id` nullable, `user_id` nullable, `notes`, `createdAt`. Índices por producto, por pedido y por fecha.

Nuevo servicio `src/services/stockLedger.service.ts` que sea **el único punto del sistema que modifica `catalog_products.stock_quantity` y `catalog_product_sizes.stock_quantity`**, siempre recibiendo una transacción y escribiendo el movimiento en la misma.

Refactorizar para que pasen por él:
- `services/store.service.ts` (descuento del checkout, ~línea 655-674)
- `services/catalog.service.ts` (línea ~413 pedidos mayoristas, línea ~214 ajuste manual del admin)

*Aceptación:* un `grep` de `stock_quantity` con asignación/`literal` no devuelve ningún resultado fuera de `stockLedger.service.ts`. Toda modificación deja movimiento con cantidad anterior, resultante, motivo, origen y responsable.

### 1.3 · Restitución de stock y liberación de cupón  [cierra C-1 y A-9]
- Migración: `ALTER TABLE store_orders ADD stock_restored_at DATETIME NULL`.
- Función `restoreStoreOrderStock(order, reason, userId, transaction)` en `store.service.ts`, que usa `stockLedger` y es **idempotente** vía `stock_restored_at` (dentro de la transacción, con lock sobre el pedido).
- Disparar al entrar en `cancelled` (desde `recordStoreOrderStatusChange` y desde `applyPaymentResult` cuando MP devuelve `rejected`/`cancelled`/`refunded`/`charged_back`).
- Decrementar `store_coupons.used_count` en la misma transacción, con guarda `used_count > 0`.
- Para `returned`: **no restituir automáticamente**. Dejar la restitución como acción explícita del admin (el producto puede volver defectuoso). Documentalo en el código y en el avance.
- Para resolver el talle: usar `catalog_product_size_id` si existe (ver 1.10) y `size_name` como fallback; si no se puede resolver, registrar el movimiento como pendiente de revisión y loguear un ERROR — nunca fallar silenciosamente.
*Aceptación:* cancelar un pedido devuelve el stock exactamente una vez, deja movimientos `cancel` y libera el cupón. Cancelarlo dos veces no duplica nada.

### 1.10 · `catalog_product_size_id` en `store_order_items`  [cierra M-8, habilita 1.3]
Migración: columna nullable + FK `ON DELETE SET NULL`. Poblarla en `createStoreOrder`. Migración de backfill separada e idempotente que resuelva por `product_id` + `size_name` los registros históricos donde haya coincidencia unívoca.
*Aceptación:* los pedidos nuevos guardan el id del talle; el backfill no rompe ni inventa datos.

### 1.4 · Idempotencia en el checkout  [cierra A-1]
- Header `Idempotency-Key` (UUID) generado en el frontend al montar `StoreCheckoutPage` y enviado en `POST /store/checkout`.
- Migración: `store_orders.idempotency_key` STRING(64) nullable + índice **único**.
- Si llega una clave ya usada, devolver el pedido existente (200/201 con el mismo payload) en vez de crear uno nuevo.
*Aceptación:* dos POST idénticos concurrentes → un solo `StoreOrder`, un solo descuento de stock.

### 1.5 · Idempotencia y robustez de webhooks  [cierra A-7 y caso 14 de prueba]
- Tabla `webhook_events`: `provider`, `event_id`, `payload_hash`, `processed_at`, `result`, con UNIQUE(`provider`,`event_id`).
- En `handleStoreWebhook`: registrar el evento antes de procesar; si ya existe, salir sin efecto.
- `SELECT ... FOR UPDATE` sobre el `StoreOrder` dentro de la transacción de `applyPaymentResult`.
- **Validar importe y moneda** contra `total_amount` antes de marcar como pagado. Si no coinciden, NO acreditar: dejar el pedido en revisión, loguear ERROR y notificar al admin por socket.
- **Ignorar eventos desordenados**: si llega un `pending` posterior a un `approved` ya aplicado, no retroceder el estado (comparar por fecha del pago).
*Aceptación:* los casos 13, 14 y 15 de la sección 9 de la auditoría pasan.

### 1.6 · Total correcto en el checkout  [cierra C-6, A-3, A-4]
- Nuevo `POST /api/v1/store/checkout/quote`: recibe items + `coupon_code` + `shipping_type`, devuelve `{ items: [{...,disponible, precio_actual}], subtotal, discount, shipping_cost, total }` calculado **íntegramente en backend**, reutilizando la lógica de `createStoreOrder` (extraela a una función compartida `computeOrderTotals` — no la dupliques).
- `StoreCheckoutPage.tsx` consume el quote y muestra el desglose real, incluido el envío, antes de confirmar.
- `POST /checkout` recibe el total que el cliente vio; si no coincide con el recalculado → **409** con el nuevo desglose para que el cliente reconfirme.
- Avisos explícitos si cambió un precio o si un ítem quedó sin stock / desactivado (mensaje por producto, no genérico).
*Aceptación:* el total confirmado === el total cobrado, siempre. Los casos 4, 5 y 6 de la sección 9 pasan con mensaje claro.

### 1.8 · Job de reconciliación de pagos  [cierra C-8 parcialmente]
- Incorporar un scheduler (`node-cron` en proceso, o script invocable por cron de Railway — proponeme cuál conviene antes de implementar).
- Job cada 10-15 min: buscar `StoreOrder` en `pending_payment` con método `mercadopago` creados hace más de N minutos, consultar MP por `external_reference` (`searchPaymentsByReference`) y aplicar el resultado con la misma lógica idempotente.
- Job diario: detectar y reportar inconsistencias (pedido pagado sin movimiento de stock, cancelado sin restitución, etc.).
- Todo configurable por `Settings` o env, y desactivable.
*Aceptación:* un pago acreditado sin webhook se detecta en menos de 15 minutos.

## Tests que tenés que agregar en Fase 1

En `backIndians/src/__tests__/` (Jest + supertest, seguí el estilo de `purchase-flow.test.ts` y `helpers.ts`):

- Unitarios: `roundPrice`, `computeOrderTotals`, `isValidStoreTransition`, idempotencia de `restoreStoreOrderStock`.
- Integración: casos **3, 6, 10, 13, 14, 15, 17, 19, 20** de la sección 9 de la auditoría.
- E2E (`e2e/tests/`): flujo completo de compra en efectivo + verificación de que el total mostrado en checkout coincide con el del pedido creado.

Los tests no deben depender de datos preexistentes de producción ni dejar basura: creá y limpiá tus propios fixtures.

## Fase 2 en adelante — NO empieces todavía

Las Fases 2, 3 y 4 del documento (entidad `store_payments`, estados desacoplados, reserva de stock con vencimiento, devoluciones/reintegros, `store_invoices`, integración con caja, reporte de conciliación, permisos granulares, facturación electrónica) **dependen de decisiones de negocio que todavía no tomé**. Están listadas en la sección 12 de la auditoría.

Cuando termines la Fase 1, recordámelas y esperá mis respuestas antes de proponer la Fase 2.

## Qué necesito de vos ahora

1. Leé la auditoría completa y validá contra el código que los hallazgos siguen vigentes. Decime si algo cambió o si encontrás algo que se me pasó.
2. Presentame el plan de la tarea **1.7** (la más simple) para arrancar.
3. Si en algún punto la instrucción es ambigua o hay más de un camino razonable, preguntame en vez de elegir por tu cuenta.

---FIN---

---

## Notas de uso

- Si querés que avance más rápido sin aprobar tarea por tarea, agregá al final: *"Ejecutá las tareas 1.7, 1.9 y 1.1 de corrido sin pedirme aprobación intermedia, y reportá al final."*
- Si Claude Code se queda sin contexto a mitad de la Fase 1, abrí una sesión nueva y pegá el mismo prompt agregando: *"Ya se completaron las tareas X, Y, Z — revisá `documentos/AUDITORIA_TIENDA_ONLINE_AVANCE.md` y seguí desde la siguiente."*
- Antes de activar 1.3 (restitución de stock) conviene hacer un **conteo físico** y ajustar el stock de sistema: el desvío histórico acumulado no se puede reconstruir porque no hay movimientos previos.
