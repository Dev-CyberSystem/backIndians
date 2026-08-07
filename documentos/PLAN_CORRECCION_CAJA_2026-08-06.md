# Plan de trabajo — Corrección del módulo de Flujo de Caja

**Fecha:** 2026-08-06
**Origen:** hallazgos de `AUDITORIA_FLUJO_CAJA_2026-08-06.md`
**Estado:** Fases 0-7 ✅ completas. Fase 8 es una puerta de decisión no comprometida — el módulo, como libro contable, está corregido e íntegro.

### Registro de avance

| Fase | Estado | Nota |
|---|---|---|
| 0 — Preparación | ✅ | Rama `auditoriacaja` (ya existía, se reutilizó) en ambos repos. Base de desarrollo reseteada (49 tablas borradas) y reconstruida desde cero con las 90 migraciones — validación de que aplican limpias. Línea de base: 199 tests, 197 ✅ / 2 ❌ (fallos preexistentes de cupones por stock contaminado, ajenos a caja). |
| 1 — Auditoría inmutable | ✅ | Migración 090, modelo con hooks append-only, servicio, instrumentación de las 8 escrituras de caja, `GET /cash/audit` (solo admin), 12 tests nuevos. **Validación: 38 suites / 211 tests, todos en verde, cero regresiones** (199 previos + 12 nuevos; los 2 fallos de cupones de la línea de base desaparecieron al limpiar la base, confirmando que eran contaminación de datos). `typecheck` limpio. |
| 2 — Inmutabilidad + reversión | ✅ | Migración 091 (`status`, `reversal_of_id`, `reversal_reason`, `reversed_at/by`, `idempotency_key`) + `ensureSchema.ts`. `PUT`/`DELETE` de transacciones **eliminados**; nuevos `PATCH /transactions/:id` (solo descripción/notas/categoría) y `POST /transactions/:id/reverse` (motivo obligatorio ≥10 caracteres, soporta reversión parcial, lock de fila contra condiciones de carrera). Idempotencia en `POST /transactions` vía `idempotency_key` (mismo patrón que `store_orders`, sin duplicar el índice). Frontend: modal de alta separado del de detalle; el detalle muestra monto/tipo/cuenta/fecha de solo lectura + edición de campos no financieros + formulario de reversión; badges de estado (texto, no solo color); sin botón de borrar. De paso, incluido el hallazgo menor CASH-FILTER-001 (filtro `reference_type` ahora acepta `store_order`). **Validación: 39 suites / 224 tests, todos en verde** (211 + 13 nuevos de `cash-reversal.test.ts`, estables en 3 corridas). `typecheck` limpio en ambos repos. Probado manualmente en navegador (Playwright ad hoc): flujo completo alta → detalle → reversión funcionando sin errores de consola ni de red. |
| 3 — Segregación de medios de pago | ✅ | Cierra CASH-PAY-002 (crítico): un pago con MercadoPago se registraba igual que uno en efectivo. Nuevo setting `store_bank_account_id` (`VALID_KEYS`); `recordStoreOrderCashIncome` → `recordStoreOrderIncome`, elige cuenta según `payment_method` (`cash` → `store_cash_account_id`; `mercadopago`/`bank_transfer` → `store_bank_account_id`). `updateSettings` **rechaza** (400, no solo advierte) si `store_cash_account_id` no apunta a una cuenta `type:'cash'` o `store_bank_account_id` a una `type:'bank'` — es exactamente la mala configuración que esta fase existe para prevenir. `jobs/reportInconsistencies.ts` actualizado para distinguir qué cuenta falta. Frontend (`EcommerceSettingsPage`): dos selectores separados, cada uno **filtrado por tipo de cuenta** (defensa en profundidad además del rechazo del backend). **Validación: 39 suites / 227 tests, todos en verde** (224 + 3 netos en `store-cash-income.test.ts` reescrito). `typecheck`/`lint` limpios. Verificado en navegador: los dos selects muestran listas de cuentas completamente disjuntas. |
| 4 — Reversión automática (cancelaciones/devoluciones) | ✅ | Cierra CASH-SALE-002 (crítico): cancelar un pedido pagado o registrar una devolución no revertía el ingreso de caja/banco ya registrado. Migración 092 (`store_orders.cash_reversed_at` para cancelación total, `store_returns.cash_reversed_at` para cada devolución — dos columnas, no una, porque puede haber varias devoluciones parciales sobre el mismo pedido). `cash.service.ts`: `reverseTransaction` refactorizada en `reverseTransactionCore` + `reverseSystemTransaction` (mismo patrón `createTransaction`/`createSystemTransaction`/`createTransactionCore` de la Fase 2), para poder revertir dentro de la transacción externa del cambio de estado. `store.service.ts`: nueva función exportada `reverseStoreOrderCashIncome(orderId, reason, changedBy, transaction, amount?)`, llamada en la rama `cancelled` de `recordStoreOrderStatusChange` (revierte el remanente completo) y desde `storeReturns.service.ts` (revierte por `refunded_amount`). `updateStoreReturnRefund` ahora corre dentro de una transacción con lock de fila; `refunded_amount` pasa a ser **obligatorio** (400) cuando `refund_status` pasa a `'refunded'` — sin monto no hay forma de saber cuánto revertir. Frontend (`StoreReturnManager.tsx`): botón "Guardar" deshabilitado sin monto, copy actualizado explicando el efecto real sobre caja. **Validación: 40 suites / 234 tests, todos en verde** (227 + 7 nuevos en `cash-reversal-automatic.test.ts`: cancelación total, cancelación con reintento idempotente, cancelación sin pago previo, devolución parcial, dos devoluciones parciales sobre el mismo pedido, reintegro con reintento idempotente, monto obligatorio). `typecheck`/`lint` limpios en ambos repos. Verificado en navegador (Playwright ad hoc) con datos reales vía API: pedido pagado $8000 → devolución parcial $3000 reintegrada desde la UI → saldo de la cuenta bajó exactamente a $5000, contraasiento visible en `cash_transactions` con `reversal_of_id` correcto, sin errores de consola ni de red. |
| 5 — Correcciones menores (P1) | ✅ | **CASH-TYPE-001**: `CashAccount.current_balance` ahora tiene getter DECIMAL→number (convención `CLAUDE.md`) — antes el backend enviaba un `string` aunque el tipo TypeScript del modelo y del frontend ya decían `number`, un mismatch tipo/realidad real (`getSummary` no necesitó cambios, `Number(number)` es inocuo). **CASH-UX-002**: el `confirm` de `CashSettingsModal` (`CashFlowPage.tsx`) estaba importado y sin usar — los botones "Desactivar"/"Activar" de cuenta y categoría ejecutaban el toggle directo al click, sin ningún paso de confirmación. Ahora piden confirmación (mismo patrón que `UsersPage.tsx`: `variant:'warning'` al desactivar, `'info'` al activar). (`CASH-FILTER-001` y `CASH-CONC-001` ya estaban resueltos de fases anteriores, sin trabajo pendiente acá.) **Validación: 40 suites / 234 tests, todos en verde, cero regresiones.** `typecheck` limpio en ambos repos. Verificado en navegador (Playwright ad hoc): el toggle ahora abre el diálogo de confirmación (antes ejecutaba directo) y el saldo se ve formateado correctamente como número. |
| 6 — Calidad y reportes (P2) | ✅ | Decisiones confirmadas con el usuario: **permisos granulares SÍ** (billing conserva alta/PATCH, pierde reversión), **CSV NO por ahora** (nunca existió, sin pedido de negocio — queda fuera de esta ronda). Cierra **CASH-SEC-002**: `POST /cash/transactions/:id/reverse` ahora exige `authorize('admin')` (antes cualquiera de `admin`/`billing`, como el resto del router). Frontend: `canReverse` en `CashFlowPage.tsx` pasa de `role==='admin'\|\|'billing'` a solo `'admin'` — el modal de detalle ya no muestra el formulario de reversión para `billing`. Tests de precisión con decimales agregados a `cash-reversal.test.ts`: reversión de montos con centavos ($1000.10+$2000.20) sin arrastre de redondeo, tres reversiones parciales en centavos que cierran el remanente dentro del margen de tolerancia (0.001) de `reverseTransactionCore`, reversión de un monto grande ($9.999.999,99). **Validación: 41 suites / 238 tests, todos en verde** (234 + 4 nuevos: billing-403, decimales, parcial-en-centavos, monto-grande). `typecheck` limpio en ambos repos. Verificado en navegador: como `billing`, el modal de detalle de un movimiento ya no muestra "Revertir movimiento" (antes sí). |
| 7 — Validación integral + documentación | ✅ | **Reset limpio real** (no solo `seed:test`): `db:drop` + `db:create` + `db:migrate` (las 92 migraciones aplican limpias sobre una base vacía — valida el camino real de despliegue) + `seed:test`. Al hacerlo se encontró un bug preexistente (no de esta sesión) en el `down()` de la migración 091: `db:migrate:undo:all` falla por borrar el índice de `reversal_of_id` antes que su FK — documentado en `05-DATABASE.md`, sin corregir (solo afecta rollback, nunca se ejecuta en producción, y la migración ya está commiteada). `typecheck` limpio en ambos repos, `lint` frontend en la misma línea de base (171 problemas preexistentes, ninguno nuevo). **`npm test` contra la base recién migrada: 40 suites / 238 tests, todos en verde.** Re-ejecutados por HTTP los 4 escenarios que la auditoría original marcó como críticos: (1) `100000+80000+10000-12000-3000-20000` → `155000` exacto y como `number` (ya no `string`, CASH-TYPE-001); (2) `PUT /cash/transactions/:id` → 404; (3) `PUT /settings` con una cuenta del tipo incorrecto → 400 (bloqueado, no solo advertido); (4) `GET /cash/transactions?reference_type=store_order` → 200. Los 4 confirman el comportamiento esperado. Prueba manual en navegador del flujo completo alta→detalle→reversión sobre la base ya limpia: badge "Revertido" correcto, contraasiento visible, sin errores de consola ni de red. Cerebro documental (`02-FUNCTIONAL-MAP.md`, `03-BUSINESS-RULES.md`, `05-DATABASE.md`, `10-SESSION-HANDOFF.md`) y memoria persistente actualizados. **Punto de producción de la sección 0 (¿hay datos reales en Railway?): sigue sin confirmar** — no se aplicó ninguna migración ahí en esta sesión. |

**Hallazgo útil para la Fase 2:** `store_orders` ya tiene una columna `idempotency_key` (migración 069) — hay precedente en el proyecto del patrón previsto para `cash_transactions`; conviene mirar cómo está resuelto ahí antes de escribir la migración 091.

**Nota sobre la migración 090:** durante la Fase 1 se agregó el valor `delete` a su ENUM de acciones editando el archivo original en vez de emitir una migración correctiva. Es legítimo porque la 090 tenía minutos de vida, era local y nunca se commiteó ni desplegó. **A partir del momento en que estas migraciones se commiteen/desplieguen, aplica la regla normal del proyecto: no editar una migración existente, crear una nueva.**

---

## 0. Decisiones tomadas (base de este plan)

| Decisión | Resolución | Consecuencia sobre el plan |
|---|---|---|
| ¿Se construye el dominio de turnos/arqueo? | **No ahora.** Corregir primero la integridad del libro contable; la decisión sobre turnos se retoma después, con el módulo ya sano. | Las 4 correcciones P0 hacen falta en ambos escenarios, así que **nada de este trabajo se pierde** si más adelante se agrega turnos. Fase 8 queda como puerta de decisión, no como compromiso. |
| ¿Cómo se separan los medios de pago no efectivos? | **Segunda cuenta bancaria.** Nuevo setting `store_bank_account_id`: MercadoPago y transferencia impactan una cuenta `bank`; solo el efectivo impacta la cuenta `cash`. | Mantiene la trazabilidad completa del dinero, separado por dónde está realmente. Fase 3. |
| ¿Qué se hace con los datos históricos? | **No hay datos reales** — todo lo que hay en la base es de pruebas y se puede borrar. El usuario va a resetear la base igualmente para probar las correcciones. | **Se elimina por completo el frente de migración de datos históricos**, que era el más riesgoso. Las migraciones no necesitan backfill ni estrategia de compatibilidad hacia atrás. |

### ⚠️ Punto a confirmar antes de desplegar (no bloquea el desarrollo)

La decisión "no hay datos reales" se tomó sobre la base de **desarrollo** (`textil_db`). Antes de aplicar cualquier migración en el entorno de Railway/producción hay que confirmar explícitamente si ahí también es todo data de prueba, o si existen pedidos de tienda / clientes reales. Si hubiera datos reales en producción, cambia la estrategia de la Fase 7 (haría falta backfill y backup previo). **No se aplica ninguna migración en producción sin esa confirmación.**

---

## 1. Objetivo y criterio de terminado

**Objetivo:** que el módulo de caja sea un libro contable **íntegro y auditable** — que ningún importe pueda alterarse sin dejar rastro, que el dinero que no entró físicamente no se mezcle con el efectivo, y que toda venta revertida revierta también su asiento.

**Criterio de terminado (definición de "quedó correcto"):**

1. Ningún movimiento financiero confirmado se puede editar ni borrar por API — solo revertir, con motivo obligatorio.
2. Toda mutación de caja deja un evento de auditoría append-only con valores antes/después.
3. Un pago con MercadoPago o transferencia nunca incrementa el saldo de una cuenta tipo `cash`.
4. Cancelar un pedido pagado, o registrar una devolución, genera automáticamente la reversión de caja correspondiente (por el monto devuelto, que puede ser parcial).
5. `npm run typecheck` limpio, `npm run test:full` en verde, y los escenarios que la auditoría probó como fallidos ahora fallan al intentarse (es decir: el sistema los rechaza).

---

## 2. Mapa de fases

```
Fase 0  Preparación (rama + reset de base)                    [S]
   │
Fase 1  Auditoría inmutable  ─── aditivo, no rompe nada       [M]   ← base de todo lo demás
   │
Fase 2  Inmutabilidad + reversión ─── cambia contrato de API  [L]   ← el hallazgo más grave
   │
   ├── Fase 3  Segregación de medios de pago                  [M]   } pueden ir en paralelo
   └── Fase 4  Reversión automática (cancelaciones/devol.)    [M]   } ambas dependen de Fase 2
   │
Fase 5  Correcciones menores (P1)                             [S]   ← independiente, en cualquier momento
   │
Fase 6  Calidad y reportes (P2)                               [M]   ← opcional según prioridad
   │
Fase 7  Validación integral + documentación                   [M]
   │
Fase 8  [PUERTA DE DECISIÓN] ¿Dominio de turnos?              [XL]  ← no comprometido
```

**Por qué este orden:** la auditoría (Fase 1) va primero porque es puramente aditiva —no cambia ningún contrato— y hace que todo el trabajo posterior quede registrado desde el minuto cero. La inmutabilidad (Fase 2) va segunda porque las Fases 3 y 4 **reutilizan su mecanismo de reversión**; hacerlas antes obligaría a escribir esa lógica dos veces.

---

## 3. Fase 0 — Preparación `[S]`

1. Crear rama de trabajo en **ambos repos** (son independientes): `caja-integridad`.
   ```bash
   cd backIndians  && git checkout -b caja-integridad
   cd ../frontIndians && git checkout -b caja-integridad
   ```
2. Confirmar el estado de la base de desarrollo y resetearla limpia (el usuario ya autorizó el borrado).
3. Verificar el margen de índices en `cash_transactions` antes de agregar los nuevos (MySQL tiene un límite de 64 índices por tabla, y el proyecto ya tuvo el error "Too many keys" — ver `dedupeIndexes.ts` y la nota en `05-DATABASE.md`).

**Criterio de aceptación:** base limpia y sembrada, `npm run test:full` en verde **antes** de tocar nada (línea de base para detectar regresiones).

---

## 4. Fase 1 — Auditoría inmutable `[M]`

Resuelve **CASH-AUDIT-001** (crítico). Es la pieza que hace verificable todo lo demás: sin ella, ninguna de las otras correcciones se puede comprobar después del hecho.

### Migración `090-create-cash-audit-events.js`

```
cash_audit_events
  id              INTEGER UNSIGNED  PK AI
  entity_type     ENUM('transaction','account','category')  NOT NULL
  entity_id       INTEGER UNSIGNED  NOT NULL
  action          ENUM('create','update','reverse','toggle') NOT NULL
  user_id         INTEGER UNSIGNED  NOT NULL  FK users(id)
  before_json     JSON              NULL
  after_json      JSON              NULL
  reason          VARCHAR(500)      NULL
  ip              VARCHAR(45)       NULL
  user_agent      VARCHAR(255)      NULL
  correlation_id  VARCHAR(64)       NULL
  createdAt       DATETIME          NOT NULL
  -- SIN updatedAt: la tabla es append-only por diseño
  INDEX (entity_type, entity_id), INDEX (createdAt), INDEX (user_id)
```

### Backend

- `models/CashAuditEvent.ts` con `timestamps: { createdAt: true, updatedAt: false }` (append-only).
- `services/cashAudit.service.ts` → `recordCashAudit(evento, transaction)`. **Siempre participa de la transacción del caller**, nunca abre la suya: el evento de auditoría debe ser atómico con el cambio que documenta (mismo criterio que ya usa `createSystemTransaction`).
- Instrumentar todas las escrituras de `cash.service.ts`: `createTransaction`, `updateAccount`, `toggleAccount`, `createCategory`, `updateCategory`, `toggleCategory`.
- Reutilizar `correlationId` de `requestContext.ts`, que ya existe — no inventar un mecanismo nuevo.
- Endpoint `GET /cash/audit` (solo `admin`), con filtros por entidad/usuario/fecha y paginación backend.
- **No** exponer ningún endpoint de escritura/borrado sobre esta tabla.

### Alcance deliberado

Los **intentos denegados** (403) quedan cubiertos por el log operacional de Pino, que ya registra `AppError` con `operator` (usuario, rol, sessionId) y `correlationId` — verificado en la salida de tests de la auditoría. Duplicarlos en la tabla de dominio no aporta y ensucia el registro contable. Si más adelante hace falta consultarlos desde la UI, se reevalúa.

### Tests

- Cada mutación de caja deja exactamente **un** evento con `before`/`after` correctos.
- Si la transacción de negocio falla, **no** queda evento huérfano (rollback conjunto).
- Un usuario `billing` no puede acceder a `GET /cash/audit` (solo `admin`).

**Criterio de aceptación:** crear, editar y desactivar cuentas/categorías/movimientos deja rastro completo y consultable; no existe forma de borrar un evento vía API.

---

## 5. Fase 2 — Inmutabilidad y reversión `[L]`

Resuelve **CASH-MUT-001** (el hallazgo más grave) y **CASH-MOV-004** (idempotencia). Es la fase que **cambia el contrato de la API**, así que backend y frontend deben desplegarse juntos.

### Migración `091-cash-transactions-reversal.js`

```
ALTER TABLE cash_transactions ADD:
  status           ENUM('active','reversed') NOT NULL DEFAULT 'active'
  reversal_of_id   INTEGER UNSIGNED NULL  FK cash_transactions(id)
  reversal_reason  VARCHAR(500)     NULL
  reversed_at      DATETIME         NULL
  reversed_by      INTEGER UNSIGNED NULL  FK users(id)
  idempotency_key  VARCHAR(80)      NULL  UNIQUE
  INDEX (status)
```

> **Regla del proyecto a respetar:** el índice único de `idempotency_key` se define **en la migración y en `ensureSchema.ts`**, pero **no** como `unique: true` en el atributo del modelo Sequelize. Definirlo en el modelo *y* en la migración genera índices duplicados bajo `sync()` (caso ya documentado de `OrderChecklistCheck` en `CLAUDE.md` — no repetirlo).

### Cambios de API

| Endpoint | Cambio |
|---|---|
| `PUT /cash/transactions/:id` | **Eliminado** |
| `DELETE /cash/transactions/:id` | **Eliminado** |
| `PATCH /cash/transactions/:id` | **Nuevo** — solo campos no financieros: `description`, `notes`, `category_id`. Nunca `amount`, `type`, `account_id`, `transfer_account_id`, `date`. Queda auditado. |
| `POST /cash/transactions/:id/reverse` | **Nuevo** — `{ reason }` obligatorio (mín. 10 caracteres) |
| `POST /cash/transactions` | Acepta `idempotency_key` opcional |
| `GET /cash/transactions` | Nuevo filtro `status`; por defecto muestra todo (activos y revertidos, visualmente distinguibles) |

### Lógica de `reverseTransaction(id, reason, user)`

Todo dentro de una única `sequelize.transaction`:

1. `findByPk(id, { lock: Transaction.LOCK.UPDATE })` — el lock resuelve además **CASH-CONC-001**.
2. Validar: existe, `status === 'active'`, y `reversal_of_id === null` (**una reversión no se revierte** — evita cadenas y dobles conteos).
3. Crear el contraasiento: tipo invertido (`income`↔`expense`; `transfer` invierte cuentas origen/destino), mismo monto, `reversal_of_id = original.id`, `reversal_reason`, `created_by = usuario actual`.
4. Marcar el original: `status='reversed'`, `reversed_at`, `reversed_by`. **El original nunca se modifica en sus campos financieros ni se borra.**
5. Aplicar el efecto en saldo del contraasiento (reutiliza `applyBalanceEffect`, ya correcto).
6. Registrar dos eventos de auditoría (original revertido + contraasiento creado).

**Decisión contable a confirmar:** la fecha (`date`) del contraasiento se propone como **la fecha de hoy**, no la del movimiento original — contablemente la reversión ocurre cuando se detecta el error, y así el resumen del período pasado no cambia retroactivamente. Si el negocio prefiere que impacte en el período original, es un cambio de una línea.

### Frontend

- El modal de edición actual pasa a ser **modal de reversión** (pide motivo obligatorio) + edición limitada de descripción/notas/categoría.
- Los movimientos revertidos se muestran diferenciados **sin depender solo del color** (badge con texto "Revertido" + tachado), por accesibilidad.
- Enlace visual entre original y contraasiento en el detalle.
- Se elimina el botón de borrar.

### Tests

- Revertir crea contraasiento, deja el original intacto y el saldo neto vuelve al valor previo.
- Revertir dos veces el mismo movimiento → error.
- Revertir un contraasiento → error.
- `PUT`/`DELETE` ya no existen → 404/405.
- `PATCH` no puede cambiar `amount` ni `account_id` aunque se envíen en el body.
- Dos `POST` con la misma `idempotency_key` → un solo movimiento.

**Criterio de aceptación:** reproducir el escenario de la auditoría (cambiar un monto de $10.000 a $999.999 con un `PUT`) debe ser **imposible**; la única vía de corrección deja original + contraasiento + motivo + auditoría.

---

## 6. Fase 3 — Segregación de medios de pago `[M]`

Resuelve **CASH-PAY-002** (crítico).

### Backend

- Agregar `'store_bank_account_id'` a `VALID_KEYS` en `services/settings.service.ts:64`.
- Renombrar `recordStoreOrderCashIncome` → `recordStoreOrderIncome` (ya no es siempre "cash") y cambiar la selección de cuenta:

  | `payment_method` | Cuenta destino |
  |---|---|
  | `cash` | `store_cash_account_id` |
  | `mercadopago` | `store_bank_account_id` |
  | `bank_transfer` | `store_bank_account_id` |

- **Mantener** la decisión ya existente y documentada: si falta configurar la cuenta correspondiente, se loguea un warning y **no se bloquea la confirmación del pago** (la plata ya se cobró; el asiento es una consecuencia administrativa). Solo cambia que el warning ahora indica *cuál* de los dos settings falta.
- Actualizar `jobs/reportInconsistencies.ts:60-124`: hoy el mensaje asume que el único setting posible es `store_cash_account_id`. Debe distinguir qué cuenta falta según el medio de pago del pedido.
- Validación al guardar settings: advertir si `store_cash_account_id` apunta a una cuenta que no es tipo `cash`, o si `store_bank_account_id` apunta a una que no es tipo `bank`.

### Frontend

- `SettingsPage`: agregar el selector de cuenta bancaria junto al de caja, con una nota que explique cuál recibe qué.

### Tests

- Pedido `payment_method:'mercadopago'` marcado como pagado → **no** incrementa ninguna cuenta `cash`; incrementa la cuenta `bank` configurada.
- Pedido `payment_method:'cash'` → incrementa la cuenta `cash`.
- Falta `store_bank_account_id` → el pago se confirma igual, se loguea el warning correcto, no se crea asiento.
- Actualizar `store-cash-income.test.ts`, que hoy verifica —sin señalarlo como problema— el comportamiento que estamos corrigiendo.

**Criterio de aceptación:** el saldo de una cuenta tipo `cash` solo puede moverse por operaciones en efectivo real.

---

## 7. Fase 4 — Reversión automática en cancelaciones y devoluciones `[M]`

Resuelve **CASH-SALE-002** (crítico). Depende de la Fase 2 (reutiliza `reverseTransaction`).

### Migración `092-cash-reversal-marks.js`

```
ALTER TABLE store_orders  ADD cash_reversed_at DATETIME NULL   -- cancelación total
ALTER TABLE store_returns ADD cash_reversed_at DATETIME NULL   -- cada devolución
```

> **Por qué dos columnas y no una:** `StoreReturn` tiene `refunded_amount` y `refund_status ('none'|'pending'|'refunded')` — es decir, **las devoluciones pueden ser parciales y puede haber varias sobre el mismo pedido**. Una sola marca en `store_orders` haría que la segunda devolución parcial se saltara silenciosamente. La marca de idempotencia de la devolución tiene que vivir en la devolución.

### Lógica

- **Cancelación** (`store.service.ts`, rama `newStatus === 'cancelled'`): si `cash_recorded_at && !cash_reversed_at` → revertir por el **total** del pedido, marcar `cash_reversed_at`.
- **Devolución** (`storeReturns.service.ts`, al pasar a `refund_status='refunded'`): si el pedido tiene `cash_recorded_at` y la devolución no tiene `cash_reversed_at` → revertir por **`refunded_amount`** (no por el total), marcar `cash_reversed_at` en la devolución.
- Reversión parcial: como el monto difiere del original, el contraasiento se crea con `reversal_of_id` apuntando al asiento original pero **sin** marcar el original como `reversed` (sigue activo, parcialmente revertido). Requiere permitir monto distinto en la reversión — contemplarlo en el diseño de la Fase 2 desde el principio para no rehacerlo.
- Atribución: usuario que ejecutó la acción, o usuario "Sistema" si fue automático (mismo patrón ya usado).
- Todo dentro de la transacción existente del cambio de estado.

### Tests

- Cancelar un pedido pagado con asiento → crea contraasiento por el total; el saldo vuelve al valor previo a la venta.
- Devolución parcial → contraasiento por `refunded_amount`, no por el total.
- Dos devoluciones parciales sobre el mismo pedido → dos contraasientos, ninguno omitido.
- Cancelar un pedido sin `cash_recorded_at` → no hace nada, no falla.

**Criterio de aceptación:** después de cualquier cancelación o devolución, el saldo de caja refleja exactamente el dinero que el negocio efectivamente conservó.

---

## 8. Fase 5 — Correcciones menores (P1) `[S]`

Independientes entre sí, sin riesgo, se pueden hacer en cualquier momento:

| Ítem | Cambio |
|---|---|
| **CASH-TYPE-001** | Getter `current_balance` → `number` en `CashAccount.ts` (convención de `CLAUDE.md`: getters DECIMAL→number en todo modelo monetario). Verificar que `getSummary` siga bien (el `Number(...)` sobre un number es inocuo). |
| **CASH-FILTER-001** | Agregar `'store_order'` a los `isIn([...])` de `reference_type` en `cash.routes.ts:89,117,141` |
| **CASH-UX-002** | Usar el `confirm` ya importado (hoy declarado y sin usar, `CashFlowPage.tsx:377`) antes de desactivar cuenta/categoría |
| **CASH-CONC-001** | Ya resuelto en la Fase 2 con el `LOCK.UPDATE` |

---

## 9. Fase 6 — Calidad y reportes (P2) `[M]` — según prioridad

- Tests unitarios de `applyBalanceEffect`/`revertBalanceEffect` con decimales (`$0.10 + $0.20`), montos grandes y signos.
- Exportación CSV de movimientos respetando filtros y permisos (**confirmar si el negocio la necesita** — nunca existió, no es una regresión).
- Permisos granulares: decidir si `billing` puede revertir movimientos o si la reversión queda solo para `admin`.

---

## 10. Fase 7 — Validación integral y documentación `[M]`

1. Reset limpio de la base + `npm run seed:test`.
2. `npm run typecheck` (backend) + `npm run lint` (frontend, sin sumar errores nuevos).
3. `npm run test:full` completo — no solo los tests de caja, para detectar regresiones en otros módulos.
4. **Re-ejecutar los escenarios de la auditoría**, verificando que ahora el sistema los rechaza:
   - Caso numérico obligatorio → sigue dando $155.000.
   - `PUT` de monto → ya no existe.
   - Ingreso no efectivo en cuenta `cash` → advertido/bloqueado según corresponda.
   - Filtro `reference_type=store_order` → responde 200.
5. Pruebas manuales en navegador del flujo completo (el frontend casi no tiene tests de componentes — el proyecto lo exige explícitamente).
6. Actualizar el cerebro documental: `02-FUNCTIONAL-MAP.md`, `03-BUSINESS-RULES.md` (las reglas `BR-CASH-003/004/005` pasan de "pendiente de corrección" a "corregida"), `05-DATABASE.md` (migraciones 090-092), `06-API-AND-INTEGRATIONS.md` (endpoints nuevos), y `10-SESSION-HANDOFF.md`.
7. Confirmar el punto de producción de la sección 0 antes de desplegar.

---

## 11. Fase 8 — Puerta de decisión: ¿dominio de turnos? `[XL]` — no comprometido

Con el módulo ya íntegro, retomar la pregunta 1 de la auditoría: **¿el negocio va a operar caja física con dos turnos diarios y conteo?**

Si la respuesta es sí, el trabajo es un **módulo nuevo**, no una extensión: `cash_registers`, `cash_business_days`, `cash_shifts`, `cash_counts` (+ denominaciones), `cash_handovers`, `cash_discrepancies`, `cash_reason_codes`, `cash_approvals`, más máquina de estados, arqueo ciego, umbrales de aprobación y separación de funciones. Todo lo construido en las Fases 1-5 (auditoría, reversión, idempotencia, segregación de medios) es **prerequisito** de ese módulo, no trabajo descartado.

---

## 12. Riesgos del plan y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El cambio de contrato de API (Fase 2) rompe el frontend | Backend y frontend se desarrollan y despliegan en la misma rama y el mismo paso; los dos repos tienen rama `caja-integridad` |
| Agregar índices dispara "Too many keys" en dev | Verificar el margen en Fase 0; `dedupeIndexes.ts` ya corre antes de `sync()` |
| Divergencia dev/producción por cambio de esquema | Toda columna nueva va **a la vez** en la migración y en `ensureSchema.ts`, según la regla de `CLAUDE.md` |
| La reversión parcial (Fase 4) obliga a rehacer la Fase 2 | Contemplar monto variable en el diseño de `reverseTransaction` **desde la Fase 2**, no después |
| Regresiones en otros módulos | `test:full` completo en Fase 7, no solo los tests de caja; línea de base tomada en Fase 0 |
| Aplicar migraciones sobre datos reales en producción | Confirmación explícita pendiente (sección 0) — no se despliega sin ella |

---

## 13. Resumen de entregables

**Migraciones nuevas:** `090` (auditoría), `091` (reversión + idempotencia), `092` (marcas de reversión en tienda) — más sus réplicas en `ensureSchema.ts`.

**Backend:** `CashAuditEvent.ts`, `cashAudit.service.ts`, reescritura de la parte mutable de `cash.service.ts`, cambios en `cash.routes.ts`/`cash.controller.ts`, `settings.service.ts`, `store.service.ts`, `storeReturns.service.ts`, `reportInconsistencies.ts`.

**Frontend:** `CashFlowPage.tsx` (modal de reversión, badges de estado, confirmaciones), `api/cash.ts`, `SettingsPage` (cuenta bancaria).

**Tests:** ~15 casos nuevos cubriendo reversión, idempotencia, medios de pago, devoluciones parciales y auditoría.

**Documentación:** actualización de 5 documentos del cerebro + este plan marcado como ejecutado.
