# Verificación final de producción — Módulo de Flujo de Caja

**Fecha:** 2026-08-07
**Tipo:** verificación final pre-producción (tercera pasada sobre el módulo)
**Ramas revisadas:** `auditoriacaja` en ambos repos — `backIndians` en `916a486`, `frontIndians` en `e839743`
**Auditorías previas:** `AUDITORIA_FLUJO_CAJA_2026-08-06.md` (original) y `AUDITORIA_FLUJO_CAJA_VERIFICACION_2026-08-07.md` (verificación de las correcciones). Ninguna de las dos se reescribe: son registro histórico.

---

> ## ⚠️ Estado posterior a este informe (2026-08-07, mismo día)
>
> **El veredicto `NO-GO` de abajo se emitió antes de las decisiones de negocio que lo resolvían.** Este informe no se reescribe —es el registro de lo que se encontró— pero hay que leerlo con estas tres decisiones del usuario encima:
>
> | Bloqueante del informe | Decisión | Efecto |
> |---|---|---|
> | **#1** El dominio de turnos no existe | [`DEC-011`](../../docs/project-brain/08-DECISIONS.md): **no aplica a este negocio**, declarado formalmente fuera de alcance | **Resuelto por decisión, no por implementación.** Los criterios de la sección 13 del pedido que dependen de turnos pasan a `NO APLICA` documentado. No volver a auditar contra ellos |
> | **#2** La cobranza de facturas no impacta caja | [`DEC-012`](../../docs/project-brain/08-DECISIONS.md): **automatizar**, con medio de pago en el cobro y las mismas cuentas que la tienda | Pendiente de implementar — Fase 2 del plan |
> | **#3** Totales del período sin netear | [`DEC-013`](../../docs/project-brain/08-DECISIONS.md): **neto, compensando por signo** | Pendiente de implementar — Fase 1 del plan |
>
> **Hallazgo que amplía el alcance de #2, detectado al planificar:** hay **dos** circuitos de cobranza con el mismo defecto, no uno — `addPaymentToInvoice` (facturas de fábrica) y `addPaymentToCatalogInvoice` (facturas de catálogo), este último una copia literal del primero. La sección D de este informe solo documenta el primero.
>
> **Los 8 cobros que existían en desarrollo eran artefactos de `factory-invoices.test.ts`**, no datos de negocio; se borraron junto con el estado que dejaban en las 4 facturas afectadas (`paid` → `issued`, `payment_amount = 0`). No se tocó producción.
>
> **El camino completo al `GO` está en `PLAN_GO_PRODUCCION_CAJA_2026-08-07.md`.** Ese documento, no este, es el que hay que seguir.

---

## A. Veredicto ejecutivo

### `NO-GO` para el flujo de caja por turnos descripto en el pedido. `GO CONDICIONADO` para el libro contable que sí existe.

Hay que separar dos cosas que el pedido trata como una sola:

**1. El sistema pedido (caja de mostrador con dos turnos diarios) no existe.** No es que tenga defectos: **no está construido**. No hay apertura de turno, ni conteo físico por denominaciones, ni arqueo ciego, ni reconteo, ni diferencia, ni aprobación por umbral, ni distribución del efectivo contado, ni entrega/recepción del fondo entre turnos. Verificado por búsqueda exhaustiva en ambos repos (`turno|jornada|shift|arqueo|denominac|conteo|handover|traspaso|blind.?count|cash_register|cash_session|cash_shift`): **cero coincidencias** en `backIndians/src` y `frontIndians/src`. Es coherente con el negocio real —fábrica de indumentaria a pedido + tienda online, sin punto de venta de mostrador— pero significa que **~60% de los criterios de aceptación del pedido no son evaluables**, y varios criterios obligatorios de `NO-GO` de la sección 13 se disparan por ausencia, no por bug.

**2. El módulo que sí existe —un libro contable de cuentas, categorías y movimientos— llegó a esta revisión con un agujero crítico que las dos auditorías anteriores no habían encontrado.** `PUT /api/v1/cash/accounts/:id` con `{"current_balance": 999999.99}` **reescribía el saldo de una cuenta directamente**, sin asiento, sin pasar por el libro. Reproducido contra el servidor: el saldo pasó de `0` a `999999.99` con una sola llamada, y un usuario `billing` (no solo `admin`) también podía hacerlo. Eso anulaba de un plumazo toda la inmutabilidad que la Fase 2 del plan de corrección había construido: no se puede editar un movimiento, pero sí borrar el resultado de todos ellos. **Corregido y verificado en esta sesión.**

Con esa corrección más las cuatro restantes aplicadas, el libro contable queda consistente: 270/270 tests en verde, 22/22 comprobaciones adversariales, y las 64 cuentas de la base de desarrollo cuadran con su libro de movimientos. Lo que queda abierto son decisiones de producto y brechas funcionales conocidas, no defectos de integridad.

### Riesgos principales

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | El flujo de turnos/arqueo pedido no existe: si el negocio lo necesita, hoy se opera en papel | CRÍTICA (funcional) | **Bloqueante para el alcance pedido** — decisión de producto |
| 2 | Sobreescritura directa del saldo por mass assignment | CRÍTICA (integridad) | **Corregido y verificado** |
| 3 | Cobrar una factura interna en efectivo **no** genera movimiento de caja: conciliación 100% manual | ALTA (funcional) | Abierto — requiere decisión y cambio de esquema |
| 4 | `total_income`/`total_expense` del período no netean reversiones (el panel cuenta dos historias) | MEDIA | Abierto — decisión de producto |
| 5 | La auditoría inmutable existe en la API pero **no tiene pantalla**: nadie la ve desde el panel | MEDIA | Abierto |
| 6 | Cero cobertura E2E de caja (no hay `cash.spec.ts` en `e2e/`) | MEDIA | Abierto |
| 7 | Sin exportación de reportes de caja | BAJA | Nunca existió, no es regresión |

---

## B. Inventario de trabajos revisados

| Área | Archivos / commits | Objetivo | Estado | Evidencia |
|---|---|---|---|---|
| Auditoría inmutable | `CashAuditEvent.ts`, `cashAudit.service.ts`, migración `090` | Registro append-only de toda mutación | VERIFICADO | `DELETE`/`PUT` sobre `/cash/audit/:id` → 404; sin `updatedAt` en la tabla; 4 eventos registrados para la cuenta de prueba |
| Inmutabilidad y reversión | `cash.service.ts` (`reverseTransactionCore`), migración `091` | Movimiento confirmado no se edita ni borra | VERIFICADO | `PUT`/`DELETE` de transacción → 404; `PATCH` con `amount`/`type`/`account_id`/`date`/`status` deja los 5 campos intactos |
| Segregación de medios de pago | `store.service.ts` (`cashSettingKeyFor`) | Efectivo → cuenta `cash`; MP/transferencia → cuenta `bank` | VERIFICADO | Revisión de código + tests `store-cash-income.test.ts` |
| Reversión automática | `store.service.ts` (`reverseStoreOrderCashIncome`), `storeReturns.service.ts` | Cancelación/devolución revierte el ingreso | VERIFICADO | `CT-14` del diagnóstico: 0 pedidos cancelados con ingreso vivo |
| Getter DECIMAL→number | `CashAccount.ts` | `current_balance` como `number` | VERIFICADO | `typeof current_balance === 'number'` en la respuesta real |
| Permisos de reversión | `cash.routes.ts` | Revertir solo `admin` | VERIFICADO | `billing` → 403 en `/reverse` y en `/audit`; `seller` → 403 en todo el módulo |
| P0 de la verificación previa | `CASH-REF-003`, `CASH-RPT-001`, `CASH-VAL-004` | 3 hallazgos altos | VERIFICADOS los 3 | Ver sección D |
| **Mass assignment (nuevo)** | `cash.service.ts` (`updateAccount`, `updateCategory`) | — | **IMPLEMENTADO PERO DEFECTUOSO → corregido** | Ver `CASH-MA-001` |
| Dominio de turnos | — | Apertura/arqueo/traspaso | **NO IMPLEMENTADO** | Búsqueda exhaustiva: 0 coincidencias |
| Facturación → caja | `invoice.service.ts` | Cobranza genera movimiento | **NO IMPLEMENTADO** | 0 referencias a caja en el archivo |
| Exportación de reportes | — | CSV/Excel/PDF | **NO IMPLEMENTADO** | `GET /cash/transactions/export` → 422 (la ruta no existe) |
| E2E de caja | `e2e/tests/` | Recorrido de navegador | **NO IMPLEMENTADO** | Solo `admin`, `customer-flows`, `seo`, `store`, `users` |

---

## C. Matriz de trazabilidad de requisitos

Los IDs siguen la numeración de secciones del pedido.

### C.1 — Caja, jornada y turnos (§4.1–4.2, 4.8–4.9)

| ID | Requisito | Implementación | Test / evidencia | Estado | Observación |
|---|---|---|---|---|---|
| T-01 | Caja/punto de venta asociado a sucursal | — | Búsqueda exhaustiva sin resultados | **NO IMPLEMENTADO** | No existe la entidad sucursal ni caja física |
| T-02 | Jornada comercial separada de fecha técnica | Parcial: `businessDate()` fecha en TZ del negocio | `businessDate.test.ts` (7 tests) | **PARCIAL** | Hay fecha de negocio correcta, no hay "jornada" como entidad cerrable |
| T-03 | Turnos mañana/tarde, cruce de medianoche | — | — | **NO IMPLEMENTADO** | — |
| T-04 | Una única apertura activa por caja | — | — | **NO APLICA** | No existe apertura |
| T-05 | Bloqueo de operaciones sobre turnos cerrados | — | — | **NO APLICA** | No existe turno; el análogo más cercano es la inmutabilidad del movimiento, que **sí** funciona |
| T-06 | Conteo físico por denominaciones en apertura | — | — | **NO IMPLEMENTADO** | — |
| T-07 | Arqueo ciego (no revelar el esperado por API antes del conteo) | — | — | **NO APLICA** | No hay cierre; el saldo esperado es visible siempre por diseño del libro contable |
| T-08 | Reconteo obligatorio ante diferencia | — | — | **NO IMPLEMENTADO** | — |
| T-09 | Distribución del efectivo contado | — | Probado como movimientos manuales (ver F) | **NO IMPLEMENTADO** | Se puede *simular* con egresos manuales, sin la garantía de que la ecuación cierre |
| T-10 | Entrega y recepción del fondo entre turnos | — | — | **NO IMPLEMENTADO** | — |

### C.2 — Movimientos, integridad y correcciones (§4.3, 4.7)

| ID | Requisito | Implementación | Test / evidencia | Estado | Observación |
|---|---|---|---|---|---|
| M-01 | Todo movimiento tiene cuenta, usuario, fecha, tipo, categoría, importe | `CashTransaction` | `CT-18`: 0 movimientos sin usuario | **VERIFICADO** | Sin turno ni sucursal (no existen) |
| M-02 | Descripción/motivo obligatorio | `cash.routes.ts:134` | Alta sin descripción → 422 | **VERIFICADO** | — |
| M-03 | Referencia a la operación de origen | `reference_type`/`reference_id` | Filtro `store_order` → 200 | **VERIFICADO** | — |
| M-04 | Idempotencia ante reintento y doble clic | `idempotency_key` + índice único | Reintento secuencial y **carrera real**: mismo `id` devuelto en ambos | **VERIFICADO** | Ver riesgo residual R-05 |
| M-05 | Movimiento confirmado no se edita ni borra | `PUT`/`DELETE` eliminados; `patchTransaction` limitado | `PUT`→404, `DELETE`→404, `PATCH` financiero no altera nada | **VERIFICADO** | — |
| M-06 | Movimiento cerrado (revertido/contraasiento) tampoco se edita | `patchTransaction` (corregido hoy) | 3 tests + sondeo: 400 en ambos casos | **VERIFICADO** | Era `CASH-MUT-003`, estaba abierto |
| M-07 | Corrección vía contraasiento vinculado, original intacto | `reverseTransactionCore` | Reversión total, parcial, encadenada y concurrente | **VERIFICADO** | — |
| M-08 | Motivo obligatorio en la reversión | `cash.routes.ts:171` (mín. 10 caracteres) | Motivo corto → 422 | **VERIFICADO** | — |
| M-09 | **El saldo solo se mueve por asientos** | `updateAccount`/`updateCategory` (corregido hoy) | 4 tests + `PUT {current_balance}` no mueve el saldo | **VERIFICADO** | Era `CASH-MA-001`, **crítico y no detectado antes** |
| M-10 | Validez de cuenta y categoría en el alta | `createTransactionCore`, `assertCategoryUsable` (corregido hoy) | 4 tests + sondeo | **VERIFICADO** | Era `CASH-VAL-005`, estaba abierto |
| M-11 | Aprobación por umbral / separación solicitante-aprobador | — | — | **NO IMPLEMENTADO** | No hay flujo de aprobación en ningún punto |
| M-12 | Límites por rol en retiros | Solo `admin`/`billing` vs. `admin` para revertir | `factory-cash.test.ts` | **PARCIAL** | No hay límites por importe |

### C.3 — Ventas, stock, cobranzas y medios de pago (§4.4–4.6)

| ID | Requisito | Implementación | Test / evidencia | Estado | Observación |
|---|---|---|---|---|---|
| V-01 | Venta genera el movimiento de caja exactamente una vez | `cash_recorded_at` + `LOCK.UPDATE` | `CT-11`: 0 pedidos con doble asiento | **VERIFICADO** | — |
| V-02 | Venta descuenta stock exactamente una vez | `stock_confirmed_at` + `stockLedger` | `stock-reservation.test.ts` (4/4) | **VERIFICADO** | — |
| V-03 | Caja y venta atómicas | Misma transacción Sequelize | Revisión de código + tests | **VERIFICADO** | — |
| V-04 | Reintentos/doble clic no duplican venta ni caja | `Idempotency-Key` en checkout + `cash_recorded_at` | `checkout-idempotency.test.ts` | **VERIFICADO** | — |
| V-05 | Anulación/devolución revierte caja sin borrar evidencia | `reverseStoreOrderCashIncome` | `CT-14`: 0 anomalías; `cash-reversal-automatic.test.ts` | **VERIFICADO** | — |
| V-06 | Reimprimir el comprobante no re-contabiliza | Generación de PDF sin efectos | Revisión de código | **VERIFICADO** | — |
| V-07 | Efectivo afecta el cajón; tarjeta/transferencia/MP no | `cashSettingKeyFor` | Revisión + `store-cash-income.test.ts` | **VERIFICADO** | Depende de que `admin` configure **ambos** settings |
| V-08 | Pago mixto: solo la parte en efectivo afecta caja | — | `store_orders.payment_method` es un valor **único** | **NO APLICA** | La tienda no soporta pago mixto: no hay forma de contabilizarlo mal |
| V-09 | Cuenta corriente no afecta efectivo al crear la deuda | — | — | **NO APLICA** | No existe cuenta corriente |
| V-10 | **Cobrar una factura en efectivo registra el ingreso en caja** | — | `invoice.service.ts`: 0 referencias a caja | **NO IMPLEMENTADO** | Ver hallazgo `CASH-INV-001` |
| V-11 | Una cobranza no impacta dos veces | — | `addPaymentToInvoice` sin idempotencia ni transacción | **IMPLEMENTADO PERO DEFECTUOSO** | Ver `CASH-INV-002` |
| V-12 | Resumen por medio de pago coincide entre venta, caja y reportes | — | No existe reporte por medio de pago | **NO IMPLEMENTADO** | Se infiere por cuenta destino, no por medio |
| V-13 | No se puede vender sin turno abierto | — | — | **NO APLICA** | No existe turno |

### C.4 — Seguridad, auditoría, concurrencia (§6–7)

| ID | Requisito | Implementación | Test / evidencia | Estado | Observación |
|---|---|---|---|---|---|
| S-01 | Backend rechaza roles no autorizados (no solo oculta botones) | `authorize('admin','billing')` | `seller` → 403 llamando la API directo | **VERIFICADO** | — |
| S-02 | Revertir reservado a `admin` | `authorize('admin')` en `/reverse` | `billing` → 403 | **VERIFICADO** | — |
| S-03 | Auditoría solo `admin` | `authorize('admin')` en `/audit` | `billing` → 403 | **VERIFICADO** | — |
| S-04 | Endpoints financieros sin autenticación | — | Sin token → 401 | **VERIFICADO** | — |
| S-05 | **Mass assignment** | Whitelist en `updateAccount`/`updateCategory` (hoy) | 4 tests + sondeo | **VERIFICADO** | Era el hallazgo crítico |
| S-06 | Manipulación de importe/estado desde el frontend | Servicios arman el objeto campo por campo | `PATCH` con 5 campos financieros: ninguno se aplica | **VERIFICADO** | — |
| S-07 | Auditoría no editable ni borrable por API | Tabla append-only, sin rutas de escritura | `PUT`/`DELETE` → 404 | **VERIFICADO** | — |
| S-08 | Sin fuga de datos sensibles en la auditoría | `snapshotOf` filtra por `getAttributes()` | Verificado en la auditoría previa (sin `password_hash`) | **VERIFICADO** | — |
| S-09 | Sin fuga de detalles internos de MySQL en errores | `ForeignKeyConstraintError` → 400 (hoy) | Mensaje: "Categoría no encontrada", sin `CONSTRAINT` | **VERIFICADO** | Era `CASH-VAL-006` |
| S-10 | Dos reversiones simultáneas: solo una prospera | `LOCK.UPDATE` en `reverseTransactionCore` | Carrera real: 201/400, saldo exacto | **VERIFICADO** | — |
| S-11 | Actualización de saldo sin condición de carrera | `increment`/`decrement` (UPDATE atómico) | Revisión + prueba de carrera | **VERIFICADO** | — |
| S-12 | Reversión repetida / reversión de un contraasiento | Guardas explícitas | Ambas → 400 | **VERIFICADO** | — |
| S-13 | Auditoría **visible** para el admin | — | El frontend nunca llama `/cash/audit` | **NO IMPLEMENTADO** | Ver `CASH-UI-001` |
| S-14 | Doble apertura/cierre/aceptación de traspaso | — | — | **NO APLICA** | No existen esas operaciones |

---

## D. Hallazgos

### 🔴 `CASH-MA-001` — El saldo de una cuenta se podía reescribir directamente (mass assignment)

**Severidad: CRÍTICA.** Preexistente desde el origen del módulo. **No detectado por ninguna de las dos auditorías anteriores.**

**Evidencia (probada contra el servidor, no inferida):**

```
PUT /api/v1/cash/accounts/36  {"current_balance": 999999.99}   → 200
   saldo antes = 0.00   →   saldo después = 999999.99
PUT /api/v1/cash/accounts/36  {"active": false}                → 200   (esquiva /toggle)
PUT /api/v1/cash/categories/29 {"is_system": true}             → 200
PUT /api/v1/cash/accounts/36 como `billing` {"current_balance": 1} → 200, saldo = 1
```

**Causa raíz:** `updateAccount` y `updateCategory` hacían `instance.update(input)` con `input = req.body`. `express-validator` valida los campos declarados pero **no descarta los que no lo están**, y `Model#update` aplica cualquier clave que sea un atributo del modelo. `current_balance`, `active` e `is_system` son atributos declarados. El controlador pasa `req.body` tal cual (`cash.controller.ts:25,55`).

**Escenario de fallo:** un usuario `billing` —el rol de facturación, no el de administración— con acceso a la API (una pestaña del navegador basta) sube el saldo de la caja principal al valor que quiera. No queda ningún asiento. El libro de movimientos sigue diciendo una cosa y el saldo otra.

**Impacto de negocio:** anula toda la garantía que construyó la Fase 2 del plan de corrección. La inmutabilidad de los movimientos no sirve de nada si el resultado agregado de todos ellos se puede sobreescribir. Y **el daño es irreparable desde la API**: cualquier asiento nuevo mueve saldo y libro por igual, así que la divergencia no se puede cerrar registrando nada — hace falta un `UPDATE` directo en base.

**Atenuante:** el `PUT` **sí queda auditado** en `cash_audit_events` con `before`/`after`, así que es rastreable *a posteriori* por quien sepa mirar ahí (y hoy nadie lo mira desde el panel, ver `CASH-UI-001`). Y el frontend nunca envía esos campos, así que no se dispara por uso normal.

**Corrección aplicada:** ambos servicios arman el patch campo por campo. Los campos legítimos (`name`, `type`, `description`, `color`) se siguen aplicando.

---

### 🟠 `CASH-INV-001` — Cobrar una factura interna no genera ningún movimiento de caja

**Severidad: ALTA (funcional).** Preexistente. **No es una regresión: nunca existió.**

**Evidencia:** `invoice.service.ts` — cero coincidencias de `cash`/`Cash` en todo el archivo. `addPaymentToInvoice` (líneas 204-226) crea el `InvoicePayment`, recalcula el total pagado y actualiza el estado de la factura. Nada más.

**Agravante estructural:** `InvoicePayment` **no tiene campo de medio de pago** (`id`, `invoice_id`, `amount`, `paid_at`, `notes`). Aunque quisiera conectarse automáticamente, hoy **no hay dato con el que decidir** si esa cobranza fue en efectivo, por transferencia o por MercadoPago. Conectarlo exige una migración y una decisión de negocio.

**Impacto:** la conciliación entre facturación y caja es 100% manual y depende de que el operador recuerde cargar un segundo movimiento a mano. El pedido lo marca explícitamente como posible bloqueo de producción, y lo es **para el alcance pedido**. Para el alcance actual del módulo (libro administrativo) es una brecha conocida, no un defecto de integridad.

**No corregido — es bloqueo de decisión.** Requiere: (a) definir si la cobranza de factura debe impactar caja, (b) agregar `payment_method` a `invoice_payments` con su migración, (c) decidir el mapeo medio→cuenta. Nada de eso es una corrección segura dentro del alcance.

---

### 🟠 `CASH-INV-002` — `addPaymentToInvoice` no es transaccional ni idempotente

**Severidad: MEDIA.** Preexistente, en el módulo de facturación (integración directa de caja).

**Evidencia:** `invoice.service.ts:204-226`. Tres operaciones de escritura/lectura (`InvoicePayment.create`, `findAll`, `invoice.update`) **fuera de toda transacción** y sin clave de idempotencia.

**Escenario de fallo:** dos cobranzas concurrentes sobre la misma factura — A inserta, A lee (ve solo su pago), B inserta, B lee (ve ambos), B actualiza a A+B, A actualiza a solo A. `payment_amount` queda subvaluado y la factura no pasa a `paid` aunque esté cobrada. Un doble clic genera dos `InvoicePayment` sin nada que lo impida.

**No corregido:** está fuera del módulo de caja y arreglarlo bien (transacción + `SELECT ... FOR UPDATE` + idempotencia) toca el flujo de cobranzas completo, con sus propios tests. Se documenta como pendiente con propietario asignado en la sección M.

---

### 🟠 `CASH-RPT-002` — Las reversiones inflan "Ingresos" y "Egresos" del período

**Severidad: MEDIA.** Ya identificado en la verificación previa, **sigue abierto a propósito**.

**Evidencia (re-probada hoy):** un ingreso de `$5.000` dado de alta y revertido deja `delta total_income = +5000` y `delta total_expense = +5000`. `net_balance` queda correcto (delta 0).

**Agravante:** al haberse corregido `by_category` para netear (`CASH-RPT-001`) y dejar los totales en bruto, **el resumen quedó internamente inconsistente**: una mitad del panel netea reversiones y la otra no.

**No corregido: es una decisión de producto.** Reportar flujos brutos es defendible en contabilidad; reportar netos es lo que espera un panel de gestión. No hay una única respuesta correcta y el pedido prohíbe cambiar reglas de negocio ambiguas sin informarlo. **Se necesita que el usuario decida** (ver sección M, R-01).

---

### 🟡 `CASH-UI-001` — La auditoría inmutable no tiene pantalla

**Severidad: MEDIA.** Preexistente.

**Evidencia:** `GET /api/v1/cash/audit` existe, funciona y está bien protegido (`admin`), pero `frontIndians/src/api/cash.ts` **no lo expone** y `CashFlowPage.tsx` nunca lo consulta (0 coincidencias de `audit` en ambos archivos).

**Impacto:** todo el control interno que da la tabla de auditoría —incluido el rastro del `PUT` de `CASH-MA-001`— solo es accesible por `curl`. En la práctica, para el negocio, es como si no existiera. No es un defecto de integridad (los datos están y son correctos), es una brecha de utilidad del control.

**No corregido:** construir la pantalla es trabajo de producto nuevo, no una corrección.

---

### 🟡 `CASH-COV-001` — Cero cobertura E2E del módulo de caja

**Severidad: MEDIA.**

**Evidencia:** `e2e/tests/` contiene `admin.spec.ts`, `customer-flows.spec.ts`, `seo.spec.ts`, `store.spec.ts`, `users.spec.ts`. Ninguno toca `/cash`.

El pedido (§9) exige recorrido E2E del flujo. La cobertura de API es sólida (39 tests de caja) y se hizo prueba manual del recorrido, pero no hay regresión automatizada de la interfaz.

---

### 🟡 `CASH-IDEM-002` — Reusar una clave de idempotencia con otro importe devuelve el movimiento viejo en silencio

**Severidad: BAJA.**

**Evidencia:** alta con `idempotency_key: K` y `amount: 1234` → id 192. Segunda alta con la **misma** `K` y `amount: 99999` → `201`, devuelve el movimiento de `1234`. El segundo movimiento nunca se registra y el cliente recibe un `201` que sugiere que sí.

**Por qué no se corrigió:** es el comportamiento estándar de una clave de idempotencia, la clave la genera el cliente y el frontend usa valores únicos por operación. Endurecerlo (comparar el payload y devolver 409 si difiere) es una mejora legítima pero cambia el contrato de la API. Se deja documentado.

---

### ⚪ `CASH-TURNO-001` — El dominio de turnos no existe

**Severidad: CRÍTICA respecto del alcance pedido / NO APLICA respecto del sistema real.**

**Evidencia:** búsqueda exhaustiva sobre `backIndians/src` y `frontIndians/src` de `turno|jornada|shift|arqueo|denominac|conteo|handover|traspaso|blind.?count|cash_register|cash_session|cash_shift` → **0 archivos**.

**No es un defecto a corregir: es un módulo que no se construyó.** Sin una decisión de producto explícita, no corresponde diseñarlo dentro de una verificación. Ver sección M, R-02.

---

### Hallazgos previos: estado verificado hoy

| ID | Origen | Estado declarado | **Verificado hoy** |
|---|---|---|---|
| `CASH-MUT-001` | Original | Corregido | ✅ Confirmado (`PUT`/`DELETE` → 404, `PATCH` financiero inocuo) |
| `CASH-PAY-002` | Original | Corregido | ✅ Confirmado (`cashSettingKeyFor` separa por medio) |
| `CASH-SALE-002` | Original | Corregido | ✅ Confirmado (`CT-14`: 0 anomalías en base) |
| `CASH-AUDIT-001` | Original | Corregido | ✅ Confirmado (tabla append-only, no editable) |
| `CASH-TYPE-001` | Original | Corregido | ✅ Confirmado (`typeof === 'number'`) |
| `CASH-REF-003` | Verificación | Corregido | ✅ Confirmado (best-effort, registro siempre persiste) |
| `CASH-RPT-001` | Verificación | Corregido | ✅ Confirmado (revertido netea a 0, no a 14.000) |
| `CASH-VAL-004` | Verificación | Corregido | ✅ Confirmado (cuenta inactiva → 400; saldo visible en resumen) |
| `CASH-MUT-003` | Verificación | **Abierto** | 🔧 **Corregido hoy** |
| `CASH-VAL-005` | Verificación | **Abierto** | 🔧 **Corregido hoy** |
| `CASH-VAL-006` | Verificación | **Abierto** | 🔧 **Corregido hoy** |
| `CASH-RPT-002` | Verificación | **Abierto** | ⏸️ Sigue abierto — decisión de producto |

---

## E. Correcciones realizadas

Todas dentro del alcance de caja y sus integraciones directas. Cada una con test de regresión.

### E.1 — `CASH-MA-001`: whitelist en la edición de cuentas y categorías

**Archivo:** `backIndians/src/services/cash.service.ts` (`updateAccount`, `updateCategory`).
**Cambio:** el patch se arma campo por campo en vez de pasar `req.body` a `instance.update()`. Mismo criterio que ya usaban `createTransactionCore` y `patchTransaction`.
**Tests:** 4 en `cash-integrity-hardening.test.ts` (saldo, `active`, `is_system`, y el mismo intento como `billing`).
**Antes:** `PUT {"current_balance": 999999.99}` → saldo `0` → `999999.99`. **Después:** `200` con el nombre aplicado y el saldo intacto.

### E.2 — `CASH-MUT-003`: un movimiento cerrado no se modifica

**Archivos:** `backIndians/src/services/cash.service.ts` (`patchTransaction`), `frontIndians/src/pages/cash/CashFlowPage.tsx`.
**Cambio:** `PATCH` devuelve 400 si el movimiento está `reversed` o si es un contraasiento. Un movimiento con reversión **parcial** sigue siendo editable (no está cerrado). La UI ya no muestra el formulario de edición en esos casos, con un texto que explica por qué.
**Tests:** 3 (revertido, contraasiento, y la guarda de no-regresión de la reversión parcial).
**Antes:** `PATCH` sobre revertido → `200`, categoría reescrita. **Después:** `400`, movimiento intacto.

### E.3 — `CASH-VAL-005`: validación de categoría

**Archivo:** `backIndians/src/services/cash.service.ts` (`assertCategoryUsable`, usada en `createTransactionCore` y `patchTransaction`).
**Cambio:** la categoría debe existir, estar activa y ser de tipo `both` o del mismo tipo que el movimiento. `transfer` acepta cualquiera (igual que el formulario del panel). Las reversiones quedan exentas a propósito: el contraasiento es del tipo opuesto y reusa la categoría del original.
**Frontend:** el selector de categoría del modal de detalle ahora filtra por tipo, igual que el de alta — antes ofrecía opciones que el backend rechaza.
**Tests:** 4 (tipo incompatible, categoría `both` en ambos sentidos, categoría desactivada, y que un rechazo no deje el saldo tocado a medias).
**Antes:** ambos casos → `201`. **Después:** `400` con mensaje explícito.

### E.4 — `CASH-VAL-006`: FK inexistente devuelve 400/404, no 500

**Archivo:** `backIndians/src/middlewares/errorHandler.ts`.
**Cambio:** `ForeignKeyConstraintError` se maneja como 400 con mensaje genérico. En el caso de caja, `assertCategoryUsable` ya lo intercepta antes con un 404 más preciso; el handler es la red de seguridad para el resto del proyecto.
**Antes:** `500` con el mensaje crudo de MySQL (`CONSTRAINT cash_transactions_ibfk_54 FOREIGN KEY...`) en desarrollo. **Después:** `404 — "Categoría no encontrada"`, sin filtrar nombres de constraint.

### E.5 — Fecha de negocio en zona horaria operativa

**Archivos:** `backIndians/src/utils/helpers.ts` (nuevo `businessDate` / `BUSINESS_TIMEZONE`), `cash.service.ts` (`reverseTransactionCore`), `store.service.ts` (`recordStoreOrderIncome`).
**Defecto:** ambos asientos automáticos usaban `new Date().toISOString().slice(0, 10)` — la fecha **UTC**. Tucumán es UTC−3, así que **todo lo registrado entre las 21:00 y la medianoche local quedaba fechado al día siguiente**, cayendo en la jornada equivocada del resumen diario y de cualquier corte por fecha.
**Tests:** 7 unitarios con instantes fijos (`businessDate.test.ts`). Deliberadamente **no** usan la hora del reloj: con "ahora", el test pasaría el 90% del día aun con el defecto vivo.
**Antes:** `new Date('2026-08-08T01:30:00Z').toISOString().slice(0,10)` → `2026-08-08`. **Después:** `businessDate(...)` → `2026-08-07`.

### E.6 — Script de diagnóstico de integridad (nuevo)

**Archivo:** `backIndians/scripts/cash-integrity-check.ts` (solo lectura, `exit 1` si hay anomalías).
18 comprobaciones estructurales (FK huérfanas, sobre-reversión, doble contabilización de un pedido, `cash_recorded_at` sin asiento, cancelados sin revertir, claves de idempotencia duplicadas…) **más la prueba de fondo**: recalcula el saldo de cada cuenta desde su libro de movimientos y falla si no cuadra. Es el detector directo de `CASH-MA-001` y el precheck/smoke test del despliegue.

### Archivos que ya estaban modificados antes de esta intervención

**Ninguno.** Ambos repos tenían el working tree limpio al empezar (`git status` sin salida, ramas `auditoriacaja` en `916a486` y `e839743`). Todo lo listado abajo es de esta sesión:

```
backIndians (M) src/services/cash.service.ts, src/services/store.service.ts,
                src/middlewares/errorHandler.ts, src/utils/helpers.ts, tsconfig.seed.json
backIndians (?) scripts/cash-integrity-check.ts,
                src/__tests__/api/cash-integrity-hardening.test.ts,
                src/__tests__/unit/businessDate.test.ts
frontIndians (M) src/pages/cash/CashFlowPage.tsx
docs (M) docs/project-brain/03-BUSINESS-RULES.md  (BR-CASH-010/011/012 nuevas)
```

---

## F. Validación contable

### Fórmula encontrada

No existe fórmula de "efectivo esperado de turno" porque no existe el turno. Lo que hay es el saldo acumulado por cuenta:

```
current_balance(cuenta) = Σ ingresos − Σ egresos − Σ transferencias salientes + Σ transferencias entrantes
```

Implementada como `UPDATE cash_accounts SET current_balance = current_balance ± monto` (`increment`/`decrement` de Sequelize), siempre dentro de una transacción — nunca lectura-cálculo-escritura en JS, así que no hay condición de carrera en el saldo.

**El backend recalcula todo desde datos persistidos.** El frontend nunca envía totales ni diferencias que el backend adopte: `getSummary` corre tres consultas SQL sobre `cash_transactions` en cada request. Verificado por lectura de código y por prueba (`PATCH` con `amount`/`status` no altera nada).

**Tras la corrección de `CASH-MA-001`, el saldo es realmente derivado del libro**: `scripts/cash-integrity-check.ts` lo recalcula y las **64 cuentas de la base de desarrollo cuadran**.

### Medios incluidos y excluidos del efectivo

| Medio | ¿Toca la caja física? | Mecanismo |
|---|---|---|
| Efectivo | Sí | `store_cash_account_id` (cuenta `cash`) |
| MercadoPago | No | `store_bank_account_id` (cuenta `bank`) |
| Transferencia bancaria | No | `store_bank_account_id` |
| Tarjeta | — | No es un medio de pago propio de la tienda |
| Pago mixto | — | No existe: `payment_method` es un valor único por pedido |

### Resultado del caso obligatorio (ARS 155.000)

Ejecutado por HTTP contra el backend, en una cuenta QA **limpia** (saldo inicial `0.00`) creada para la prueba:

| Operación | Tipo | Monto | ¿Afecta efectivo? | Registrado |
|---|---|---|---|---|
| Apertura contada | income | 100.000 | Sí | Sí |
| Ventas en efectivo | income | 80.000 | Sí | Sí |
| Ventas por transferencia | — | 45.000 | **No** | No |
| Ventas con tarjeta | — | 30.000 | **No** | No |
| Ingreso manual autorizado | income | 10.000 | Sí | Sí |
| Gasto en efectivo | expense | 12.000 | Sí | Sí |
| Devolución en efectivo | expense | 3.000 | Sí | Sí |
| Retiro de caja | expense | 20.000 | Sí | Sí |

```
100.000 + 80.000 + 10.000 − 12.000 − 3.000 − 20.000 = 155.000
saldo obtenido: 155000   ✅ exacto, tipo number
```

**Faltante de $500** (conteo `154.500`): registrado como egreso de ajuste → saldo `154.500`. ✅
**Distribución** (`dejar 30.000` + `retirar 124.500 = 154.500`): tras el retiro, saldo remanente `30.000`. ✅ La aritmética cierra.

> **Advertencia honesta sobre este resultado:** la ecuación cierra porque se cargaron los movimientos correctos a mano. **El sistema no impone la ecuación de distribución** — no hay ningún control que verifique que `CONTADO = DEJADO + RETIRADO + DEPOSITADO + …`, ni que el próximo turno reciba esos 30.000. Se probó la aritmética, no un flujo de cierre, porque el flujo de cierre no existe. No debe leerse este ✅ como "la distribución está implementada".

### Precisión y redondeo

- `DECIMAL(12,2)` en las tres tablas de caja. Sin `FLOAT` en ningún lado.
- Getter DECIMAL→number en `CashAccount.current_balance`; verificado que la API devuelve `number`.
- Decimales fraccionarios (`0,10 + 0,20`) sin artefactos de punto flotante en el saldo persistido.
- Margen deliberado de un décimo de centavo (`0.001`) en las comparaciones de reversión, para acumulación de redondeo en sumas sucesivas. Correcto.
- Importes negativos y cero rechazados con 422.

### Consistencia entre caja, ventas y reportes

Coherente **salvo** por `CASH-RPT-002` (abierto): `by_category` netea reversiones y `total_income`/`total_expense` no. `net_balance` es correcto en ambos criterios.

---

## G. Integridad y datos históricos

### Migraciones verificadas

`018` (creación), `085-087` (integración tienda), `090-092` (auditoría y reversión). Todas con `up`/`down`, guardas de idempotencia (`describeTable` antes de `addColumn`), tipos `DECIMAL`, FK e índices declarados. `ensureSchema.ts` replica las columnas de `090-092` y de `store_orders`/`store_returns` — coherente con las migraciones, como exige `CLAUDE.md`.

**Defecto conocido de rollback (preexistente, ya documentado):** el `down()` de la migración `091` borra `idx_cash_transactions_reversal_of` antes que la FK que lo usa, y falla con `Cannot drop index ... needed in a foreign key constraint`. Solo afecta `migrate:undo`, que no se ejecuta en producción, pero **inutiliza el rollback por migración** — ver el plan de rollback (sección L), que por eso se apoya en el backup.

### Consultas diagnósticas ejecutadas

`scripts/cash-integrity-check.ts` contra `textil_db` (desarrollo). Resultado:

| Verificación | Resultado |
|---|---|
| CT-01/02 FK huérfanas de cuenta y categoría | 0 |
| CT-03 Importes nulos, cero o negativos | 0 |
| CT-04/05 Transferencias mal formadas | 0 |
| CT-06 Sobre-reversión (revertir más que el original) | 0 |
| CT-07/08 `status` incoherente con los contraasientos | 0 |
| CT-09 Reversión de una reversión | 0 |
| CT-10 Claves de idempotencia duplicadas | 0 |
| CT-11 Pedido con doble asiento de ingreso | 0 |
| CT-12/13 `cash_recorded_at` desalineado con el asiento | 0 |
| CT-14 Pedido cancelado con ingreso sin revertir | 0 |
| CT-18 Movimientos sin usuario responsable | 0 |
| **Saldo persistido vs. recalculado desde el libro** | **64/64 cuentas cuadran** |

**Informativos (no bloqueantes):**
- `CT-15`: 3 movimientos en categorías de tipo incompatible — **todos son artefactos de QA de las auditorías previas** (`AUD SoloIngreso...`, `QA-OUT-...`, `QA-IN-...`), anteriores a la validación agregada hoy. Confirma que la regla no existía; el dato real no está afectado.
- `CT-16`: 7 cuentas inactivas con saldo — todas de QA. Es el comportamiento correcto desde `BR-CASH-007`: aparecen en el resumen marcadas como inactivas.
- `CT-17`: 3 cuentas con saldo negativo — todas cuentas QA de la prueba de neteo.

### Anomalía encontrada y reparada durante esta verificación

El diagnóstico detectó **exactamente una** divergencia bloqueante: la cuenta 36, `persistido 5556.30` vs. `recalculado 160222.30`. **La causé yo al explotar `CASH-MA-001`** durante el sondeo adversarial — es la prueba directa de que el defecto corrompe el libro y de que el detector funciona. Reparada con un `UPDATE` puntual al valor que dicta el libro (única vía posible, ver `BR-CASH-010`), y re-verificada: 64/64 cuentas cuadran. **Ninguna anomalía en datos reales del negocio.**

### Estrategia de compatibilidad y riesgo residual

Los datos anteriores al nuevo flujo son consultables y correctos: no hay registros previos a la existencia de turnos porque **nunca hubo turnos**, así que no hay backfill que inventar. Las migraciones `090-092` son puramente aditivas (columnas nullable con default y una tabla nueva), sin riesgo sobre datos existentes ni bloqueo prolongado de tabla al volumen actual.

**Riesgo residual:** el diagnóstico se corrió contra desarrollo. **Debe correrse contra producción antes y después de migrar** — está en el plan de la sección L como precheck y como smoke test.

---

## H. Seguridad, permisos y concurrencia

### Controles probados (llamadas directas a la API, no inspección de la UI)

| Prueba negativa | Resultado |
|---|---|
| `seller` accede a cualquier endpoint de caja | 403 |
| Sin token | 401 |
| `billing` revierte un movimiento | 403 |
| `billing` lee la auditoría | 403 |
| `billing` reescribe un saldo por mass assignment | **Bloqueado tras la corrección** |
| `PUT`/`DELETE` de una transacción | 404 (las rutas no existen) |
| `PATCH` enviando `amount`, `type`, `account_id`, `date`, `status` juntos | Los 5 campos quedan intactos |
| `PUT`/`DELETE` sobre un evento de auditoría | 404 |
| Revertir dos veces el mismo movimiento | 400 |
| Revertir un contraasiento | 400 |
| Motivo de reversión de menos de 10 caracteres | 422 |
| Importe negativo o cero | 422 |
| Categoría/cuenta inexistente | 404 sin filtrar nombres de constraint |
| Alta contra cuenta o categoría desactivada | 400 |

### Condiciones de carrera

| Escenario | Resultado |
|---|---|
| **Dos reversiones simultáneas del mismo movimiento** | Solo una prospera (`201`/`400`); saldo final exacto. El `LOCK.UPDATE` de `reverseTransactionCore` serializa correctamente |
| **Dos altas simultáneas con la misma clave de idempotencia** | Ambas `201`, **el mismo `id`** — el índice único frena a la segunda y se devuelve la ganadora |
| Actualización concurrente de saldo | `increment`/`decrement` es un `UPDATE` atómico a nivel SQL |
| Doble apertura/cierre/aceptación de traspaso | **No aplica**: esas operaciones no existen |

### Separación de funciones

**No existe.** No hay flujo de aprobación en ningún punto del módulo: no hay retiros con umbral, ni diferencias que aprobar, ni distinción entre solicitante y aprobador. La única separación es de rol: `admin` puede revertir y ver la auditoría, `billing` no. Es una brecha real respecto del pedido (§6.1) y consecuencia directa de que no exista el dominio de turnos.

### Auditoría

Registra alta, edición, reversión y toggle sobre transacciones, cuentas y categorías, con usuario, IP, user-agent, `correlationId` y snapshots `before`/`after` filtrados por columnas reales (sin arrastrar `password_hash` de las asociaciones). Append-only: la tabla no tiene `updatedAt` y no hay rutas de escritura.

**Los intentos denegados (403) no se registran acá a propósito** — quedan en el log de Pino. Es una decisión declarada en el código, pero el pedido (§6.3) pide explícitamente eventos denegados en la auditoría de dominio: **brecha menor, documentada**.

**Y no tiene pantalla** (`CASH-UI-001`): el control existe pero nadie lo ve desde el panel.

---

## I. Resultado de calidad

| Comando / prueba | Resultado | Evidencia resumida | Bloqueante |
|---|---|---|---|
| `backIndians: npm run typecheck` | ✅ Limpio | `tsc --noEmit` sin salida | No |
| `backIndians: tsc --noEmit -p tsconfig.seed.json` | ✅ Limpio | incluye `scripts/` (agregado al include) | No |
| `backIndians: npm run build` | ✅ Limpio | `tsc` sin errores | No |
| `backIndians: npm run test:full` (seed + suite completa) | ✅ **270/270, 43 suites** | 166 s, cero fallos | No |
| `backIndians: jest cash-integrity-hardening` (nuevo) | ✅ **14/14** | Regresión de las 4 correcciones | No |
| `backIndians: jest businessDate` (nuevo) | ✅ **7/7** | Instantes fijos, no hora del reloj | No |
| `backIndians: scripts/cash-integrity-check.ts` | ✅ Sin anomalías bloqueantes | 18 checks + 64/64 cuentas cuadran | No |
| `frontIndians: tsc --noEmit` | ✅ Limpio | Sin salida | No |
| `frontIndians: npm run build` | ✅ `built in 4.00s` | `CashFlowPage-*.js` 38,68 kB | No |
| `frontIndians: npm run lint` | ⚠️ 171 problemas (160 errores, 11 warnings) | **Línea de base preexistente, ninguno nuevo.** En caja solo un warning del React Compiler (`watch()` de react-hook-form no memoizable) | No |
| Sondeo adversarial ronda 1 (pre-corrección) | 19/32 — **13 fallos** | Descubrió `CASH-MA-001` | — |
| Sondeo adversarial ronda 2 (post-corrección) | ✅ **22/22** | Incluye 5 guardas de no-regresión | No |
| Prueba de concurrencia (reversión simultánea) | ✅ 201/400, saldo exacto | Peticiones reales en paralelo | No |
| Prueba de concurrencia (idempotencia en carrera) | ✅ Mismo `id` en ambas | — | No |
| **E2E de caja (Playwright)** | ❌ **No ejecutado: no existe** | `e2e/tests/` no tiene `cash.spec.ts` | **Sí, para el criterio E2E del pedido** |
| **Migraciones sobre base limpia** | ⚠️ No re-ejecutado en esta sesión | Sí se hizo en la sesión previa: `db:drop` + `db:create` + `db:migrate` (92 migraciones desde cero) + `seed:test`, documentado en `10-SESSION-HANDOFF.md`. Esta sesión no agregó migraciones | No |
| **`npm audit` de dependencias** | ❌ No ejecutado | No se corrió el análisis de vulnerabilidades pedido en §10 | Parcial — ver R-06 |

**No se ocultó ningún test fallido, ni se borró, deshabilitó ni relajó ninguna aserción.** Los 3 fallos de `stock-reservation` que aparecieron en la corrida inicial fueron artefacto de editar `store.service.ts` mientras jest ya estaba corriendo (se agregó la llamada a `businessDate()` antes que su `import`); la suite completa posterior pasa 270/270 y esa suite pasa 4/4 en aislamiento.

---

## J. Regresiones verificadas

| Módulo conectado | Cómo se verificó | Resultado |
|---|---|---|
| Login, roles y permisos | `factory-roles.test.ts`, `admin.test.ts`, `users-welcome-email.test.ts` + pruebas negativas por HTTP con los 3 roles | ✅ Sin regresión |
| Ventas / pedidos de fábrica | `factory-orders.test.ts`, `transitions.test.ts` | ✅ Sin regresión |
| Facturación | `factory-invoices.test.ts` | ✅ Sin regresión (nota: `CASH-INV-001/002` son brechas preexistentes, no regresiones) |
| Pagos y checkout | `checkout-idempotency`, `checkout-quote`, `purchase-flow`, `mp`, `webhook-robustness`, `reconcile-payments` | ✅ Sin regresión |
| Stock y movimientos | `stock-ledger`, `stock-reservation` (4/4), `stock-restoration`, `factory-stock` | ✅ Sin regresión |
| Anulaciones y devoluciones | `store-returns`, `cash-reversal-automatic` | ✅ Sin regresión |
| Comprobantes / PDF | Cubierto por `purchase-flow` y `store-*` | ✅ Sin regresión |
| Reportes y dashboard | `factory-dashboard`, `store-analytics`, `report-inconsistencies-2-7` | ✅ Sin regresión |
| Tienda online (transiciones, tracking, cupones) | `store-transitions`, `store-tracking`, `coupon-per-customer`, `store-public` | ✅ Sin regresión |
| **UI de caja** | Cambio de UI acompañando `CASH-MUT-003`/`CASH-VAL-005`; build y typecheck limpios | ⚠️ **Verificado por compilación, no por navegador en esta sesión** — ver R-07 |

**El `errorHandler` cambió y es transversal a todo el proyecto**, no solo a caja. El nuevo bloque solo intercepta `ForeignKeyConstraintError`, que antes caía en el `500` genérico: no altera ninguna ruta que ya funcionara. Las 43 suites en verde lo respaldan.

---

## K. Checklist de producción

### Integridad financiera
- [x] El saldo solo se mueve por asientos (`CASH-MA-001` corregido y verificado)
- [x] Movimiento confirmado no se edita ni se borra
- [x] Movimiento cerrado (revertido / contraasiento) tampoco se modifica
- [x] Corrección exclusivamente por contraasiento vinculado, con motivo obligatorio
- [x] Cálculo de saldo y resumen recalculados en backend desde datos persistidos
- [x] Precisión monetaria `DECIMAL(12,2)`, sin `FLOAT`, sin pérdida verificada
- [x] Cuenta y categoría validadas (existencia, estado, tipo)
- [x] Saldo de cada cuenta cuadra con su libro de movimientos (64/64)
- [ ] **Criterio bruto vs. neto de los totales del período definido** (`CASH-RPT-002`)

### Ventas, stock y cobranzas
- [x] Una venta genera el movimiento de caja exactamente una vez
- [x] Una venta descuenta stock exactamente una vez
- [x] Caja y venta son atómicas
- [x] Reintentos y doble clic no duplican nada
- [x] Cancelación y devolución revierten el impacto en caja
- [x] Los medios no efectivos no tocan la caja física
- [!] **Cobrar una factura interna en efectivo no genera movimiento de caja** (`CASH-INV-001`)
- [ ] `addPaymentToInvoice` transaccional e idempotente (`CASH-INV-002`)

### Seguridad y control interno
- [x] Permisos verificados en backend con llamadas directas, no solo en la UI
- [x] Sin mass assignment
- [x] Auditoría inmutable, no editable ni borrable por API
- [x] Sin fuga de datos sensibles ni de detalles internos de MySQL
- [x] Concurrencia probada en reversión e idempotencia
- [ ] **La auditoría tiene pantalla en el panel** (`CASH-UI-001`)
- [ ] Eventos denegados (403) registrados en la auditoría de dominio
- [!] **Separación de funciones / aprobación por umbral** — no existe

### Calidad
- [x] Typecheck limpio en ambos repos
- [x] Build limpio en ambos repos
- [x] Suite backend completa en verde (270/270)
- [x] Test de regresión por cada defecto corregido
- [x] Diagnóstico de integridad de datos sin anomalías
- [ ] **E2E de caja** (`CASH-COV-001`)
- [ ] Verificación en navegador del cambio de UI de esta sesión
- [ ] `npm audit` de dependencias

### Alcance pedido (caja por turnos)
- [!] **Apertura de turno con conteo físico** — no existe
- [!] **Arqueo ciego y reconteo** — no existe
- [!] **Diferencia con motivo y aprobación** — no existe
- [!] **Distribución del efectivo contado** — no existe
- [!] **Entrega y recepción del fondo entre turnos** — no existe
- [!] **Exportación de reportes de caja** — no existe

### Despliegue
- [x] Migraciones aditivas, con `up`/`down` y guardas de idempotencia
- [x] Script de precheck/smoke test disponible (`scripts/cash-integrity-check.ts`)
- [ ] Backup verificado antes de migrar
- [ ] Diagnóstico corrido contra producción (pre y post)
- [ ] `store_cash_account_id` y `store_bank_account_id` configurados en producción
- [!] **Rollback por migración inutilizable** (`down()` de la `091` falla) — depende del backup

---

## L. Plan exacto de despliegue y rollback

> No ejecutado. Backend en Railway, frontend estático en Donweb por FTP.

### 1. Backup (obligatorio, bloqueante)
```bash
mysqldump --single-transaction --routines --triggers -h <host> -P <port> -u <user> -p <db> \
  > backup-pre-caja-$(date +%Y%m%d-%H%M).sql
```
Verificar que el archivo no esté vacío y **restaurarlo en una base descartable** para confirmar que sirve. Un backup no probado no es un backup. Anotar el timestamp: es el punto de restauración.

### 2. Prechecks (sobre producción, solo lectura)
```bash
npx ts-node --project tsconfig.seed.json scripts/cash-integrity-check.ts
```
- **Si sale con código 1, detener el despliegue** y resolver las anomalías primero.
- Registrar el saldo de cada cuenta de caja **antes** de tocar nada: es la referencia para el smoke test.
- Confirmar `store_cash_account_id` y `store_bank_account_id` en `settings` (sin ellos el ingreso de tienda no se asienta, solo loguea un warning).
- Confirmar que existe la categoría de sistema `Ventas tienda online`.

### 3. Orden de despliegue
1. **Migraciones primero** (`npm run migrate`). Las `090-092` son aditivas —columnas nullable con default y una tabla nueva— así que el backend viejo sigue funcionando con el esquema nuevo: no hay ventana de incompatibilidad.
2. **Backend después** (Railway). El código nuevo requiere las columnas nuevas; si se despliega antes de migrar, `createTransactionCore` falla.
3. **Frontend al final** (build + FTP a `/public_html`). El frontend nuevo asume el backend nuevo (el modal de detalle ya no ofrece editar movimientos cerrados). Al revés no rompe: el frontend viejo contra backend nuevo solo recibe un 400 en un caso que antes pasaba.

### 4. Smoke tests (en este orden, con una cuenta de prueba)
```bash
npx ts-node --project tsconfig.seed.json scripts/cash-integrity-check.ts   # debe salir 0
```
1. `GET /cash/summary` → 200, y el saldo de cada cuenta **idéntico al anotado en el paso 2**.
2. Alta de un movimiento de $1 → 201, saldo +1.
3. Revertir ese movimiento con motivo → 201, saldo vuelve al original, badge "Revertido" visible.
4. `PATCH` sobre el movimiento revertido → **400** (confirma `CASH-MUT-003`).
5. `PUT /cash/accounts/:id {"current_balance": 1}` → 200 **con el saldo intacto** (confirma `CASH-MA-001`).
6. `seller` sobre `/cash/summary` → 403.
7. Un pedido de tienda pagado en efectivo asienta en la cuenta `cash`; uno con MercadoPago, en la `bank`.
8. En el navegador: `/cash` carga, el gráfico de egresos dibuja, no hay errores de consola ni de red.

### 5. Monitoreo (primeras 48 h)
- Logs de Pino, filtrando por: `store.cashIncome.accountNotConfigured`, `store.cashIncome.accountUnusable`, `storeReturns.refund.cashShortfall`, `db.foreignKey`, `unhandledError`.
- Correr `cash-integrity-check.ts` **diariamente durante la primera semana**. Cualquier divergencia entre saldo y libro es señal de escritura fuera del ledger.
- Vigilar la tasa de `400` en `/cash/transactions`: un pico indica categorías o cuentas mal configuradas tras las nuevas validaciones.

### 6. Condiciones para hacer rollback
- El diagnóstico de integridad falla después de migrar.
- Un saldo de caja no coincide con el anotado antes del despliegue.
- Los movimientos de caja de tienda dejan de generarse (ausencia de asientos con `reference_type='store_order'` durante una jornada con pedidos pagados).
- Errores 500 sostenidos en cualquier endpoint de `/cash`.

### 7. Pasos de rollback
1. Revertir el **frontend** primero (subir el build anterior por FTP): es lo más rápido y devuelve el panel a un estado funcional.
2. Revertir el **backend** en Railway al deploy anterior.
3. **No usar `migrate:undo`**: el `down()` de la migración `091` falla (`Cannot drop index 'idx_cash_transactions_reversal_of': needed in a foreign key constraint`). Como las `090-092` son aditivas, **el backend anterior convive sin problema con el esquema nuevo**: en la mayoría de los casos no hace falta revertir el esquema.
4. Solo si el esquema quedó realmente inconsistente: **restaurar el backup del paso 1**, asumiendo la pérdida de las transacciones posteriores al backup. Es la única vía de rollback de esquema disponible hoy.

---

## M. Riesgos residuales y pendientes

| ID | Riesgo / pendiente | Acción concreta | Propietario sugerido | Criterio de cierre |
|---|---|---|---|---|
| R-01 | `CASH-RPT-002`: el resumen cuenta dos historias (`by_category` netea reversiones, los totales no) | Decidir **bruto o neto** para `total_income`/`total_expense`. Si es neto: excluir `status='reversed'` y `reversal_of_id IS NOT NULL`. Documentar la decisión en `03-BUSINESS-RULES.md` | **Usuario (decisión de negocio)** + backend | El panel usa un solo criterio, hay test que lo fija y el rótulo de la UI lo dice |
| R-02 | El dominio de turnos no existe | Definir explícitamente si el negocio necesita caja de mostrador con dos turnos. **Si sí**, es un módulo nuevo (turno, conteo por denominaciones, arqueo ciego, reconteo, diferencia con aprobación, distribución, traspaso), no un parche sobre lo existente. **Si no**, dejarlo asentado en `08-DECISIONS.md` para no volver a auditarlo contra un requisito que no aplica | **Usuario** | Decisión escrita en `08-DECISIONS.md` |
| R-03 | `CASH-INV-001`: la cobranza de facturas no impacta caja | (a) Decidir si debe impactar. (b) Migración: `payment_method` en `invoice_payments`. (c) Conectar con `createSystemTransaction` reusando el mapeo medio→cuenta de `cashSettingKeyFor` | **Usuario** (a) + backend (b, c) | Cobrar una factura en efectivo genera el asiento, con test que lo demuestra |
| R-04 | `CASH-INV-002`: `addPaymentToInvoice` sin transacción ni idempotencia | Envolver en `sequelize.transaction` con `LOCK.UPDATE` sobre la factura; agregar `idempotency_key` con índice único | Backend | Test de dos cobranzas concurrentes que deja `payment_amount` correcto |
| R-05 | `CASH-IDEM-002`: misma clave con distinto importe devuelve el movimiento viejo con `201` | Comparar el payload de la clave existente y devolver `409` si difiere | Backend | Test que verifica el 409 |
| R-06 | `npm audit` no ejecutado | Correr en ambos repos, separar runtime de desarrollo y descartar falsos positivos | DevOps | Informe de vulnerabilidades sin críticas en runtime |
| R-07 | El cambio de UI de esta sesión no se probó en navegador | Abrir `/cash`, abrir el detalle de un movimiento revertido y de un contraasiento: debe verse el texto explicativo en vez del formulario. Verificar que el selector de categoría filtra por tipo | Frontend | Recorrido manual sin errores de consola |
| R-08 | `CASH-UI-001`: la auditoría no tiene pantalla | Agregar `getAuditEvents` a `cash.ts` y una pestaña "Auditoría" en `CashFlowPage` (solo `admin`) | Frontend | El admin ve quién cambió qué y cuándo, sin salir del panel |
| R-09 | `CASH-COV-001`: cero E2E de caja | `e2e/tests/cash.spec.ts`: alta → detalle → reversión → verificación del saldo | QA | El spec corre en verde |
| R-10 | Rollback por migración inutilizable (`down()` de la `091`) | Nueva migración que corrija el orden (borrar la FK antes que el índice). **No editar la `091`**, ya está aplicada | Backend | `migrate:undo` de la `091` funciona sobre una base de prueba |
| R-11 | Mismo patrón de mass assignment fuera de caja | `client.service.ts:60`, `master.service.ts:66,111,141`, `product.service.ts:42`, `stock.service.ts:133` hacen `instance.update(input)` con el body crudo. **No se auditó su impacto** — está fuera del alcance de caja, pero el patrón es el mismo | Backend | Cada uno revisado y con whitelist o justificación escrita |
| R-12 | Los intentos denegados (403) no quedan en la auditoría de dominio | Decidir si se registran (el pedido §6.3 lo exige; el código lo omite a propósito para no ensuciar el registro contable) | **Usuario** + backend | Decisión escrita |
| R-13 | El diagnóstico solo se corrió contra desarrollo | Correrlo contra producción antes y después de migrar (ya está en el plan de la sección L) | DevOps | Salida con código 0 en producción |

---

## N. Conclusión final

El módulo **que existe** —un libro contable de cuentas, categorías y movimientos con auditoría inmutable— está hoy en su mejor estado: la integridad del libro aguanta presión adversarial, la concurrencia está resuelta con bloqueos reales, la aritmética es exacta y el saldo de cada cuenta cuadra con sus asientos. Las cinco correcciones de esta sesión cerraron un agujero crítico que dos auditorías anteriores no habían visto y los tres hallazgos que quedaban abiertos del backlog.

Pero **el módulo pedido no es ese**. El pedido describe una caja de mostrador operada por turnos, con conteo físico, arqueo ciego, reconteo, aprobación de diferencias, distribución del efectivo contado y traspaso de fondo entre turnos. Nada de eso existe, y no es una brecha que se cierre corrigiendo defectos: es un módulo que hay que construir, o un requisito que hay que declarar formalmente como no aplicable a este negocio. Los criterios obligatorios de la sección 13 del pedido se disparan por esa ausencia, no por la calidad del código.

Declarar `GO` sobre esa base sería aprobar un sistema por lo que hace bien, ignorando que no hace lo que se pidió. Y `CASH-INV-001` —cobrar una factura en efectivo sin que la caja se entere— es, por sí solo, una conciliación manual incompleta que el propio pedido manda tratar como bloqueo.

Si la decisión de negocio confirma que **no** hace falta el flujo por turnos y que la conciliación manual de facturas es aceptable, el libro contable actual es desplegable con el plan de la sección L y los pendientes R-01 y R-07 resueltos primero.

```text
VEREDICTO FINAL: NO-GO PARA PRODUCCIÓN
```

### Bloqueantes pendientes, en orden de prioridad

1. **El dominio de caja por turnos no existe** (`CASH-TURNO-001`) — apertura, conteo físico, arqueo ciego, reconteo, diferencia con aprobación, distribución y traspaso de fondo. Requiere decisión de producto (R-02) antes que una línea de código.
2. **Cobrar una factura interna no genera movimiento de caja** (`CASH-INV-001`) — la conciliación entre facturación y caja es manual e incompleta, y hoy ni siquiera hay campo de medio de pago con el que automatizarla (R-03).
3. **El criterio bruto/neto de los totales del período no está definido** (`CASH-RPT-002`) — el panel muestra dos criterios contradictorios a la vez (R-01).
4. **Cero cobertura E2E del módulo** (`CASH-COV-001`) — el pedido lo exige y no hay ningún spec de caja (R-09).
5. **El cambio de UI de esta sesión no se verificó en navegador** (R-07) — es la única puerta de calidad del trabajo de hoy que quedó sin cerrar.
6. **El rollback por migración está inutilizable** (R-10) — hoy el único rollback de esquema viable es restaurar el backup.

---

> **Nota de honestidad sobre el sesgo:** las correcciones de esta sesión las escribió el mismo agente que redacta este informe. Para compensarlo, cada una se verificó con el método que descubrió el defecto —sondeo adversarial contra el servidor vivo— y no releyendo lo que se acababa de escribir. El sondeo previo a las correcciones falló 13 de 32 comprobaciones; el posterior pasó 22 de 22, incluyendo cinco guardas de que lo que ya funcionaba siga funcionando. Aun así, el hallazgo más grave de esta ronda (`CASH-MA-001`) había sobrevivido a dos auditorías previas: es un recordatorio de que ninguna de estas pasadas, incluida esta, agota el problema.
