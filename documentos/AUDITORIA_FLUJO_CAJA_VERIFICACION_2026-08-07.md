# Auditoría de verificación — Módulo de Flujo de Caja

**Fecha:** 2026-08-07
**Tipo:** auditoría de verificación post-corrección
**Estado:** los **3 hallazgos P0 fueron corregidos y re-verificados el mismo día** (ver sección H al final). Los 4 hallazgos P1/P2 siguen abiertos.
**Objeto:** comprobar que el plan `PLAN_CORRECCION_CAJA_2026-08-06.md` (Fases 0-7) realmente dejó el módulo sano
**Auditoría original:** `AUDITORIA_FLUJO_CAJA_2026-08-06.md` (no se reescribe, es registro histórico)

> **Advertencia de sesgo:** las correcciones auditadas acá las implementó el mismo agente que escribe este informe. Para compensarlo, la verificación se hizo **por prueba adversarial contra el servidor vivo** (45 comprobaciones en dos rondas), no releyendo la documentación de las fases. Se buscó activamente romper cada regla, no confirmarla.

---

## A. Resumen ejecutivo

**El núcleo de integridad resistió. Los bordes no.**

Las cuatro brechas críticas de la auditoría original (`CASH-MUT-001`, `CASH-PAY-002`, `CASH-AUDIT-001`, `CASH-SALE-002`) están efectivamente cerradas y aguantaron todos los intentos de evasión, incluida una prueba de concurrencia real. Pero la verificación destapó **7 hallazgos nuevos**, de los cuales **3 son de severidad alta** y **uno es una regresión funcional introducida por la propia Fase 4**.

| | |
|---|---|
| Comprobaciones ejecutadas | 45 (2 rondas adversariales contra servidor vivo) |
| Pasaron | 28 |
| Fallaron | 17 (agrupadas en 7 hallazgos) |
| Hallazgos de severidad ALTA | 3 |
| Regresiones introducidas por el plan de corrección | 2 (`CASH-REF-003` alta, `CASH-MUT-003` media) |
| Hallazgos preexistentes que el plan no tocó | 5 |

**Recomendación:** el módulo es hoy **sustancialmente más sólido que antes del plan** — ya no se puede alterar ni borrar un movimiento confirmado, el dinero no efectivo no contamina la caja física, y toda mutación queda auditada. Pero **no lo daría por cerrado**: `CASH-REF-003` es una regresión que puede impedirle al operador registrar una devolución real, y `CASH-RPT-001` hace que el gráfico de egresos por categoría muestre números falsos justamente cuando se usa la función estrella del plan (revertir).

---

## B. Qué se verificó y cómo

**Método:** dos scripts de sondeo (`audit-probe.mjs`, `audit-probe2.mjs`) ejecutados por HTTP contra el backend en `localhost:3000`, creando entidades QA descartables. Complementado con revisión estática del código y verificación directa del esquema en MySQL.

**Cobertura:** validaciones de alta, inmutabilidad, permisos por rol, mecánica de reversión (total/parcial/encadenada/concurrente), integración tienda→caja (cancelaciones y devoluciones), contabilidad del resumen, auditoría, y coherencia esquema/migraciones.

**Limitaciones declaradas:**
- No se auditó el frontend con la misma profundidad que el backend (se revisó el código, no se sondeó cada pantalla).
- No se probó carga ni volumen (concurrencia se probó con 2 peticiones simultáneas, no con carga sostenida).
- No se auditó producción (Railway) — todo contra desarrollo.

---

## C. Lo que resistió (verificado por prueba, no por documentación)

Esto **no** es una lista de intenciones: cada punto se intentó romper activamente y aguantó.

| Área | Verificación | Resultado |
|---|---|---|
| Inmutabilidad | `PUT`/`DELETE` de transacción | 404 — no existen |
| Inmutabilidad | `PATCH` enviando `amount`, `type`, `account_id`, `date` a la vez | Los 4 campos financieros quedaron intactos |
| Permisos | `billing` intenta revertir | 403 |
| Permisos | `billing` intenta ver auditoría | 403 |
| Permisos | `billing` da de alta un movimiento | 201 (conserva lo que debe) |
| Reversión | Revertir dos veces el mismo movimiento | 400 |
| Reversión | Revertir un contraasiento | 400 |
| Reversión | Motivo de menos de 10 caracteres | 422 |
| Reversión | Reversión parcial deja el original `active` | Correcto |
| Reversión | Saldo tras revertir | Vuelve exacto al valor previo |
| **Concurrencia** | **Dos reversiones simultáneas del mismo movimiento** | **Solo una prospera (201/400), saldo final correcto** |
| Tienda→caja | Cancelar tras reintegro **parcial** | Revierte el remanente, neto exacto 0 |
| Tienda→caja | Cancelar tras reintegro **total** | No duplica la reversión, neto 0 |
| Auditoría | Eventos por alta, edición y reversión | Los tres presentes |
| Auditoría | Fuga de `password_hash` en snapshots | No filtra |
| Auditoría | Escrituras a tablas `cash_*` fuera de `cash.service.ts` | Ninguna — instrumentación estructuralmente completa |
| Montos | Negativo y cero | 422 |
| Tipos | `current_balance` en la respuesta | `number` (ya no `string`) |
| Esquema | Columnas de migraciones 090-092 en la DB real | Las 9 presentes |
| Esquema | Índices duplicados en `cash_transactions` | Ninguno (11 distintos) |
| Esquema | `cash_audit_events.updatedAt` | No existe (append-only correcto) |

La prueba de concurrencia es el resultado más fuerte: el `LOCK.UPDATE` de `reverseTransactionCore` serializa correctamente y no deja saldos corruptos.

---

## D. Hallazgos

### 🔴 CASH-REF-003 — Un reintegro que la caja no puede absorber impide registrar la devolución (REGRESIÓN, Fase 4)

**Severidad: ALTA.** Introducido por el plan de corrección.

Antes de la Fase 4, `refund_status`/`refunded_amount` eran campos **puramente informativos**: el admin registraba lo que ya había hecho por fuera (MercadoPago, transferencia) y el sistema lo guardaba sin objetar. La Fase 4 los conectó a la reversión automática de caja — correcto en intención — pero **sin prever los casos donde la caja no puede absorber el monto**. Resultado: una restricción contable interna ahora **veta el registro de un hecho de negocio ya ocurrido**.

**Evidencia (probada):**

| Caso | Resultado real |
|---|---|
| Reintegro de `$0` | `400 — "El monto a revertir debe ser mayor a 0"` |
| Reintegro mayor al total del pedido (`$99.999` sobre uno de `$5.000`) | `400 — "No se puede revertir 99999: solo queda 5000.00..."` |
| Segunda devolución parcial cuya suma supera el total | `400 — "No se puede revertir 5000: solo queda 2000.00..."` |

**Impacto:** el operador devolvió plata de verdad y el sistema se niega a registrarlo. `refund_status` queda en su valor anterior y el registro **diverge de la realidad** — exactamente el tipo de divergencia que el plan buscaba eliminar. Además el mensaje de error habla de internos de caja ("solo queda X sin revertir de esta transacción"), incomprensible para quien está cargando una devolución.

**Corrección sugerida:** desacoplar. El registro de la devolución debe persistir **siempre**; la reversión de caja debe ser *best-effort* — si no se puede revertir el monto completo, revertir lo que se pueda (o nada) y dejar el desvío registrado para conciliación (mismo criterio que ya usa `recordStoreOrderIncome`, que **no bloquea el pago** si falta configurar la cuenta). Nunca al revés.

---

### 🔴 CASH-RPT-001 — El gráfico "Egresos por categoría" duplica los movimientos revertidos

**Severidad: ALTA.** Bug preexistente en el SQL, **amplificado severamente** por la Fase 2.

`getSummary` calcula `by_category` con `SUM(ct.amount)` agrupado por categoría, **sin distinguir el signo** entre `income` y `expense` (solo excluye `transfer`). Los ingresos y egresos de una misma categoría se **suman** en vez de netearse.

Antes de la Fase 2 el impacto era acotado. Ahora, como toda corrección genera un contraasiento **en la misma categoría**, revertir un movimiento **duplica su valor** en el gráfico en lugar de anularlo.

**Evidencia (probada):** un ingreso de `$7.000` revertido por completo debería dejar la categoría en `$0`. El sistema reporta **`$14.000`**.

Ese número alimenta un gráfico rotulado *"Egresos por categoría"* (`CashFlowPage.tsx:1134`), que además incluye categorías de tipo `both` — así que un ingreso revertido aparece como `$14.000` de egresos que nunca existieron.

**Corrección sugerida:** `SUM(CASE WHEN type='income' THEN -amount ELSE amount END)` (o separar ingresos y egresos en dos series), y decidir explícitamente si los contraasientos se excluyen del gráfico.

---

### 🔴 CASH-VAL-004 — Una cuenta desactivada sigue aceptando movimientos y su saldo desaparece del resumen

**Severidad: ALTA.** Preexistente en el backend; la UI que escribí en la Fase 5 **promete lo contrario**.

Dos defectos que se combinan mal:

1. `createTransactionCore` valida que la cuenta **exista** (`CashAccount.count`), pero **no que esté activa** → se siguen cargando ingresos, egresos y transferencias contra cuentas desactivadas (probado: `201`).
2. `getSummary` lista solo cuentas con `active: true` → al desactivar una cuenta **con saldo**, ese dinero **desaparece del "Saldo total"** del panel (probado: `$3.333` se esfumaron del resumen) aunque sigue en la base.

**Impacto:** juntos permiten mover dinero a una cuenta invisible en el resumen y seguir operándola. No es un agujero de permisos (requiere ser `admin`/`billing`), pero **rompe la premisa de que el resumen refleja todo el dinero del negocio** — que es justamente para lo que sirve el módulo.

**Agravante propio:** el diálogo de confirmación que agregué en la Fase 5 dice textualmente *"La cuenta dejará de estar disponible para nuevos movimientos, pero su historial y saldo se conservan"*. **Ninguna de las dos mitades es cierta**: se siguen aceptando movimientos, y el saldo desaparece del resumen. Escribí una garantía que el backend no da.

**Corrección sugerida:** validar `active` en el alta (400 con mensaje claro), e incluir en el resumen las cuentas inactivas **con saldo distinto de cero**, marcadas como tales.

---

### 🟠 CASH-RPT-002 — Las reversiones inflan "Ingresos" y "Egresos" del período

**Severidad: MEDIA.**

`total_income` y `total_expense` suman todos los movimientos del período sin excluir revertidos ni contraasientos. Un ingreso de `$5.000` revertido suma **`+$5.000` a los ingresos y `+$5.000` a los egresos** (probado, delta exacto).

`net_balance` **sí queda correcto** (delta 0), y en contabilidad estricta reportar flujos brutos es defendible. Pero en un panel de gestión que rotula "Ingresos del período", mostrar plata que se anuló es engañoso — y el problema escala con cada corrección que se haga.

**Corrección sugerida:** decidir explícitamente el criterio (bruto vs. neto) y documentarlo; si se elige neto, excluir `status='reversed'` y `reversal_of_id IS NOT NULL`.

---

### 🟠 CASH-MUT-003 — Un movimiento ya revertido todavía se puede editar (hueco de la Fase 2)

**Severidad: MEDIA.** Hueco en mi propia corrección.

La Fase 2 estableció que un movimiento confirmado no se altera. Pero `patchTransaction` **no comprueba el `status`**: un movimiento ya revertido por completo — un registro histórico cerrado — sigue aceptando cambios de `description`, `notes` y **`category_id`** (probado: `200`).

Cambiar la categoría de un movimiento revertido **reescribe retroactivamente los reportes**, porque `by_category` agrupa por `category_id`. El contraasiento queda en la categoría vieja y el original en la nueva: los dos dejan de cancelarse.

**Mitigación real:** el cambio **sí queda auditado** (se verificaron eventos `update` en `cash_audit_events`), así que es rastreable, no silencioso. Por eso es media y no alta.

**Corrección sugerida:** rechazar `PATCH` cuando `status='reversed'` o cuando la fila es un contraasiento (`reversal_of_id IS NOT NULL`).

---

### 🟠 CASH-VAL-005 — La categoría no se valida: ni existencia útil, ni estado, ni tipo

**Severidad: MEDIA.** Preexistente.

`createTransactionCore` **no valida `category_id` en absoluto**. Probado:

- Categoría **desactivada** → aceptada (`201`), tanto en alta como en `PATCH`.
- Categoría de tipo **`income`** usada en un movimiento **`expense`** → aceptada (`201`).

El frontend filtra por tipo y el backend solo devuelve categorías activas en `GET /categories`, así que **por la UI no se llega** — pero la regla no está donde tiene que estar. El tipo incompatible además ensucia directamente `by_category` (ver `CASH-RPT-001`).

---

### 🟡 CASH-VAL-006 — Una FK inexistente devuelve 500 en vez de 404

**Severidad: BAJA.** Preexistente.

Categoría o cuenta destino inexistente → `SequelizeForeignKeyConstraintError` sin manejar → **500**. Probado en alta de transacción, transferencia y `PATCH`.

**Verificado y acotado:** el mensaje crudo de MySQL (con nombres de tablas y constraints) **solo se expone con `NODE_ENV=development`**; en producción `errorHandler` devuelve *"Error interno del servidor"*. **No es una fuga de información en producción** — es un problema de robustez y de código de estado incorrecto.

**Corrección sugerida:** manejar `ForeignKeyConstraintError` en `errorHandler.ts` como 404/400, y validar `category_id` explícitamente (ver `CASH-VAL-005`).

---

## E. Por qué la suite de tests no detectó nada de esto

**46 tests de caja, todos en verde, y ninguno cubre estos casos.** No es casualidad — es un patrón:

- Los tests verifican **las reglas que el plan diseñó** (reversión, permisos, segregación, idempotencia), no **las que el plan no consideró**.
- **Cero tests negativos** de validez de cuenta/categoría (inactiva, inexistente, tipo incompatible).
- **Cero aserciones sobre `getSummary`**: ni `by_category`, ni `total_income`/`total_expense`. Todo el frente de reportes está sin cubrir.
- **Cero casos borde de reintegro** (monto 0, monto mayor al total, suma de devoluciones que excede el pedido).

Los tests de la Fase 4 sí cubren el camino feliz de devoluciones y cancelaciones —y por eso `I4`/`I5` pasaron limpio—, pero solo con montos que la caja podía absorber.

---

## F. Backlog priorizado

### P0 — Corregir antes de considerar el módulo cerrado
| ID | Corrección | Esfuerzo |
|---|---|---|
| `CASH-REF-003` | Desacoplar el registro de la devolución de la reversión de caja (best-effort, nunca bloquear el hecho de negocio) | M |
| `CASH-RPT-001` | Corregir el signo en `by_category` y definir el tratamiento de contraasientos | S |
| `CASH-VAL-004` | Validar `active` en el alta + mostrar cuentas inactivas con saldo en el resumen + corregir el texto del diálogo | S |

### P1 — Necesario para operar con expectativas de control interno
| ID | Corrección | Esfuerzo |
|---|---|---|
| `CASH-MUT-003` | Rechazar `PATCH` sobre movimientos revertidos y sobre contraasientos | S |
| `CASH-VAL-005` | Validar existencia, estado y tipo de la categoría | S |
| `CASH-RPT-002` | Definir y documentar criterio bruto/neto en los totales del período | S |

### P2 — Robustez
| ID | Corrección | Esfuerzo |
|---|---|---|
| `CASH-VAL-006` | Manejar `ForeignKeyConstraintError` en `errorHandler.ts` | S |
| — | Cubrir con tests el frente de reportes y los casos negativos de validación | M |

---

## G. Conclusión

El plan de corrección **hizo lo que prometió en lo esencial**: la integridad del libro contable, que era el problema grave, está resuelta y aguanta presión adversarial —incluida concurrencia real—. Nada de lo que la auditoría original marcó como crítico volvió a aparecer.

Lo que quedó expuesto es que el plan **se concentró en la mecánica de los movimientos y descuidó dos frentes**: la **validación de entrada** (cuentas y categorías, todo preexistente) y la **capa de reportes** (nunca se auditó, y la Fase 2 la empeoró sin que nadie lo notara). Y en un caso —`CASH-REF-003`— la corrección introdujo una regresión funcional al dejar que una regla contable vetara el registro de un hecho de negocio.

Ninguno de los 7 hallazgos exige rehacer trabajo ya hecho: son correcciones acotadas sobre una base que ahora sí es sólida. Con los tres P0 resueltos, el módulo queda consistente como libro contable.

**Sin cambios respecto de la auditoría original:** el módulo sigue **sin ser una caja operativa de turnos** (no existe apertura/cierre/arqueo/conteo físico). Esa sigue siendo una decisión de producto pendiente, no un defecto.

---

## H. Corrección de los P0 (2026-08-07, mismo día)

Los tres hallazgos P0 se corrigieron y se re-verificaron con el mismo método adversarial que los descubrió.

### `CASH-REF-003` — resuelto
`reverseStoreOrderCashIncome` pasa a ser **best-effort** y devuelve `CashReversalOutcome { reversed, applied, shortfall }` en vez de un booleano. Calcula el remanente y **acota** el monto (`Math.min(pedido, remanente)`) en lugar de dejar que `reverseTransactionCore` lance. Guardas deterministas en vez de `try/catch`: si no hay nada que revertir devuelve `applied: 0` sin tocar nada, de modo que un error propagado solo puede venir de una falla real de base.

`updateStoreReturnRefund` ahora **siempre persiste el registro** de la devolución; si la caja no pudo absorber todo, loguea `storeReturns.refund.cashShortfall` con el monto reintegrado, lo revertido y el desvío, para conciliación.

### `CASH-RPT-001` — resuelto
`by_category` pasa a `SUM(CASE WHEN ct.type = 'income' THEN -ct.amount ELSE ct.amount END)`: neto de egreso por categoría. Un movimiento revertido ahora da **0** (antes daba el doble). El frontend además filtra `total > 0` en el gráfico de egresos, así que las categorías neteadas a cero (o con neto de ingreso) dejan de dibujar barras engañosas.

### `CASH-VAL-004` — resuelto
`createTransactionCore` valida que la cuenta origen **y la de destino** estén activas (400 con mensaje explícito). `getSummary` incluye las cuentas inactivas **con saldo distinto de cero**, devolviendo `active` para que la UI las marque con un badge "Inactiva". Corregido el texto del diálogo de la Fase 5, que prometía dos cosas que el sistema no cumplía.

**Efecto secundario detectado y blindado durante la corrección:** el nuevo rechazo de cuentas inactivas habría hecho que `createTransactionCore` lanzara dentro de `recordStoreOrderIncome`, **bloqueando la confirmación de un pago de tienda** si la cuenta configurada estaba dada de baja — exactamente el antipatrón de `CASH-REF-003`. Se agregó un chequeo previo que loguea `store.cashIncome.accountUnusable` y sigue de largo sin crear el asiento. Las **reversiones no pasan por esta validación a propósito**: un movimiento siempre se tiene que poder corregir aunque su cuenta se haya dado de baja después.

### Validación de la corrección

| | |
|---|---|
| `typecheck` | Limpio en ambos repos |
| Suite backend | **249/249** (41 suites) — 11 tests nuevos, cero regresiones |
| Re-sondeo adversarial | **13/13**, incluidas 3 guardas de regresión |
| Navegador | Badges "Inactiva" visibles, saldos incluidos en el total, gráfico de egresos sin barras falsas, sin errores de consola ni de red |

Los tests nuevos cubren justamente los dos frentes que estaban sin cobertura: `cash-validation-reporting.test.ts` (8 tests de validación de cuentas y contabilidad del resumen) y 3 tests de casos borde de reintegro en `cash-reversal-automatic.test.ts`.

Las tres guardas de regresión confirman que lo que ya funcionaba sigue funcionando: cancelar tras un reintegro parcial y tras uno total siguen neteando en cero, y una cuenta de tienda desactivada **no bloquea el cobro**.

### Sigue abierto

`CASH-MUT-003`, `CASH-VAL-005`, `CASH-RPT-002` (P1) y `CASH-VAL-006` (P2), según el backlog de la sección F.

> Nota sobre `CASH-RPT-002`: al netear `by_category` y dejar `total_income`/`total_expense` en bruto, el resumen quedó **internamente inconsistente** (una parte netea reversiones y la otra no). Es deliberado: definir bruto vs. neto en los totales del período es una decisión de producto, no un bug con una única respuesta correcta. Pero conviene resolverlo pronto para que el panel no cuente dos historias distintas.
