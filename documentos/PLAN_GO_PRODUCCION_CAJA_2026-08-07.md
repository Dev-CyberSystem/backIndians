# Plan para llegar al `GO` de producción — Módulo de Caja

**Fecha:** 2026-08-07
**Origen:** cierra los bloqueantes de `VERIFICACION_FINAL_CAJA_PRODUCCION_2026-08-07.md`
**Ramas:** `auditoriacaja` en ambos repos (`backIndians` `916a486`, `frontIndians` `e839743`)
**Estado de partida:** las 5 correcciones de la verificación final están aplicadas y validadas, **sin commitear**

---

## Decisiones de negocio tomadas (2026-08-07)

Las tres decisiones que bloqueaban el `GO` están resueltas. Quedan asentadas acá y en `08-DECISIONS.md`:

| # | Decisión | Resolución | Efecto sobre el plan |
|---|---|---|---|
| D-1 | ¿El negocio necesita caja física por turnos? | **No aplica.** Indians es fábrica a pedido + tienda online, sin mostrador con cajeros por turno. Se declara formalmente fuera de alcance | Elimina el bloqueante #1. **El `GO` se evalúa contra el libro contable, no contra el pedido de caja por turnos** |
| D-2 | ¿La cobranza de facturas debe impactar caja? | **Sí, automatizar.** Se agrega medio de pago a los cobros y se conecta con el asiento | Convierte el bloqueante #2 en una tarea acotada (Fase 2) |
| D-3 | ¿Totales del período bruto o neto? | **Neto.** Se excluyen movimientos revertidos y contraasientos, coherente con `by_category` | Convierte el bloqueante #3 en una tarea chica (Fase 1) |
| D-4 | ¿Qué hacer con los cobros históricos? | **Borrarlos: son todos de prueba.** Ejecutado en desarrollo el 2026-08-07 | Elimina la pregunta de nulabilidad: `payment_method` puede ser `NOT NULL` sin inventar nada |
| D-5 | ¿Las facturas de fábrica cobradas en efectivo van a otra caja? | **No: todo va a la misma caja.** Se reusan `store_cash_account_id` / `store_bank_account_id` | Elimina las tareas 2.6 y 2.7 (settings nuevos) |
| D-6 | ¿Cómo netear: excluir filas o compensar por signo? | **Compensar por signo.** Un movimiento de $1.000 revertido en $400 tiene que quedar en $600, no desaparecer | Fija el SQL de la Fase 1 |

---

## Hallazgo que amplía el alcance de D-2

Al verificar el código para armar este plan apareció algo que la verificación final no había separado: **hay dos circuitos de cobranza de facturas, no uno**, y los dos tienen exactamente el mismo defecto.

| Circuito | Servicio | Tabla | Estado |
|---|---|---|---|
| Facturas de fábrica | `invoice.service.ts` → `addPaymentToInvoice` | `invoice_payments` | Sin medio de pago, sin caja, sin transacción, sin idempotencia |
| Facturas de catálogo | `catalog.service.ts` → `addPaymentToCatalogInvoice` | `catalog_invoice_payments` | **Idéntico** |

`addPaymentToCatalogInvoice` es una copia literal del otro (`create` → `findAll` → `reduce` → `update`, las cuatro operaciones fuera de transacción). **La Fase 2 tiene que cubrir los dos**, o quedaría una vía de cobranza sin asentar en caja — exactamente el problema que se busca cerrar.

Detalle adicional útil: las facturas de catálogo **ya se pueden cobrar por MercadoPago** (`handleMPWebhook` en `catalog.service.ts`), así que en ese circuito el medio de pago a veces se conoce sin que nadie lo cargue a mano.

---

## Fases

Ordenadas por dependencia. Las Fases 1-3 son código; la 4 es la verificación integral; la 5 es el despliegue.

---

### Fase 0 — Asentar D-1 y commitear lo ya hecho

**Por qué primero:** hay 9 archivos modificados sin commitear de la verificación final. Commitearlos antes de seguir deja un punto de retorno limpio y evita mezclar el trabajo de ayer con el de hoy en un solo commit ilegible.

| # | Tarea | Archivo | Criterio de cierre |
|---|---|---|---|
| 0.1 | Documentar D-1 como decisión formal: por qué el dominio de turnos no aplica, con la evidencia (fábrica a pedido, sin POS de mostrador, tres auditorías que lo señalaron) | `docs/project-brain/08-DECISIONS.md` | La decisión está escrita y fechada, para no volver a auditar contra un requisito inaplicable |
| 0.2 | Marcar en el informe de verificación que el bloqueante #1 quedó resuelto por decisión, no por implementación | `VERIFICACION_FINAL_CAJA_PRODUCCION_2026-08-07.md` | El informe no contradice a `08-DECISIONS.md` |
| 0.3 | Commit del trabajo de la verificación final (5 correcciones + 21 tests + script de diagnóstico + docs) | ambos repos | `git status` limpio, mensaje que referencia los IDs de hallazgo |

**Esfuerzo: S (medio día).** Sin riesgo de regresión: es documentación y un commit.

---

### Fase 1 — `CASH-RPT-002`: totales del período en neto

Cierra el bloqueante #3. Es la tarea más chica y la hago primero para sacarla del camino.

**Criterio fijado por D-6: compensar por signo**, el mismo que ya usa `by_category`. No se excluyen filas: el contraasiento resta contra su original. Es lo que da el resultado correcto en la reversión **parcial** — un movimiento de $1.000 revertido en $400 queda en $600; con exclusión de filas desaparecería entero y se perderían los $600 que siguen vigentes.

Concretamente, un contraasiento (`reversal_of_id IS NOT NULL`) **resta de la columna del signo contrario** en vez de sumar a la propia:

```sql
-- total_income
SUM(CASE WHEN type = 'income'  AND reversal_of_id IS NULL     THEN  amount
         WHEN type = 'expense' AND reversal_of_id IS NOT NULL THEN -amount
         ELSE 0 END)
-- total_expense: simétrico
```

| # | Tarea | Dónde | Detalle |
|---|---|---|---|
| 1.1 | Netear `total_income`/`total_expense` | `cash.service.ts` → `getSummary`, primera query | Con el `CASE` de arriba |
| 1.2 | Aplicar el mismo criterio a `daily_evolution` | `cash.service.ts` → `getSummary`, tercera query | Hoy tampoco netea: el gráfico de evolución diaria muestra los mismos picos falsos que los totales. **Si no se toca, el panel sigue contando dos historias, solo que en otro lugar** |
| 1.3 | Verificar que `by_category` ya cumple el criterio | `cash.service.ts` → `getSummary`, segunda query | Ya compensa por signo desde la corrección de `CASH-RPT-001`. Confirmar que las tres queries quedan con el mismo criterio, no solo dos |
| 1.4 | Rotular el criterio en la UI | `CashFlowPage.tsx` | Que se lea que "Ingresos del período" está neto de anulaciones |
| 1.5 | Tests | `cash-validation-reporting.test.ts` | (a) alta + reversión total → delta 0 en las tres series; (b) **alta de $1.000 + reversión parcial de $400 → los tres reportan $600**, que es el caso que distingue este criterio del otro |

**Esfuerzo: S (1 día).** Riesgo de regresión: bajo, acotado a `getSummary`.

---

### Fase 2 — `CASH-INV-001` + `CASH-INV-002`: conectar cobranzas con caja ✅ HECHA (2026-08-07)

Cierra el bloqueante #2. Es la fase más grande y la única que toca esquema.

**Resultado:** las 24 tareas de esta fase están implementadas y validadas. Migraciones `093`-`095` aplicadas en desarrollo. `cashSettingKeyFor`/`CashReversalOutcome` centralizados en `cash.service.ts` (2.6); `reverseAllForReference` (nueva) revierte TODOS los cobros de una factura al anularla, no solo el último. 13 tests nuevos en `invoice-collections-cash.test.ts`, 5 checks nuevos en `cash-integrity-check.ts` (CT-19 a CT-23). Suite completa: **287/287, 44 suites** (era 274 al terminar la Fase 1). Reglas documentadas: `BR-CASH-013`/`014`/`015` en `03-BUSINESS-RULES.md`, decisiones `DEC-012` en `08-DECISIONS.md`.

**Ajuste sobre el plan original:** la tarea 2.7 (renombrar el concepto en la UI) se resolvió con un cambio de texto —subtítulo y nota aclaratoria en `EcommerceSettingsPage.tsx`— en vez de mover la sección de pantalla, porque el setting vive en un solo lugar y moverlo hubiera sido más disruptivo que aclarar in situ que ahora es compartido.

#### 2.a — Medio de pago en los cobros (migración)

**D-4 ya está ejecutada.** Los cobros existentes se borraron de la base de desarrollo el 2026-08-07: eran 8 filas en `invoice_payments`, **todas artefactos de `factory-invoices.test.ts`** (cada corrida de la suite agregaba dos), y `catalog_invoice_payments` ya estaba vacía. Se borraron junto con el estado que dejaron en la factura — las 4 facturas que estaban en `paid` volvieron a `issued` con `payment_amount = 0`, porque borrar el cobro y dejar la factura afirmando que se cobró habría creado justo el tipo de huérfano que el diagnóstico busca.

**Consecuencia: no hay estrategia de datos históricos que definir.** La columna se crea `NOT NULL` sin default significativo y sin backfill que inventar.

| # | Tarea | Detalle |
|---|---|---|
| 2.1 | Migración `093`: `payment_method` en `invoice_payments` | `ENUM('cash','bank_transfer','mercadopago')`, `allowNull: false`. **Mismo vocabulario que `store_orders.payment_method`** (migración `041`) para no inventar un segundo diccionario de medios en el mismo sistema |
| 2.2 | Migración `094`: ídem en `catalog_invoice_payments` | Igual. Se puede unificar con la `093` en una sola migración |
| 2.3 | Replicar ambas columnas en `ensureSchema.ts` | **Obligatorio por `CLAUDE.md`**: si `ensureSchema` no lo replica, desarrollo y producción divergen en silencio |
| 2.4 | Actualizar modelos `InvoicePayment` y `CatalogInvoicePayment` | Con el `declare payment_method` correspondiente |
| 2.5 | Verificar en producción que tampoco hay cobros reales | El usuario ya confirmó el 2026-08-07 que producción también tiene solo datos de prueba. **Confirmarlo por consulta antes de migrar** (`SELECT COUNT(*) FROM invoice_payments`), no por memoria: si hubiera filas, `NOT NULL` sin default falla al aplicar la migración |

#### 2.b — Cuentas destino

**D-5: todo va a la misma caja.** Se reusan `store_cash_account_id` y `store_bank_account_id` — no hay settings nuevos y no hay migración de configuración.

| # | Tarea | Detalle |
|---|---|---|
| 2.6 | Extraer el mapeo medio→setting a un lugar compartido | Hoy `cashSettingKeyFor` vive dentro de `store.service.ts` y es privada. Sacarla a `cash.service.ts` (o a un helper) para que la use también el circuito de cobranzas, **en vez de copiarla** — es exactamente la duplicación que ya castigó al proyecto con `STORE_ORDER_TRANSITIONS` |
| 2.7 | Renombrar el concepto en la UI de configuración | Los settings siguen llamándose `store_*` por compatibilidad, pero ahora reciben plata de dos orígenes. **En la pantalla de configuración deben leerse como "Cuenta de efectivo" / "Cuenta bancaria" a secas**, sin "tienda", o el admin va a creer que las cobranzas de fábrica van a otro lado |

#### 2.c — Conexión y robustez

| # | Tarea | Detalle |
|---|---|---|
| 2.8 | Envolver `addPaymentToInvoice` en `sequelize.transaction` con `LOCK.UPDATE` sobre la factura | Cierra la carrera de `CASH-INV-002`: hoy dos cobranzas concurrentes pueden dejar `payment_amount` subvaluado y la factura sin pasar a `paid` |
| 2.9 | Ídem en `addPaymentToCatalogInvoice` | Mismo defecto, mismo arreglo |
| 2.10 | Agregar `idempotency_key` a ambos cobros | Con índice único. Mismo patrón que `cash_transactions` (migración `091`) — **incluida la nota de no declarar `unique: true` en el modelo**, para no generar índices duplicados bajo `sync()` |
| 2.11 | Llamar a `createSystemTransaction` desde ambos servicios, dentro de la misma transacción | Reusa el mapeo medio→cuenta de 2.6. **Nada de lógica nueva de caja**: el asiento se crea con el mismo servicio que ya usa la tienda |
| 2.12 | Aplicar el principio de `BR-CASH-008` | Si la cuenta no está configurada o está inactiva, **loguear un warning y seguir** — nunca bloquear el registro de una cobranza ya cobrada. Mismo criterio que `recordStoreOrderIncome` |
| 2.13 | Marca de idempotencia del asiento | Columna `cash_recorded_at` en ambas tablas de cobros, análoga a la de `store_orders`, para que un reintento no duplique el movimiento |
| 2.14 | Categoría de sistema para cobranzas | Migración que siembre `Cobranzas de facturas` con `is_system: true`, igual que `Ventas tienda online` (migración `085`) |
| 2.15 | Reversión al anular una factura | Si se anula una factura con cobros asentados, revertir vía `reverseSystemTransaction`. **Verificar primero si el flujo de anulación de facturas existe** — si no existe, se documenta como pendiente en vez de inventarlo |

#### 2.d — Frontend

| # | Tarea | Dónde |
|---|---|---|
| 2.16 | Selector de medio de pago en el modal de cobro | `InvoiceDetailPage.tsx` y `CatalogOrdersPage.tsx` |
| 2.17 | Enviar `payment_method` e `Idempotency-Key` | `api/invoices.ts`, `api/catalog.ts` — hoy `addPayment` solo manda `amount` y `notes` |
| 2.18 | Mostrar el medio en el historial de cobros | Ambas pantallas |

#### 2.e — Tests

| # | Tarea |
|---|---|
| 2.19 | Cobro en efectivo → asiento en la cuenta `cash`; cobro por transferencia/MP → asiento en la cuenta `bank` |
| 2.20 | Dos cobranzas concurrentes dejan `payment_amount` correcto y la factura en `paid` (test que **falla antes** del arreglo) |
| 2.21 | Doble clic con la misma clave de idempotencia no duplica cobro ni asiento |
| 2.22 | Cuenta sin configurar: el cobro se registra igual, con warning (guarda de `BR-CASH-008`) |
| 2.23 | Los tres primeros, repetidos para el circuito de catálogo |
| 2.24 | Nuevos checks en `cash-integrity-check.ts`: cobro con `cash_recorded_at` sin asiento, y factura con doble asiento |

**Esfuerzo: L (4-6 días).** Riesgo de regresión: **medio** — toca dos flujos de cobranza en producción y el esquema. Es la fase que más test necesita.

---

### Fase 3 — Cierre de calidad

Las tres puertas que quedaron sin cerrar en la verificación final.

| # | Tarea | Detalle | Bloqueante |
|---|---|---|---|
| 3.1 | **Verificar en navegador el cambio de UI de la verificación final** (R-07) | Abrir `/cash`, ver el detalle de un movimiento revertido y de un contraasiento: debe aparecer el texto explicativo en vez del formulario. Verificar que el selector de categoría filtra por tipo | **Sí** — es la única puerta de calidad del trabajo ya hecho que sigue abierta |
| 3.2 | **E2E de caja** (R-09) | `e2e/tests/cash.spec.ts`: alta → detalle → reversión → verificación del saldo → intento de editar un revertido. Es el recorrido que el pedido exige y hoy no existe | **Sí** |
| 3.3 | **E2E de cobranza** | Cobrar una factura en efectivo y ver el movimiento aparecer en `/cash`. Es la prueba de que la Fase 2 funciona de punta a punta | **Sí** (depende de Fase 2) |
| 3.4 | `npm audit` en ambos repos (R-06) | Separar runtime de desarrollo, descartar falsos positivos | Sí, si aparece algo crítico en runtime |
| 3.5 | Pantalla de auditoría (R-08) | `getAuditEvents` en `api/cash.ts` + pestaña "Auditoría" en `CashFlowPage`, solo `admin`. Hoy el control existe pero **nadie lo ve desde el panel** | **No** — no es defecto de integridad, pero sin esto el rastro de `CASH-MA-001` solo se lee por `curl` |
| 3.6 | Migración correctiva del `down()` de la `091` (R-10) | Nueva migración que borre la FK antes que el índice. **No editar la `091`**, ya está aplicada | **No** — pero mientras no esté, el único rollback de esquema es restaurar el backup |

**Esfuerzo: M (3-4 días).** Sin riesgo de regresión: es verificación y aditivo.

---

### Fase 4 — Re-verificación integral

**Todas** las puertas de calidad, no solo las que se tocaron.

| # | Puerta | Criterio |
|---|---|---|
| 4.1 | `typecheck` backend (`tsconfig.json` y `tsconfig.seed.json`) y frontend | Limpio |
| 4.2 | `build` en ambos repos | Limpio |
| 4.3 | `npm run test:full` | **Todo en verde.** Referencia actual: 270/270 en 43 suites |
| 4.4 | `lint` frontend | Sin errores nuevos sobre la línea de base (171 preexistentes) |
| 4.5 | Sondeo adversarial completo | Re-correr `probe2.mjs` ampliado con los casos de la Fase 2. **22/22 actuales + los nuevos** |
| 4.6 | `scripts/cash-integrity-check.ts` | Sin anomalías bloqueantes, todas las cuentas cuadran con su libro |
| 4.7 | E2E Playwright | Los specs de 3.2 y 3.3 en verde |
| 4.8 | Reset real de base + migraciones desde cero | `db:drop` + `db:create` + `db:migrate` + `seed:test`. **Valida el camino real de despliegue**, no el `sync()` del día a día |
| 4.9 | Caso contable ARS 155.000 | Re-verificado en cuenta limpia |
| 4.10 | Regresión de los módulos conectados | Ventas, facturación, pagos, stock, devoluciones, reportes, permisos |

> **Regla que se violó tres veces en este proyecto y no se puede volver a violar:** nunca editar `src/` mientras corre la suite de tests. Produjo mediciones inválidas en tres sesiones distintas, la última ayer.

**Esfuerzo: S (1 día).**

---

### Fase 5 — Despliegue

Ejecutar el plan de la **sección L** del informe de verificación, con estos agregados propios de la Fase 2:

| # | Agregado sobre el plan original |
|---|---|
| 5.0 | **Precheck bloqueante:** `SELECT COUNT(*) FROM invoice_payments` y `FROM catalog_invoice_payments` en producción. Si hay filas, decidir antes de migrar: borrarlas (como en desarrollo) o cambiar la migración. **No aplicar la migración a ciegas** |
| 5.1 | Los prechecks incluyen verificar que `store_cash_account_id` y `store_bank_account_id` estén configurados — ahora reciben plata de dos orígenes (tienda **y** cobranzas). Sin eso, las cobranzas se registran pero no se asientan: no rompe nada, pero deja conciliación acumulada |
| 5.2 | El smoke test incluye **cobrar una factura de prueba en efectivo** y verificar que el movimiento aparece en `/cash` |
| 5.3 | El monitoreo incluye los warnings nuevos de cuenta sin configurar en el circuito de cobranzas |
| 5.4 | Si la Fase 3.6 no se hizo, **el rollback sigue dependiendo del backup**: dejarlo explícito en el runbook, no descubrirlo el día del incidente |

**Esfuerzo: S (medio día + ventana de despliegue).**

---

## Criterios de `GO` — cómo se evalúa el resultado

Con D-1 tomada, **el `GO` se evalúa contra el libro contable, no contra la caja por turnos.** Los criterios de la sección 13 del pedido que dependen de turnos (`no puede abrirse más de un turno activo`, `venta sin turno`, `distribución que no coincide con lo contado`, `traspaso no trazable`) pasan a `NO APLICA` por decisión documentada, no por omisión.

Los que sí aplican, y su estado proyectado al terminar el plan:

| Criterio | Hoy | Al terminar |
|---|---|---|
| Sin hallazgos críticos ni altos abiertos | ❌ `CASH-INV-001` alto | ✅ Fase 2 |
| Una venta/cobranza/reintento no duplica caja ni stock | ⚠️ cobranzas sin idempotencia | ✅ Fase 2 |
| Los medios no efectivos no alteran el cajón físico | ✅ tienda / ❌ facturas | ✅ Fase 2 |
| El cálculo no depende del frontend | ✅ | ✅ |
| Sin pérdida de precisión monetaria | ✅ | ✅ |
| Los movimientos financieros no se editan ni borran | ✅ | ✅ |
| Los permisos no son solo de frontend | ✅ | ✅ |
| Migraciones verificadas de forma segura | ✅ | ✅ Fase 4.8 |
| Typecheck, build y suite crítica en verde | ✅ | ✅ Fase 4 |
| Flujos E2E principales comprobados | ❌ no existen | ✅ Fase 3 |
| Rollback viable | ⚠️ solo por backup | ✅ (o documentado, Fase 3.6) |
| Reportes internamente consistentes | ❌ `CASH-RPT-002` | ✅ Fase 1 |

**Riesgos residuales aceptados al declarar `GO`** (documentados, sin comprometer dinero ni integridad):
- Sin separación de funciones ni aprobación por umbral — consecuencia directa de D-1, no hay retiros de turno que aprobar.
- Sin exportación de reportes de caja — nunca existió, no es regresión, no hay pedido de negocio.
- Los intentos denegados (403) quedan en el log de Pino, no en la auditoría de dominio.
- El patrón de mass assignment sigue vivo fuera de caja (`client`, `master`, `product`, `stock`) — **fuera del alcance de caja, pero es el mismo agujero que resultó crítico acá**. Debería auditarse por separado, y conviene decidir si eso entra antes o después del `GO`.

---

## Resumen de esfuerzo

| Fase | Contenido | Esfuerzo | Bloquea el `GO` |
|---|---|---|---|
| 0 | Asentar D-1, commitear lo hecho | S — medio día | Sí (higiene) |
| 1 | Totales en neto | S — 1 día | Sí |
| 2 | Cobranzas → caja (×2 circuitos) + concurrencia | **L — 4-6 días** | Sí |
| 3 | Navegador, E2E, audit, pantalla de auditoría | M — 3-4 días | Parcial |
| 4 | Re-verificación integral | S — 1 día | Sí |
| 5 | Despliegue | S — medio día | — |

**Total: ~10-13 días de trabajo efectivo.** El camino crítico es la Fase 2.

**Se puede acortar a ~5-6 días** dejando fuera del `GO` inicial las tareas 3.5 (pantalla de auditoría) y 3.6 (rollback de la `091`), que no son defectos de integridad. **No se puede acortar** salteando 3.1, 3.2 y 3.3: sin verificación en navegador ni E2E, el `GO` sería exactamente lo que el pedido prohíbe — declarar listo lo que no se probó.

---

## Sin decisiones pendientes

Las seis decisiones de negocio (D-1 a D-6) están tomadas y asentadas arriba. **El plan es ejecutable de punta a punta sin más consultas.**

Lo único que queda por confirmar es un dato, no una decisión: **que producción efectivamente no tenga cobros reales** (tarea 2.5), por consulta directa antes de migrar. Si los hubiera, la migración `NOT NULL` sin default falla al aplicarse — es preferible que falle ahí, ruidosamente, antes que aplicar un default que afirme algo falso sobre plata real.

### Lo que se ejecutó al tomar estas decisiones

| Acción | Alcance | Resultado |
|---|---|---|
| Borrado de cobros de prueba (D-4) | **Solo desarrollo** (`textil_db`) | 8 `invoice_payments` eliminados; 4 facturas de `paid` → `issued` con `payment_amount = 0`; `catalog_invoice_payments` ya estaba vacía |

**No se tocó producción** — está fuera de lo autorizado y la limpieza equivalente allá es un paso del despliegue (Fase 5), no de esta sesión. El script de limpieza fue de un solo uso y no quedó en el repo; el único script que persiste es `cash-integrity-check.ts`.
