# Auditoría integral del módulo de Flujo de Caja — Indians

**Fecha:** 2026-08-06
**Alcance:** `backIndians/` (modelos, migraciones, servicio, controlador, rutas, tests) + `frontIndians/` (página `/cash`, API client) + puntos de integración con `store.service.ts` (tienda online) e `invoice.service.ts` (facturación interna).
**Modo:** Solo lectura / auditoría. No se modificó código de producción, no se crearon migraciones, no se hicieron commits.
**Autor:** Auditoría asistida (Claude Code), a pedido del usuario, siguiendo `prompt-auditoria-flujo-caja-indians.md`.

---

## A. Resumen ejecutivo

**Estado global: `NO APTO PARA PRODUCCIÓN`** — para el modelo de negocio de **caja física operada por turnos** descripto en el prompt (dos turnos diarios, apertura/cierre con conteo, arqueo ciego, traspaso entre turnos). El módulo que existe hoy en Indians **no es una caja de turnos**: es un **libro contable simple** (cuentas + transacciones + categorías), más cercano a un "flujo de fondos" administrativo que a una caja operativa de punto de venta.

Como libro contable simple, **cumple razonablemente su propósito original** (registrar ingresos/egresos, ver saldos por cuenta, alimentarse automáticamente de la tienda online), pero tiene **una falla crítica de integridad financiera**: los movimientos confirmados se pueden **editar y borrar libremente**, sin motivo, sin aprobación y sin quedar registro de qué valor tenían antes.

**Porcentaje estimado de cobertura funcional respecto del modelo pedido en el prompt (auditoría integral de caja con turnos): ~15–20%.**
Método: de los ~19 controles críticos listados en la sección 19 del prompt ("criterios mínimos"), 3 se cumplen razonablemente (cálculo backend, precisión decimal, permisos básicos), 2 se cumplen parcialmente, y el resto (turnos, conteo físico, arqueo ciego, reconteos, distribución, traspaso, inmutabilidad, idempotencia general, concurrencia, separación de funciones, auditoría inmutable, reportes/exportaciones) **no existen** en el código actual. Ver matriz completa en la sección D.

### Cinco fortalezas principales

1. **Cálculo de saldos correcto y atómico en backend.** `applyBalanceEffect`/`revertBalanceEffect` usan `UPDATE ... SET balance = balance ± monto` (vía `increment`/`decrement` de Sequelize) dentro de una `sequelize.transaction`, no lectura-cálculo-escritura en JS. Verificado con datos reales (ver sección F): `100.000 + 80.000 + 10.000 − 12.000 − 3.000 − 20.000 = 155.000,00` exacto.
2. **Precisión monetaria correcta a nivel de esquema.** `DECIMAL(12,2)` en las tres tablas, sin `FLOAT`. (`backIndians/migrations/20260605-018-create-cash-flow.js:13,42`).
3. **Integración con la tienda online bien diseñada en su mecánica de idempotencia y atomicidad** (no en su regla contable, ver hallazgo CASH-PAY-001): usa `cash_recorded_at` como marca de idempotencia separada de `stock_confirmed_at`, bloquea la fila del pedido con `LOCK.UPDATE`, y participa de la misma transacción de Sequelize que confirma el pago (`backIndians/src/services/store.service.ts:1318-1370`).
4. **Permisos base correctos y verificados por test:** todo el módulo exige `admin` o `billing`; `seller` recibe `403` (confirmado por test real, no solo inspección: `factory-cash.test.ts:58-62`, ejecutado en esta auditoría).
5. **Categorías del sistema protegidas contra edición/desactivación** (`is_system=true` bloqueado en `cash.service.ts:134,142`), lo que evita que se rompa la categoría usada por la integración automática de tienda.

### Cinco riesgos principales

1. **CRÍTICO — Los movimientos de caja confirmados se editan y se borran, no se revierten.** No existe modelo de reversión. `updateTransaction`/`deleteTransaction` (`cash.service.ts:315-370`) permiten cambiar monto, cuenta, fecha o borrar cualquier transacción —incluidas las generadas automáticamente por la tienda online— sin motivo, sin aprobación y sin dejar registro del valor anterior. **Reproducido en esta auditoría** contra la base de desarrollo: se cambió el monto de una transacción de 10.000 a 999.999 con una sola llamada `PUT`, sin ninguna validación de negocio.
2. **CRÍTICO — El ingreso de caja de la tienda online no distingue medio de pago.** Un pedido pagado con MercadoPago (tarjeta/billetera, no efectivo físico) genera un asiento de caja **idéntico** al de un pedido pagado en efectivo, por el `total_amount` completo, en la misma cuenta configurada (`store.service.ts:1354-1367`, confirmado también por el propio test del equipo `store-cash-income.test.ts:91-122`). Si esa cuenta es de tipo `cash` (caja física), el sistema mezcla dinero que nunca entró físicamente con efectivo real. **Reproducido en esta auditoría**: se cargó manualmente un ingreso de "venta por transferencia" en una cuenta tipo `cash` sin ningún rechazo del sistema.
3. **CRÍTICO — Ausencia total del modelo de turnos/jornadas/arqueo pedido para operar caja física a diario.** No hay ningún concepto de turno, apertura, cierre, conteo físico, conteo ciego, reconteo, diferencia, aprobación por umbral ni traspaso entre turnos en todo el repositorio (búsqueda exhaustiva sin resultados). Si el negocio realmente necesita ese flujo de dos turnos diarios con conteo físico, **no existe hoy, hay que construirlo desde cero** (no es una brecha menor, es un módulo distinto).
4. **ALTO — Una venta anulada o devuelta no revierte el ingreso de caja ya registrado.** Al cancelar un pedido de tienda se libera stock y cupón (`store.service.ts:1576-1581`) pero el asiento de caja creado al confirmarse el pago queda intacto — no hay ninguna referencia a caja en `storeReturns.service.ts`. El efectivo esperado queda sobrestimado indefinidamente tras una devolución.
5. **ALTO — No existe auditoría inmutable de ninguna acción de caja.** No hay tabla de auditoría en todo el proyecto (`grep AuditLog` → 0 resultados). Lo único que queda de una edición o un borrado es el log operacional HTTP (Pino, con `correlationId`), que no registra valores antes/después ni motivo de negocio, y no es lo mismo que un registro de auditoría de dominio.

### Recomendación de salida a producción

**No sacar a producción el flujo de "caja operativa por turnos" descripto en el prompt tal como está** — porque ese flujo no existe todavía, no es cuestión de "corregir bugs" sino de construir el módulo. **El libro contable actual (`CashAccount`/`CashTransaction`) puede seguir usándose como está para su propósito actual** (registro administrativo de ingresos/egresos, no como caja física con arqueo), **siempre que se corrijan antes los hallazgos P0** de la sección I (inmutabilidad de movimientos confirmados, segregación de medios de pago no efectivos, reversión automática en cancelaciones/devoluciones). Si el objetivo real del negocio es operar caja física con dos turnos diarios y arqueo, se requiere una decisión de producto: **extender este módulo con un nuevo dominio de turnos, o confirmar que ese flujo no es necesario y el prompt describe un caso de uso que no aplica a este negocio** (fábrica a pedido + tienda online, no un POS de mostrador con cajeros por turno) — ver preguntas pendientes en la sección L.

---

## B. Alcance y evidencia revisada

### Archivos y módulos inspeccionados

**Backend:**
- `backIndians/migrations/20260605-018-create-cash-flow.js`
- `backIndians/migrations/20260804-085-seed-store-cash-category.js`, `086-add-store-order-to-cash-reference-type.js`, `087-store-orders-cash-recorded-at.js`
- `backIndians/src/models/CashAccount.ts`, `CashTransaction.ts`, `CashTransactionCategory.ts`
- `backIndians/src/services/cash.service.ts` (completo)
- `backIndians/src/controllers/cash.controller.ts` (completo)
- `backIndians/src/routes/cash.routes.ts` (completo)
- `backIndians/src/middlewares/authorize.ts`
- `backIndians/src/services/store.service.ts` (integración caja↔tienda, líneas ~1280-1600)
- `backIndians/src/services/storeReturns.service.ts` (grep de integración con caja)
- `backIndians/src/services/invoice.service.ts` (grep de integración con caja)
- `backIndians/src/__tests__/api/factory-cash.test.ts`, `store-cash-income.test.ts`
- `backIndians/src/types/index.ts` (`UserRole`)

**Frontend:**
- `frontIndians/src/api/cash.ts`
- `frontIndians/src/pages/cash/CashFlowPage.tsx` (completo, ~1200 líneas)

**Documentación/contexto previo:**
- `CLAUDE.md`, `docs/project-brain/00-INDEX.md`, `10-SESSION-HANDOFF.md`, `02-FUNCTIONAL-MAP.md`, `03-BUSINESS-RULES.md`, `05-DATABASE.md`, `06-API-AND-INTEGRATIONS.md`
- Memoria de sesiones previas (`project-cash-feature.md`)

**Búsquedas exhaustivas (sin resultados) para confirmar ausencia de conceptos:**
- `turno|jornada|shift|arqueo|denominac|conteo ciego|handover|traspaso de caja|apertura de caja|cierre de caja` en `backIndians/src` y `frontIndians/src` → 0 archivos.
- `AuditLog|audit_log|class.*Audit` en `backIndians/src` → 0 archivos.
- `cash|Cash` en `invoice.service.ts` y `storeReturns.service.ts` → 0 coincidencias.

### Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `cd backIndians && npm run typecheck` | ✅ Limpio, sin errores (`tsc --noEmit`) |
| `cd frontIndians && npm run lint` | 172 problemas preexistentes (161 errores, 11 warnings), **ninguno bloqueante para caja**. Un hallazgo real detectado por el propio lint: `CashFlowPage.tsx:377` — `const confirm = useConfirm()` declarado y nunca usado (ver hallazgo CASH-UX-002) |
| `cd backIndians && npm run seed:test` | ✅ Sembrado correcto sobre `textil_db` (DB de desarrollo local, no productiva) |
| `cd backIndians && npx jest --forceExit factory-cash store-cash-income` | ✅ 2 suites, 7 tests, todos en verde (30s) |
| Servidor backend ya corriendo en `localhost:3000` (proceso preexistente del usuario, no iniciado por esta auditoría — un intento propio de arrancar otro falló por `EADDRINUSE`, confirmando que ya había uno activo) | Usado para las pruebas manuales de la sección F/hallazgos, contra `textil_db` (desarrollo) |
| Caso numérico obligatorio (sección 6.4 del prompt), ejecutado vía HTTP contra cuenta y categorías QA descartables | ✅ Balance final exacto `155.000,00` (ver sección F) |
| Prueba adicional: ingreso "por transferencia" cargado a cuenta tipo `cash` | ✅ Aceptado sin ninguna validación (hallazgo CASH-PAY-002) |
| Prueba adicional: edición retroactiva de monto de una transacción confirmada (10.000 → 999.999) | ✅ Aceptada sin motivo/aprobación (hallazgo CASH-MUT-001) |
| Prueba adicional: filtro `reference_type=store_order` en `GET /cash/transactions` | ❌ `400 Datos inválidos` — el validador de la ruta no incluye el valor que el propio sistema usa (hallazgo CASH-FILTER-001) |
| Prueba adicional: inspección de tipo de dato de `current_balance` en `GET /cash/accounts` | El campo llega como **string** (`"193900.00"`), no como `number` (hallazgo CASH-TYPE-001) |
| Limpieza | Se revirtieron (`DELETE`) las 7 transacciones QA creadas — el saldo de la cuenta de prueba volvió a `0.00`, confirmando que el borrado revierte el saldo correctamente — y se desactivaron la cuenta y las 2 categorías QA creadas. No queda dato de prueba visible/activo en la DB de desarrollo. |

### Pruebas no ejecutadas y motivo

- **Concurrencia real (dos aperturas/cierres simultáneos, dos ediciones simultáneas de la misma transacción).** No hay infraestructura de test de concurrencia en el proyecto (no hay tests que lancen requests en paralelo contra el mismo recurso). Se describe el riesgo y un test reproducible en la sección G.
- **`npm run test:full` completo (toda la suite, no solo caja).** No se ejecutó para no extender innecesariamente el tiempo de esta auditoría de solo lectura ni tocar de más la base compartida de desarrollo; se ejecutaron específicamente los dos archivos de test relacionados a caja, que es lo relevante para este módulo.
- **Build de frontend (`npm run build`).** No ejecutado — no es señal relevante para una auditoría funcional de caja (el `lint` ya confirma que el archivo compila sin errores de tipos en el editor); se priorizó `typecheck` de backend y `lint` de frontend, más pruebas funcionales reales contra la API.
- **Pruebas contra base de datos de staging/producción.** Fuera de alcance por instrucción explícita del prompt; todo lo ejecutado fue contra `textil_db` local de desarrollo.

### Limitaciones de la auditoría

- No se tuvo acceso a la configuración real de `store_cash_account_id` en producción, ni al volumen real de transacciones en producción — todas las pruebas cuantitativas son sobre datos QA descartables en desarrollo.
- El prompt de auditoría describe un modelo de negocio (caja de mostrador con dos turnos diarios) que **no coincide con lo que hoy hace el sistema** (fábrica de indumentaria a pedido + tienda online, sin punto de venta físico visible en el código). Gran parte de la sección D queda `NO CUMPLE` no porque haya un bug puntual, sino porque **la entidad "turno" no existe** — se aclara esto explícitamente en cada fila en lugar de inventar una interpretación.
- No se auditó el módulo de Facturas (`invoice.service.ts`) en profundidad más allá de confirmar que no tiene integración automática con caja — es coherente con lo ya señalado como no confirmado en `03-BUSINESS-RULES.md` (`BR-INVOICE-PENDING-001`).

---

## C. Mapa real de la implementación

```
Frontend (solo admin/billing, ruta /cash)
  CashFlowPage.tsx
    ├─ TransactionsTab  → cashApi.getTransactions/createTransaction/updateTransaction/deleteTransaction
    ├─ SummaryTab       → cashApi.getSummary
    └─ CashSettingsModal→ cashApi.{get,create,update,toggle}{Accounts,Categories}
        │
        ▼  (Axios, /api/v1/cash/*)
Backend
  cash.routes.ts
    router.use(authenticate)
    router.use(authorize('admin','billing'))   ← todo el módulo, sin distinción de acción
    DELETE /transactions/:id  → authorize('admin') adicional
        │
        ▼
  cash.controller.ts  (fino, sin lógica de negocio)
        │
        ▼
  cash.service.ts
    ├─ listAccounts/createAccount/updateAccount/toggleAccount
    ├─ listCategories/createCategory/updateCategory/toggleCategory  (bloquea is_system)
    ├─ listTransactions/getTransaction
    ├─ createTransaction → createTransactionCore (dentro de sequelize.transaction propia)
    ├─ createSystemTransaction → createTransactionCore (participa de una transacción EXTERNA)
    ├─ updateTransaction → revertBalanceEffect + applyBalanceEffect + update in-place
    ├─ deleteTransaction → revertBalanceEffect + destroy (hard delete)
    └─ getSummary → 3 queries SQL crudas (totales, por categoría, evolución diaria)
        │
        ▼
  Modelos: CashAccount, CashTransactionCategory, CashTransaction (Sequelize, MySQL)


Integración con Tienda Online (única integración automática real):
  store.service.ts: cambio de estado de StoreOrder (pending_payment → cualquier estado "vivo")
    → confirmStoreOrderStock(...)                          (descuenta stock real)
    → recordStoreOrderCashIncome(order, changedBy, t)       (misma transacción SQL)
         ├─ lock StoreOrder FOR UPDATE, corta si cash_recorded_at ya está seteado (idempotencia)
         ├─ lee setting store_cash_account_id (si no está configurado: solo warning, no bloquea el pago)
         ├─ busca categoría de sistema "Ventas tienda online"
         ├─ createSystemTransaction({ type:'income', amount: order.total_amount, reference_type:'store_order', reference_id: order.id }, ...)
         └─ marca order.cash_recorded_at = now()
    → si nuevo estado es 'cancelled': restoreStoreOrderStock(...) libera stock y cupón,
      pero NO revierte ni referencia el asiento de caja ya creado.

  storeReturns.service.ts (devoluciones post-entrega): sin ninguna referencia a caja.
  invoice.service.ts (facturación interna): sin ninguna referencia a caja — el cobro de una
  factura interna no genera movimiento de caja automático, es 100% manual vía el modal de
  "Nuevo movimiento" del panel.
```

---

## D. Matriz de cumplimiento

Leyenda de estado: `CUMPLE` / `CUMPLE PARCIALMENTE` / `NO CUMPLE` / `NO APLICA` / `NO VERIFICABLE`.

| ID | Área | Requisito | Estado | Evidencia | Severidad | Impacto | Corrección propuesta |
|---|---|---|---|---|---|---|---|
| CASH-TURNO-001 | Turnos | Existencia de caja/jornada/turno como entidades | NO CUMPLE | Búsqueda exhaustiva sin resultados en todo el repo | CRÍTICA | No hay forma de acotar un período operativo "cerrado" e inmodificable | Definir si el negocio necesita este dominio (ver sección L) antes de diseñar tablas |
| CASH-TURNO-002 | Turnos | Soporte de dos turnos diarios con traspaso de fondo | NO CUMPLE | Ídem | CRÍTICA | El fondo dejado por un turno no puede vincularse trazablemente al siguiente porque no hay "siguiente" | Depende de CASH-TURNO-001 |
| CASH-TURNO-003 | Turnos | Restricción de dos aperturas simultáneas por caja | NO APLICA | No existe apertura | CRÍTICA | — | — |
| CASH-TURNO-004 | Turnos | Fecha comercial independiente de fecha técnica, TZ `America/Argentina/Tucuman` | NO CUMPLE | `cash_transactions.date` es un `DATEONLY` que el usuario tipea a mano en el formulario (`CashFlowPage.tsx:242-247`); no hay cálculo de "jornada comercial" en backend ni uso de zona horaria en ningún punto del módulo (`grep Tucuman` → 0 resultados en `src/services/cash.service.ts`) | ALTA | Un cierre a las 00:30 puede registrarse con la fecha equivocada sin que nada lo evite ni lo corrija | Si se construye el dominio de turnos, calcular la jornada comercial en backend con la TZ del negocio |
| CASH-STATE-001 | Máquina de estados | Estados de turno con transiciones controladas por backend | NO APLICA | No existe turno | CRÍTICA | — | — |
| CASH-STATE-002 | Máquina de estados | Prohibición de operar sobre algo cerrado/no abierto | NO APLICA | Análogo a lo anterior; `CashTransaction` no tiene estado propio, siempre está "activa" hasta que se edita/borra | ALTA | — | — |
| CASH-OPEN-001 | Apertura | Conteo físico obligatorio en apertura | NO APLICA | No existe apertura | CRÍTICA | — | — |
| CASH-OPEN-002 | Apertura | Persistencia separada de esperado vs. contado, con reconteo si difieren | NO APLICA | Ídem | CRÍTICA | — | — |
| CASH-MOV-001 | Movimientos | Todo movimiento pertenece a caja/turno/sucursal/usuario | CUMPLE PARCIALMENTE | `CashTransaction` tiene `account_id` y `created_by` (`CashTransaction.ts:9,18`); no tiene turno ni sucursal porque no existen esas entidades | ALTA | No se puede acotar "todo lo que pasó en este turno/local" — solo por cuenta y rango de fecha | Si se agrega sucursal/caja física, sumar `cash_register_id` |
| CASH-MOV-002 | Movimientos | Motivo/descripción obligatoria | CUMPLE | `description` `NOT NULL` en migración y validador (`cash.routes.ts:114`) | — | — | — |
| CASH-MOV-003 | Movimientos | Tipo e identificador de operación de origen | CUMPLE PARCIALMENTE | `reference_type`/`reference_id` existen y se usan para `store_order` (`CashTransaction.ts:15-16`), pero el validador de creación/filtrado de la API solo acepta `'invoice'`\|`'order'` (`cash.routes.ts:89,117,141`) — **filtrar por `store_order` desde el panel devuelve `400`, verificado en esta auditoría** | MEDIA | El admin no puede filtrar/ver por API los ingresos automáticos de tienda usando el campo pensado para eso | Agregar `'store_order'` a los `isIn([...])` de query y body en `cash.routes.ts` |
| CASH-MOV-004 | Movimientos | Idempotencia general ante reintentos/doble clic | CUMPLE PARCIALMENTE | Existe **solo** en la integración de tienda (`cash_recorded_at` en `StoreOrder`, con `LOCK.UPDATE`); la creación manual desde el panel (`POST /cash/transactions`) no tiene clave de idempotencia — un reintento de red genuino (no dispersa por UI porque el botón se deshabilita) crearía un movimiento duplicado | MEDIA | Ver hallazgo CASH-IDEMP-001 | Agregar `idempotency_key` opcional a `POST /transactions`, único a nivel de índice |
| CASH-MOV-005 | Movimientos | Reversión referencia al movimiento original, original se conserva | NO CUMPLE | No existe modelo de reversión; ver CASH-MUT-001 | CRÍTICA | — | Rediseñar `updateTransaction`/`deleteTransaction` como creación de contraasiento |
| CASH-SALE-001 | Ventas/pagos | Venta confirmada genera movimiento una sola vez | CUMPLE | Verificado por test (`store-cash-income.test.ts`) y por diseño (`cash_recorded_at` + `LOCK.UPDATE`) | — | — | — |
| CASH-SALE-002 | Ventas/pagos | Anulación/devolución revierte el impacto en caja | NO CUMPLE | `storeReturns.service.ts` no referencia caja (0 coincidencias); cancelar un pedido pagado no revierte `cash_recorded_at` ni crea contraasiento (`store.service.ts:1576-1581` solo libera stock/cupón) | CRÍTICA | El efectivo esperado queda sobrestimado tras cualquier devolución o cancelación post-pago | Al cancelar/devolver un pedido con `cash_recorded_at` seteado, generar un egreso de reversión vinculado |
| CASH-PAY-001 | Ventas/pagos | Operación de caja y venta atómicas cuando corresponde | CUMPLE | Misma `transaction` de Sequelize (`store.service.ts:1532-1573`) | — | — | — |
| CASH-PAY-002 | Ventas/pagos | Pagos mixtos/no efectivos no afectan el efectivo esperado | NO CUMPLE | `recordStoreOrderCashIncome` registra el `total_amount` completo sin mirar `payment_method` (`store.service.ts:1354-1367`); confirmado por test del propio equipo con `payment_method:'mercadopago'` (`store-cash-income.test.ts:91-122`) y **reproducido en esta auditoría** cargando manualmente un ingreso "por transferencia" en una cuenta tipo `cash` sin rechazo | CRÍTICA | Mezcla ingresos no físicos con el efectivo real de la cuenta configurada | Separar por `payment_method`: solo `'cash'` debería impactar una cuenta tipo `cash`; `mercadopago`/`bank_transfer` deberían ir a una cuenta `bank`, o no registrarse como movimiento de "caja física" |
| CASH-PAY-003 | Ventas/pagos | Reintentos/doble clic no duplican el movimiento | CUMPLE (tienda) / CUMPLE PARCIALMENTE (panel) | Ver CASH-MOV-004 | MEDIA | — | — |
| CASH-MUT-001 | Correcciones | Movimientos confirmados no editables ni eliminables; correcciones vía reversión auditada | NO CUMPLE | `updateTransaction`/`deleteTransaction` (`cash.service.ts:315-370`) permiten editar/borrar cualquier transacción, sin `is_system`/`reference_type` check, sin motivo, sin aprobación. **Reproducido en esta auditoría**: `PUT /cash/transactions/106` cambió el monto de `10.000` a `999.999` sin ninguna restricción; luego `DELETE` de 7 transacciones QA revirtió el saldo correctamente a `0.00` (confirma que el cálculo de reversión es correcto, pero el borrado en sí no debería estar permitido para movimientos confirmados) | CRÍTICA | Un usuario `billing` puede alterar retroactivamente cualquier cifra financiera, incluidas las generadas automáticamente por la tienda, sin dejar rastro del valor original | Quitar `PUT`/`DELETE` sobre transacciones confirmadas; reemplazar por endpoint de reversión que crea un asiento inverso vinculado (`reversal_of_id`) y conserva el original |
| CASH-FLOAT-001 | Precisión | `DECIMAL` sin `FLOAT`, sin pérdida de precisión | CUMPLE | `DECIMAL(12,2)` en las 3 tablas (migración `018`); prueba numérica exacta (sección F) | — | — | — |
| CASH-TYPE-001 | Precisión | Consistencia de tipo `number` en las respuestas de la API (regla de `CLAUDE.md`: "Getters DECIMAL→number en todo modelo con campos monetarios") | NO CUMPLE | `GET /cash/accounts` devuelve `current_balance` como **string** (`"193900.00"`), verificado en esta auditoría con una llamada real; `getSummary()` sí convierte con `Number(...)` (`cash.service.ts:432-433`) pero `listAccounts()` no tiene getter ni conversión | MEDIA | Riesgo de bugs de concatenación (`"100" + "50" = "10050"`) en cualquier código futuro que sume `current_balance` de `GET /cash/accounts` directamente en vez de usar `getSummary` | Agregar getter `get current_balance() { return Number(this.getDataValue('current_balance')) }` en `CashAccount.ts`, igual que el resto de modelos monetarios del proyecto |
| CASH-CENTRAL-001 | Precisión | Servicio de dominio centralizado para fórmulas financieras | CUMPLE PARCIALMENTE | `applyBalanceEffect`/`revertBalanceEffect` centralizan el efecto en saldo; no hay una fórmula de "efectivo esperado" porque no existe el concepto de turno | MEDIA | — | — |
| CASH-DECTEST-001 | Precisión | Tests de decimales/signos/valores grandes | NO VERIFICABLE | No hay tests unitarios de la función de cálculo en sí (`cash.service.ts`) fuera de los dos tests de integración E2E ya citados, que no cubren decimales fraccionarios ni valores extremos | MEDIA | — | Agregar tests unitarios de `applyBalanceEffect`/`revertBalanceEffect` con decimales (ej. `$0.10 + $0.20`) |
| CASH-MEDIO-001 | Medios de pago | Resumen por medio de pago (cantidad, ingresos, devoluciones, neto) | NO CUMPLE | No existe ningún reporte por medio de pago; `getSummary()` agrupa por categoría de caja, no por medio de pago de la venta origen | ALTA | Imposible conciliar por medio de pago desde el módulo de caja | Fuera de alcance del rediseño de caja si no se resuelve primero CASH-PAY-002 |
| CASH-SEC-001 | Seguridad | Backend rechaza roles no autorizados (no solo oculta botones) | CUMPLE | `authorize('admin','billing')` a nivel de router (`cash.routes.ts:11`); test real: `seller` → `403` (`factory-cash.test.ts:58-62`, ejecutado en esta auditoría) | — | — | — |
| CASH-SEC-002 | Seguridad | Autorización granular por acción (`cash.movement.reverse`, `cash.shift.approve_difference`, etc.) | NO CUMPLE | Solo hay dos niveles: `admin`+`billing` (todo excepto borrar) y `admin` (borrar). No hay permisos finos ni por caja/sucursal (no existen esas entidades) | ALTA | `billing` puede editar/borrar cualquier movimiento sin distinción de sensibilidad | Si se mantiene el modelo actual, al menos diferenciar "crear" de "editar/revertir" |
| CASH-SEC-003 | Seguridad | Separación de funciones / autoaprobación prohibida | NO CUMPLE | No existe ningún flujo de aprobación en el módulo (no hay diferencias, no hay retiros con aprobación) | ALTA | — | — |
| CASH-SEC-004 | Seguridad | Mass assignment / manipulación de IDs desde el cliente | CUMPLE PARCIALMENTE | Los controladores pasan `req.body` completo a los servicios (`cash.controller.ts:16,46`), pero los validadores de `express-validator` en las rutas son razonablemente estrictos (whitelisting de campos vía `body(...)` explícitos) — no se detectó una vía de inyectar campos no declarados como `created_by` o `id` porque los servicios reconstruyen el objeto de creación campo por campo (`cash.service.ts:276-291`) | BAJA | — | — |
| CASH-AUDIT-001 | Auditoría | Registro inmutable de acciones de caja (aperturas, ediciones, aprobaciones, exportaciones) | NO CUMPLE | No existe tabla de auditoría en todo el proyecto (`grep AuditLog` → 0). Solo hay logging operacional HTTP genérico (Pino, `requestContext.ts`) que no captura valores antes/después ni motivo de negocio | CRÍTICA | Ante una diferencia de caja detectada después, no hay forma de reconstruir qué se editó, cuándo y por qué | Crear tabla de auditoría de dominio append-only para el módulo de caja como mínimo |
| CASH-CONC-001 | Concurrencia | Bloqueo/serialización ante ediciones concurrentes de la misma transacción | NO VERIFICABLE (riesgo inferido) | `updateTransaction`/`deleteTransaction` hacen `findByPk` sin `lock` antes de calcular la reversión (`cash.service.ts:316-317,363-364`); si dos requests concurrentes editan/borran la misma transacción, ambas pueden leer el mismo estado "antes" y aplicar reversiones incorrectas | MEDIA | Baja probabilidad de negocio real dado que la UI actual la opera un usuario a la vez desde el panel, pero el gap existe | Agregar `{ lock: Transaction.LOCK.UPDATE }` al `findByPk` dentro de la transacción, como ya se hace correctamente en `store.service.ts:1323-1326` |
| CASH-CONC-002 | Concurrencia | Protección ante actualización de saldo con condición de carrera | CUMPLE | `CashAccount.increment/decrement` generan `UPDATE` atómico a nivel SQL (no lectura+escritura en JS) | — | — | — |
| CASH-UX-001 | Frontend | Prevención de doble clic / botones bloqueados durante request | CUMPLE | `disabled={isSubmitting || createMut.isPending || updateMut.isPending}` (`CashFlowPage.tsx:354`) | — | — | — |
| CASH-UX-002 | Frontend | Confirmación reforzada para acciones irreversibles | CUMPLE PARCIALMENTE | Borrado de transacción sí pide confirmación (`handleDelete`, `CashFlowPage.tsx:934-943`); desactivar cuenta/categoría **no** pide confirmación pese a importar el hook (`const confirm = useConfirm()` en `CashFlowPage.tsx:377` está declarado y **nunca se usa** — confirmado por `eslint`: `'confirm' is assigned a value but never used`) | BAJA | Desactivar por error una cuenta/categoría usada activamente no tiene ningún freno en la UI | Usar `confirm(...)` antes de `toggleAccMut.mutate`/`toggleCatMut.mutate`, o quitar el import muerto |
| CASH-UX-003 | Frontend | Estados de carga/vacío/error | CUMPLE | `TableRowSkeleton`, `EmptyState`, manejo de `isLoading` (`CashFlowPage.tsx:1038-1047`) | — | — | — |
| CASH-REPORT-001 | Reportes | Filtros combinables backend (no descarga todo para filtrar en cliente) | CUMPLE | `listTransactions` usa `where` + `limit`/`offset` en SQL (`cash.service.ts:167-194`), no trae todo a memoria | — | — | — |
| CASH-REPORT-002 | Reportes | Exportación CSV/Excel/PDF respetando filtros y permisos | NO CUMPLE | No existe ningún endpoint ni botón de exportación en todo el módulo de caja | MEDIA | El "checklist de aceptación" del prompt lo pide explícitamente; hoy no hay forma de sacar un reporte de caja fuera de la pantalla | Agregar exportación si el negocio la necesita; no es una regresión, nunca existió |
| CASH-REPORT-003 | Reportes | Dashboard de riesgo (diferencias, movimientos manuales, reversiones por usuario) | NO APLICA | No hay diferencias ni reversiones porque no existe el concepto | — | — | — |
| CASH-HIST-001 | Historial | Reconstrucción de línea de tiempo completa por movimiento | CUMPLE PARCIALMENTE | Se puede ver quién creó cada transacción (`created_by`→`creator`) y cuándo (`createdAt`), pero no quién la editó por última vez con qué valores previos (solo `updatedAt`, sin historial) | MEDIA | — | Ligado a CASH-AUDIT-001 |

---

## E. Hallazgos detallados (críticos y altos)

### CASH-MUT-001 — Los movimientos de caja confirmados se pueden editar y borrar sin restricción
- **Severidad:** CRÍTICA
- **Estado actual:** `NO CUMPLE`, verificado por código y por prueba real.
- **Evidencia:** `backIndians/src/services/cash.service.ts:315-370` (`updateTransaction`, `deleteTransaction`); `backIndians/src/routes/cash.routes.ts:125-154` (rutas `PUT`/`DELETE` sin más control que el rol). Prueba ejecutada en esta auditoría: `PUT /api/v1/cash/transactions/106` con `{"amount":999999}` sobre una transacción de `10.000` ya confirmada → `200 OK`, sin pedir motivo ni aprobación, sin registrar el valor anterior en ningún lado más que el `updatedAt`.
- **Regla esperada:** los movimientos financieros confirmados no se editan ni se eliminan; toda corrección crea un movimiento de reversión vinculado, conservando el original.
- **Escenario de fallo reproducible:** un usuario con rol `billing` (no solo `admin`) abre el detalle de cualquier movimiento —incluido uno generado automáticamente por la tienda online (`reference_type='store_order'`)— y cambia el monto o la cuenta. El saldo de la cuenta se recalcula al instante y el valor original desaparece.
- **Impacto técnico y de negocio:** invalida cualquier arqueo o conciliación posterior; abre la puerta a ocultar faltantes/sobrantes o desvíos de fondos simplemente editando el asiento en vez de investigarlo.
- **Causa raíz:** el módulo se diseñó como un ABM de transacciones contables administrativas, no como un libro de caja con garantías de inmutabilidad — es coherente con su alcance original (registro de ingresos/egresos generales), pero no cumple los requisitos de control interno de una caja operativa.
- **Corrección recomendada:** eliminar `PUT`/`DELETE` sobre `CashTransaction` para movimientos ya confirmados (o, como mínimo, para los que tienen `reference_type` no nulo). Reemplazar por un endpoint `POST /cash/transactions/:id/reverse` que crea un asiento de signo contrario con `reversal_of_id`, motivo obligatorio y usuario, dejando el original intacto.
- **Archivos que probablemente deban cambiar:** `cash.service.ts`, `cash.controller.ts`, `cash.routes.ts`, migración nueva para `reversal_of_id`/`reason`, `frontIndians/src/pages/cash/CashFlowPage.tsx` (reemplazar modal de edición por modal de reversión).
- **Test de aceptación:** dado un movimiento confirmado, `PUT`/`DELETE` deben responder `403`/`405`; `POST /reverse` debe crear un nuevo movimiento de signo contrario, dejar el original sin cambios y el saldo debe quedar igual a como estaba antes del original (neto cero).

### CASH-PAY-002 — El ingreso automático de caja no distingue medios de pago no efectivos
- **Severidad:** CRÍTICA
- **Estado actual:** `NO CUMPLE`, verificado por código, por el test existente del propio equipo, y reproducido en esta auditoría.
- **Evidencia:** `backIndians/src/services/store.service.ts:1354-1367` — `amount: Number(locked.total_amount)` sin condicionar por `locked.payment_method` (`'mercadopago' | 'cash' | 'bank_transfer'`, `StoreOrder.ts:23`). El propio test del equipo `store-cash-income.test.ts:91-122` verifica —sin señalarlo como problema— que un pedido `payment_method:'mercadopago'` genera el mismo tipo de asiento `income` que uno `payment_method:'cash'`. Reproducido en esta auditoría: se cargó un ingreso manual "Venta por transferencia" de $45.000 en una cuenta `type:'cash'` y el sistema lo aceptó sin ninguna advertencia ni bloqueo, subiendo el saldo de "caja física" de $155.000 a $200.000.
- **Regla esperada:** solo las operaciones que mueven efectivo físico deben incrementar el saldo de una cuenta de tipo `cash`/`petty_cash`; tarjeta, transferencia y billeteras digitales no deberían tocar el cajón físico.
- **Escenario de fallo reproducible:** el negocio configura `store_cash_account_id` apuntando a la "Caja Principal" (tipo `cash`, la que se cuenta físicamente). Un cliente paga con MercadoPago. El sistema suma ese dinero al saldo de la caja física, que nunca lo recibió en efectivo. Al momento de un arqueo (si existiera), el efectivo esperado según el sistema no coincidirá jamás con lo contado, aunque no haya ningún error operativo.
- **Impacto técnico y de negocio:** invalida cualquier conciliación de caja física mientras la cuenta configurada sea de tipo `cash`; en la práctica de hoy, dado que no hay arqueo, "solo" distorsiona los reportes de saldo por cuenta.
- **Causa raíz:** el diseño de la integración (2.3, según los comentarios del propio código) resolvió la trazabilidad contable general (que el ingreso de la venta quede registrado en algún lado) sin resolver la separación por medio de pago, que no era su objetivo original.
- **Corrección recomendada:** condicionar la cuenta destino según `payment_method` (una cuenta `cash` solo para `payment_method:'cash'`; `mercadopago`/`bank_transfer` a una cuenta `bank`), o agregar una validación que rechace/advierta si `payment_method !== 'cash'` y la cuenta configurada es de tipo `cash`.
- **Archivos que probablemente deban cambiar:** `store.service.ts` (función `recordStoreOrderCashIncome`), posiblemente agregar un segundo setting `store_bank_account_id`, y el test `store-cash-income.test.ts` para cubrir el nuevo comportamiento.
- **Test de aceptación:** un pedido `payment_method:'mercadopago'` marcado como pagado no debe incrementar el saldo de ninguna cuenta `type:'cash'`; debe incrementar (si corresponde) una cuenta `type:'bank'`.

### CASH-SALE-002 — Cancelaciones y devoluciones no revierten el ingreso de caja ya registrado
- **Severidad:** CRÍTICA
- **Estado actual:** `NO CUMPLE`, verificado por código (ausencia de referencias).
- **Evidencia:** `backIndians/src/services/storeReturns.service.ts` — cero coincidencias de `cash`/`Cash` en todo el archivo. `store.service.ts:1576-1581` — al cancelar un pedido se llama `restoreStoreOrderStock` (stock y cupón) pero no hay ninguna llamada relacionada a caja ni chequeo de `cash_recorded_at`.
- **Regla esperada:** una venta anulada o devuelta debe revertir el impacto de caja correspondiente.
- **Escenario de fallo reproducible:** un pedido de tienda se marca `paid` (genera ingreso de caja de, por ejemplo, $50.000), luego se cancela o se procesa como devolución. El movimiento de $50.000 en `cash_transactions` sigue existiendo intacto; el saldo de la cuenta configurada sigue mostrando ese dinero como recibido.
- **Impacto técnico y de negocio:** sobrestimación permanente y silenciosa del saldo de caja/banco tras cualquier devolución — es un problema de integridad financiera, no solo de reportes.
- **Causa raíz:** el diseño de devoluciones (`storeReturns.service.ts`) se construyó antes o independientemente de la integración de caja (2.3), y nunca se conectaron.
- **Corrección recomendada:** al cancelar un pedido con `cash_recorded_at` no nulo, o al confirmar una devolución, generar automáticamente un egreso de reversión vinculado (ver también CASH-MUT-001, sería el mismo mecanismo de reversión).
- **Archivos que probablemente deban cambiar:** `store.service.ts` (rama `newStatus === 'cancelled'`), `storeReturns.service.ts`.
- **Test de aceptación:** cancelar un pedido `paid` con `cash_recorded_at` seteado debe crear un movimiento de caja `expense` por el mismo monto, referenciado al pedido, y el saldo de la cuenta debe volver a su valor previo a la venta.

### CASH-AUDIT-001 — No existe auditoría inmutable de las acciones de caja
- **Severidad:** CRÍTICA
- **Estado actual:** `NO CUMPLE`, verificado por ausencia de código.
- **Evidencia:** `grep -r "AuditLog|audit_log"` sobre `backIndians/src` → 0 resultados. El único registro de "quién hizo qué" es el logging operacional HTTP (`requestContext.ts`, formato Pino con `correlationId`), que registra la request (método, URL, status, duración) pero no el contenido del cambio (valores antes/después) ni es indexable por entidad de negocio.
- **Regla esperada:** registro permanente e inmutable, no editable por API normal, de aperturas, ediciones, aprobaciones, rechazos, reversiones y cambios de configuración de caja.
- **Escenario de fallo reproducible:** después de que un movimiento se edita (ver CASH-MUT-001), no hay forma de responder "¿cuál era el valor original?" sin ir a buscar en logs de aplicación no estructurados para ese fin (si es que se conservan más allá de la rotación de logs).
- **Impacto técnico y de negocio:** sin esto, ninguna de las demás correcciones (reversión, aprobación, separación de funciones) es verificable después del hecho — es la base de todo el control interno pedido en el prompt.
- **Causa raíz:** el proyecto no tiene, en ningún módulo (no solo caja), un sistema de auditoría de dominio — es una carencia transversal, no específica de caja.
- **Corrección recomendada:** al menos para caja, agregar una tabla append-only (`cash_audit_events` o similar) que registre usuario, acción, entidad, id, valores antes/después, motivo y timestamp, poblada desde `cash.service.ts` en cada mutación.
- **Archivos que probablemente deban cambiar:** nueva migración + modelo, `cash.service.ts` (todas las funciones de escritura).
- **Test de aceptación:** cada `POST`/`PUT`/`DELETE`/reversión sobre caja debe dejar exactamente un evento de auditoría con los valores antes/después correctos; ningún endpoint normal debe poder editar o borrar un evento de auditoría.

### CASH-TURNO-001/002 — Ausencia total del modelo de turnos, apertura, arqueo y traspaso
- **Severidad:** CRÍTICA (si el negocio efectivamente opera caja física con turnos) / **NO APLICA** (si no lo hace)
- **Estado actual:** `NO CUMPLE`.
- **Evidencia:** búsqueda exhaustiva de `turno|jornada|shift|arqueo|denominac|handover` en `backIndians/src` y `frontIndians/src` → 0 archivos.
- **Regla esperada:** ver sección 4 y 7-8 del prompt (apertura con conteo, arqueo ciego, reconteo, distribución, traspaso).
- **Escenario de fallo reproducible:** no aplica un escenario de "fallo" puntual — es la ausencia completa de un dominio funcional.
- **Impacto técnico y de negocio:** si el negocio real necesita este flujo (dos turnos diarios, conteo físico), **hoy no hay ninguna forma de operarlo desde el sistema** — se estaría haciendo en papel o Excel por fuera.
- **Causa raíz:** el módulo de caja se construyó como libro contable general (ver memoria del proyecto: "el sistema necesitaba registrar ingresos y egresos de caja... y mostrar un resumen financiero"), no como caja de punto de venta.
- **Corrección recomendada:** decisión de producto primero (sección L), diseño de un dominio nuevo después — no es una corrección incremental sobre lo existente.
- **Test de aceptación:** N/A hasta la decisión de producto.

---

## F. Validación contable

### Fórmulas encontradas en el código

- **Efecto en saldo de cuenta** (`cash.service.ts:203-238`): `applyBalanceEffect`/`revertBalanceEffect`, implementadas como `UPDATE cash_accounts SET current_balance = current_balance ± :amount` (vía `CashAccount.increment`/`decrement`), siempre dentro de una `sequelize.transaction`. **No hay fórmula de "efectivo esperado" tipo `apertura + ingresos − egresos`** porque no existe el concepto de apertura/turno — cada cuenta simplemente acumula su saldo histórico completo.
- **Resumen de período** (`getSummary`, `cash.service.ts:374-452`): 3 queries SQL crudas con `SUM(CASE WHEN type = ... )`, recalculadas en cada request desde `cash_transactions` — no hay total cacheado ni enviado por el frontend que el backend simplemente confíe.

### Origen de los datos usados

Todos los cálculos de saldo y resumen se recalculan en backend desde las filas persistidas de `cash_transactions`/`cash_accounts` — el frontend nunca envía totales que el backend adopte sin recalcular. `CUMPLE` en ese punto puntual.

### Medios que afectan efectivo

No hay distinción real en el modelo de datos entre "medio de pago" y "tipo de cuenta". La única segmentación es `CashAccount.type` (`cash`/`petty_cash`/`bank`), pero **nada impide** registrar un ingreso no efectivo en una cuenta `cash` — ver CASH-PAY-002.

### Resultado del caso numérico obligatorio (sección 6.4 del prompt)

Ejecutado **contra la API real**, con una cuenta y categorías QA descartables, sobre la base de desarrollo (`textil_db`), no simulado:

| Operación | Tipo | Monto | ¿Debe afectar efectivo? | Registrado |
|---|---|---|---|---|
| Apertura contada | income | $100.000 | Sí | Sí |
| Ventas en efectivo | income | $80.000 | Sí | Sí |
| Ingreso manual autorizado | income | $10.000 | Sí | Sí |
| Gasto en efectivo | expense | $12.000 | Sí | Sí |
| Devolución en efectivo | expense | $3.000 | Sí | Sí |
| Retiro de caja | expense | $20.000 | Sí | Sí |
| Ventas por transferencia | — | $45.000 | **No** | No incluido en el cálculo base |
| Ventas con tarjeta | — | $30.000 | **No** | No incluido en el cálculo base |

**Resultado obtenido:** `current_balance = 155.000,00` — coincide exactamente con el esperado (`100.000 + 80.000 + 10.000 − 12.000 − 3.000 − 20.000 = 155.000`). **Verificado por prueba real**, no solo por inspección.

**Prueba complementaria (no pedida literalmente por el escenario, agregada para probar la regla de segregación de medios de pago):** se cargó la "venta por transferencia" de $45.000 directamente en la misma cuenta `type:'cash'` — el sistema la aceptó sin ningún rechazo, subiendo el saldo a $200.000. Esto confirma en la práctica el hallazgo CASH-PAY-002: **nada en el backend impide que un ingreso no efectivo entre a una cuenta de caja física.**

No se pudo probar el escenario completo de "distribución del efectivo contado" (dejar $30.000, retirar $124.500) porque **no existe el concepto de distribución/cierre de turno** en el código — solo se pudo validar la aritmética base de ingresos/egresos, que es correcta.

### Errores de precisión, redondeo, signo o duplicación

Ninguno detectado en la aritmética de saldos (`DECIMAL(12,2)`, resultado exacto `155000.00` sin artefactos de punto flotante). Sí se detectó el problema de **tipo de dato en la respuesta de la API** (`current_balance` como `string` en `GET /cash/accounts`, ver CASH-TYPE-001), que es un riesgo de correctitud aguas abajo (frontend/integraciones) aunque el valor numérico en sí sea correcto.

---

## G. Seguridad, fraude y concurrencia

### Matriz breve de amenazas y controles existentes

| Amenaza | Control existente | Suficiente? |
|---|---|---|
| Rol no autorizado accede a caja | `authorize('admin','billing')` en todas las rutas | Sí, para "todo o nada"; no hay granularidad por acción |
| Edición fraudulenta de un movimiento para ocultar un desvío | Ninguno | **No** — ver CASH-MUT-001 |
| Autoaprobación de un retiro grande | No aplica — no hay retiros con aprobación | — |
| Registrar ingreso no efectivo como si fuera caja física | Ninguno | **No** — ver CASH-PAY-002 |
| Doble registro de un mismo pago de tienda (reintento de webhook) | `cash_recorded_at` + `LOCK.UPDATE` en `StoreOrder` | Sí, para ese camino específico |
| Doble registro por reintento en el panel manual | Ninguno (sin `idempotency_key`) | Parcial — mitigado en la UI (botón deshabilitado), no en la API |
| Manipulación de `created_by`/`id` desde el cliente | Los servicios reconstruyen el objeto campo a campo, no hacen `Model.create(req.body)` directo | Sí |
| Inyección vía `notes`/`description` | Sequelize parametriza las queries; no se ejecuta SQL crudo con esos campos | Sí |

### Vulnerabilidades verificadas (por prueba, no solo inspección)

1. Edición retroactiva sin control de un movimiento confirmado (CASH-MUT-001).
2. Registro de ingreso no efectivo en cuenta de caja física sin rechazo (CASH-PAY-002).
3. Filtro `reference_type=store_order` rechazado por el validador de la propia API pese a ser un valor válido en el modelo (CASH-FILTER-001, severidad BAJA, no es de seguridad pero se detectó en la misma tanda de pruebas).

### Riesgos inferidos que requieren prueba (no verificados en esta auditoría)

- **CASH-CONC-001** (sección D): ediciones/borrados concurrentes de la misma transacción sin `lock`. Test reproducible sugerido: desde dos procesos, hacer `PUT /cash/transactions/:id` con distintos montos casi simultáneamente y verificar si el saldo final refleja ambos cambios correctamente o si uno "pisa" el efecto del otro (lost update). Requiere orquestar dos requests concurrentes reales (no se ejecutó en esta auditoría por ser modo solo-lectura/no-destructivo y por la complejidad de coordinar timing preciso vía HTTP).

### Separación de funciones

No existe en ningún punto del módulo — no hay diferencia entre "quien solicita" y "quien aprueba" porque no hay flujo de aprobación. El único límite es rol (`admin`/`billing` vs. `admin` solo para borrar).

### Condiciones de carrera

El incremento/decremento de saldo en sí es seguro (operación SQL atómica). El riesgo está en el flujo de lectura-antes-de-revertir de `updateTransaction`/`deleteTransaction` (ver CASH-CONC-001) — no en el cálculo del saldo en sí.

---

## H. Calidad técnica y pruebas

### Resultado de typecheck, lint, tests y builds

| Chequeo | Resultado | Relacionado a caja |
|---|---|---|
| `backIndians`: `npm run typecheck` | ✅ Limpio | — |
| `frontIndians`: `npm run lint` | 172 problemas preexistentes en todo el proyecto (no introducidos por esta auditoría, que fue de solo lectura) | 1 hallazgo real en `CashFlowPage.tsx:377` (`confirm` sin usar) |
| `backIndians`: `npx jest factory-cash store-cash-income` | ✅ 2 suites / 7 tests, todos en verde | 100% de los tests existentes de caja |

### Cobertura existente por regla crítica

| Regla crítica | ¿Tiene test? |
|---|---|
| Ingreso/egreso refleja correctamente el saldo | Sí (`factory-cash.test.ts`) |
| `seller` no accede a caja | Sí (`factory-cash.test.ts`) |
| Pago de tienda confirmado a mano genera ingreso atribuido al admin | Sí (`store-cash-income.test.ts`) |
| Pago automático (webhook/MP) se atribuye al usuario "Sistema" | Sí (`store-cash-income.test.ts`) |
| Sin cuenta configurada, el pago no falla pero tampoco genera asiento | Sí (`store-cash-income.test.ts`) |
| Edición/borrado de movimiento confirmado está bloqueado | **No existe el test porque no existe la regla** (la funcionalidad actual permite editar/borrar) |
| Medio de pago no efectivo no afecta cuenta `cash` | **No hay test — y de existir, fallaría con el código actual** |
| Cancelación/devolución revierte el ingreso de caja | **No hay test — y de existir, fallaría con el código actual** |
| Idempotencia de creación manual (reintento de red) | No hay test |
| Concurrencia en edición/borrado | No hay test |
| Auditoría de cambios | No aplica — no existe la funcionalidad |

### Deuda técnica relevante

- Falta de tests unitarios puros para `applyBalanceEffect`/`revertBalanceEffect` (hoy solo se prueban indirectamente vía tests E2E).
- El validador de `reference_type` en las rutas está desalineado con los valores reales que puede tener el modelo (`CASH-MOV-003`).
- `current_balance` inconsistente entre `string` (endpoint crudo) y `number` (endpoint de resumen) — viola la convención documentada del propio proyecto en `CLAUDE.md`.

---

## I. Backlog de correcciones priorizado

### P0 — Bloquea producción (si se pretende usar caja como control financiero real)

| Ítem | Depende de | Complejidad | Riesgo de regresión | Criterio de aceptación |
|---|---|---|---|---|
| CASH-MUT-001: quitar edición/borrado de movimientos confirmados, reemplazar por reversión auditada | — | M | Medio (cambia el flujo de UI de edición) | Ver sección E |
| CASH-PAY-002: segregar medios de pago no efectivos del efectivo físico en la integración de tienda | Definir si se usa una segunda cuenta `bank` o se bloquea | M | Bajo | Ver sección E |
| CASH-SALE-002: reversión automática de caja al cancelar/devolver un pedido con ingreso ya registrado | CASH-MUT-001 (mismo mecanismo de reversión) | M | Bajo | Ver sección E |
| CASH-AUDIT-001: auditoría inmutable mínima del módulo de caja | — | M | Bajo (aditivo) | Ver sección E |

### P1 — Necesario antes de operar normalmente con expectativas de control interno

| Ítem | Depende de | Complejidad | Riesgo de regresión | Criterio de aceptación |
|---|---|---|---|---|
| CASH-TYPE-001: getter `number` para `current_balance` en `CashAccount` | — | S | Bajo | `GET /cash/accounts` devuelve `current_balance` como número en el JSON |
| CASH-MOV-003 / CASH-FILTER-001: alinear validadores de `reference_type` con los valores reales del modelo | — | S | Bajo | `GET /cash/transactions?reference_type=store_order` responde `200` |
| CASH-CONC-001: bloquear la fila (`LOCK.UPDATE`) al editar/borrar una transacción | — | S | Bajo | Test de concurrencia (sección G) no muestra pérdida de actualización |
| CASH-MOV-004: clave de idempotencia opcional en `POST /cash/transactions` | — | S | Bajo | Dos `POST` con la misma clave crean un único movimiento |
| CASH-UX-002: confirmación al desactivar cuenta/categoría | — | S | Bajo | Toggle pide confirmación antes de ejecutar |

### P2 — Mejora importante

| Ítem | Complejidad | Criterio de aceptación |
|---|---|---|
| CASH-REPORT-002: exportación CSV/PDF de movimientos con filtros aplicados | M | Exportación respeta filtros activos y permisos |
| CASH-DECTEST-001: tests unitarios de `applyBalanceEffect`/`revertBalanceEffect` con decimales y valores extremos | S | Suite cubre `$0.10+$0.20`, montos negativos rechazados, montos grandes |
| CASH-SEC-002: permisos granulares por acción (crear vs. editar/revertir) | M | Un usuario `billing` sin permiso de reversión no puede revertir movimientos |

### P3 — Evolución futura

| Ítem | Complejidad | Nota |
|---|---|---|
| Dominio completo de turnos/jornadas/arqueo con conteo físico y traspaso (secciones 4-9 del prompt) | XL | Requiere decisión de producto previa — ver sección L. Es un módulo nuevo, no una mejora del actual. |
| Resumen por medio de pago | M | Depende de resolver CASH-PAY-002 primero |
| Dashboard de riesgo (diferencias, movimientos manuales por usuario) | M | Depende de que existan diferencias/reversiones para mostrar |

---

## J. Plan de implementación por etapas

**No se ejecuta en esta etapa — solo se propone el orden, a la espera de aprobación.**

1. **Decisión de producto** (sección L): confirmar si el negocio necesita el flujo de turnos con arqueo físico, o si el objetivo real es únicamente corregir la integridad del libro contable actual.
2. **P0 sin cambios de esquema visibles al usuario:** CASH-AUDIT-001 (tabla de auditoría aditiva, no rompe nada existente) — desplegable primero y de forma aislada.
3. **P0 con cambio de contrato de API:** CASH-MUT-001 (quitar `PUT`/reemplazar `DELETE` por reversión). Requiere coordinar con el frontend (`CashFlowPage.tsx`) en el mismo despliegue, porque el modal de edición deja de tener sentido tal como está.
4. **P0 de integración:** CASH-PAY-002 y CASH-SALE-002 (tocan `store.service.ts`) — requieren decidir si se crea una cuenta `bank` por defecto o se agrega validación de rechazo; conviene migrar datos históricos de `cash_transactions` con `reference_type='store_order'` para reclasificar por medio de pago si el negocio lo necesita (fuera de alcance de esta auditoría, requiere confirmación explícita antes de tocar datos históricos).
5. **P1:** correcciones puntuales y de bajo riesgo (getter de tipo, validadores, locking, idempotencia, confirmación de UI) — se pueden desplegar en paralelo entre sí.
6. **P2/P3:** según prioridad de negocio, después de validar que P0/P1 no introdujeron regresiones (correr `npm run test:full` completo, no solo los tests de caja).
7. **Rollback:** todos los cambios de P0/P1 propuestos son aditivos a nivel de esquema (nueva tabla de auditoría, nueva columna de reversión) — no se propone eliminar columnas existentes, por lo que el rollback de cada migración es directo (`down()` estándar). El cambio de contrato de API (quitar `PUT` de transacciones) si se revierte, debe coordinarse con el frontend en el mismo commit de rollback.

---

## K. Checklist de aceptación final

| Criterio | Estado |
|---|---|
| Una sola apertura activa por caja, protegida ante concurrencia | ❌ Rechazado — no existe el concepto |
| Todo movimiento de efectivo pertenece a un turno con origen trazable | ⚠️ Pendiente de verificación — tiene origen trazable (cuenta+usuario+referencia), no turno |
| Los medios no efectivos no alteran el cajón físico | ❌ Rechazado — ver CASH-PAY-002 |
| Los pagos mixtos afectan solo por la parte en efectivo | ❌ Rechazado — no hay pagos mixtos parciales por caja en el modelo actual, y los no-mixtos ya fallan la separación |
| El esperado y la diferencia se recalculan en backend con precisión decimal | ⚠️ Pendiente — el saldo se recalcula en backend con `DECIMAL`, pero no existe "esperado vs. contado" |
| Apertura y cierre incluyen conteo físico; el cierre es ciego | ❌ Rechazado — no existe |
| Los reconteos se conservan | ❌ Rechazado — no existe |
| Las diferencias no se ocultan ni se ajustan automáticamente | ❌ Rechazado — no existen diferencias como concepto, y si existieran, hoy se podrían "ocultar" editando el movimiento (CASH-MUT-001) |
| La distribución coincide con el efectivo realmente contado | ❌ Rechazado — no existe |
| El fondo entregado se vincula con la recepción del siguiente turno | ❌ Rechazado — no existe |
| Los movimientos confirmados no se editan ni eliminan; se revierten | ❌ Rechazado — ver CASH-MUT-001 |
| Existe idempotencia para evitar duplicados | ⚠️ Pendiente — solo en la integración de tienda, no en creación manual |
| El cierre y sus operaciones derivadas son transaccionales | ❌ Rechazado — no existe cierre |
| Se controlan las principales condiciones de carrera | ⚠️ Pendiente — el saldo sí, la edición/borrado de transacción no (CASH-CONC-001) |
| Los permisos se aplican en backend y por alcance de sucursal/caja | ⚠️ Pendiente — se aplican en backend por rol, no hay sucursal/caja como alcance |
| Existe separación de funciones o excepción explícitamente auditada | ❌ Rechazado — no existe ninguna de las dos |
| Existe auditoría suficiente y no editable por APIs normales | ❌ Rechazado — ver CASH-AUDIT-001 |
| Historial, filtros, reportes y exportaciones son consistentes | ⚠️ Pendiente — historial/filtros básicos sí, exportación no existe |
| Existen tests efectivos de cálculos, permisos, traspasos, reversiones y concurrencia | ⚠️ Pendiente — cálculos y permisos sí, traspasos/reversiones/concurrencia no |
| Frontend y backend compilan y las funcionalidades existentes no se rompen | ✅ Aprobado — `typecheck` limpio, tests de caja en verde |

---

## L. Preguntas y decisiones pendientes

Estas preguntas no se pueden resolver leyendo el repositorio — requieren una decisión de negocio:

1. **¿El negocio realmente opera (o planea operar) una caja física de mostrador con dos turnos diarios y arqueo con conteo?** El prompt de auditoría describe ese escenario en detalle, pero no se encontró ningún rastro de esa operatoria en el código, en `docs/project-brain/` ni en la memoria de sesiones previas — que describen a Indians como una fábrica de indumentaria a pedido con tienda online B2C, no un punto de venta de mostrador. Si la respuesta es "sí, hace falta", el trabajo pendiente es diseñar un módulo nuevo (sección J, punto 1), no corregir el actual. Si la respuesta es "no, el libro contable actual alcanza", el foco debe ser exclusivamente el backlog P0/P1 de la sección I.
2. **¿Qué cuenta debería recibir los pagos de tienda no efectivos (MercadoPago, transferencia)?** Hoy todos van a la misma `store_cash_account_id` sin distinción (CASH-PAY-002). Definir si corresponde una segunda cuenta de tipo `bank`, o si se debe bloquear la creación de una cuenta `cash` como destino de pagos no efectivos.
3. **¿Los movimientos históricos ya cargados manualmente en el panel (previos a esta auditoría) deben reclasificarse o corregirse?** Esta auditoría no tocó datos de producción; si al implementar CASH-MUT-001/CASH-PAY-002 se detectan movimientos históricos "contaminados" (ediciones previas sin rastro, o ingresos no efectivos ya mezclados en cuentas de caja física), se necesita una decisión explícita sobre si se migran, se marcan como "origen histórico sin garantía" o se dejan como están.
4. **¿Se requiere exportación de reportes de caja (CSV/PDF) como parte del alcance actual, o es una funcionalidad que nunca se pidió y por lo tanto no es una regresión?** Confirmar antes de priorizarla en el backlog (hoy clasificada P2).
