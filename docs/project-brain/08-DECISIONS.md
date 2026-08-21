# 08 — Registro de decisiones técnicas y funcionales

> Solo decisiones con evidencia verificable (commit, comentario en código, o documento de auditoría existente). Fecha aproximada tomada de la fecha del commit/migración cuando no hay una explícita.

## DEC-001 — Dos sistemas de JWT independientes (sistema vs. tienda)
**Fecha aprox.**: previa a la auditoría de 2026-08, refinada el 2026-06/07.
**Decisión**: usar secretos, payloads y middlewares de autenticación completamente separados para staff (`User`) y compradores (`StoreCustomer`), con un campo `type: 'store_customer'` en el payload de tienda como defensa adicional.
**Motivo**: evitar que un token de un sistema autentique accidentalmente en el otro, incluso si por error de configuración los secretos coincidieran.
**Alternativas descartadas**: no documentadas explícitamente en el código; se infiere que la alternativa obvia (un solo JWT con roles extendidos) se descartó por el riesgo de "confusión de tokens" que el propio comentario del código menciona.
**Consecuencias**: doble mantenimiento de lógica de auth, pero aislamiento real entre poblaciones de usuario.
**Estado**: Vigente.

## DEC-002 — `session_version` como mecanismo de revocación, sin blacklist de tokens
**Fecha aprox.**: 2026-06-02 (migración `017-add-session-version.js`).
**Decisión**: revocar sesiones incrementando un contador comparado en cada request, en vez de mantener una blacklist de tokens (ej. en Redis).
**Motivo**: el propio código de `logout` documenta la alternativa descartada explícitamente: *"En producción se podría implementar una blacklist de tokens con Redis"* — no se hizo, se prefirió el mecanismo más simple.
**Consecuencias**: revocación no es instantánea a nivel de token individual, es todo-o-nada por usuario; no requiere infraestructura adicional (Redis).
**Estado**: Vigente.

## DEC-003 — Migraciones + `sync()` + `ensureSchema` + `dedupeIndexes`, en vez de solo migraciones
**Fecha aprox.**: evolución continua desde el inicio del proyecto (mayo 2026) hasta 2026-07-24 (`ensureSchema.ts` amplía cobertura).
**Decisión**: convivencia de `sequelize.sync()` en desarrollo (para no exigir migrar constantemente en local) con migraciones formales para producción, más una capa de parches idempotentes (`ensureSchema.ts`) para lo que `sync()` sin `alter` no cubre, y una deduplicación de índices (`dedupeIndexes.ts`) para no chocar con el límite de 64 índices de MySQL.
**Motivo**: documentado en comentarios del propio código — velocidad de desarrollo local sin sacrificar control de esquema en producción.
**Consecuencias**: mantenimiento doble para un subconjunto de cambios de esquema (ver inconsistencia #4 en [05-DATABASE.md](05-DATABASE.md)).
**Estado**: Vigente.

## DEC-004 — Cola de emails en proceso, no Redis/Bull
**Fecha aprox.**: no determinable con precisión, previa a la auditoría de tienda.
**Decisión**: encolar envío de emails con `setImmediate` + reintentos en memoria del propio proceso Node, en vez de una cola persistente externa.
**Motivo**: comentario explícito en `emailQueue.ts`: *"El proyecto no tiene un sistema de colas (Redis/Bull), así que resolvemos el requisito en proceso"*.
**Consecuencias**: un reinicio del servidor pierde emails en vuelo; aceptable para el volumen actual, documentado como limitación consciente.
**Estado**: Vigente — candidato a revisar si el volumen de envíos crece.

## DEC-005 — Comprobante de tienda ≠ factura fiscal (rename explícito)
**Fecha aprox.**: 2026-08-04 (commits `35ae47d` backend, `0819968` frontend).
**Decisión**: renombrar en código y UI "factura" por "comprobante de compra" para los pedidos de tienda que no pasaron por AFIP.
**Motivo**: hallazgo crítico C-4 de la auditoría (`AUDITORIA_TIENDA_ONLINE_DIAGNOSTICO.md`) — el PDF generado sin CAE se llamaba "factura", lo cual podía inducir a error legal/comercial a los compradores.
**Consecuencias**: mayor claridad legal; sigue existiendo el envío manual a AFIP como camino para obtener una factura fiscal real (ver [BR-INVOICE-002](03-BUSINESS-RULES.md)).
**Estado**: Vigente.

## DEC-006 — Envío a AFIP siempre manual, nunca automático al pagar/facturar
**Fecha aprox.**: 2026-08-04 (sección 2.5 de la auditoría de avance).
**Decisión**: ningún flujo de pago o facturación dispara automáticamente el envío a AFIP; requiere acción explícita de un usuario `admin`/`billing`.
**Motivo**: decisión de negocio (permite revisar/corregir datos fiscales antes de emitir un comprobante irreversible con CAE).
**Consecuencias**: mayor control humano; mayor esfuerzo operativo (no hay automatización de facturación fiscal).
**Estado**: Vigente.

## DEC-007 — `garment_types.name` único por cliente, no global
**Fecha aprox.**: 2026-07-24 (migraciones 064/065, commits `c452f22`/`4c8e336`).
**Decisión**: pasar de un unique global sobre `name` a un unique compuesto `(client_id, name)`.
**Motivo**: al introducir tipos de prenda por cliente, el unique global impedía que dos clientes distintos tuvieran un tipo de prenda con el mismo nombre — bug funcional detectado y corregido.
**Alternativas descartadas**: mantener el unique global y forzar nombres distintos por cliente (descartado por mala UX).
**Estado**: Vigente.

## DEC-008 — Devoluciones de tienda siempre con revisión manual
**Fecha aprox.**: 2026-08-04 (commit `4d04d70`, tarea 2.4).
**Decisión**: ninguna devolución se resuelve automáticamente; siempre nace `pending_review` y requiere que `admin`/`billing` decida condición de cada ítem antes de restituir stock o dinero.
**Motivo**: decisión de negocio (evitar reintegros/restituciones erróneas sin control humano).
**Estado**: Vigente.

## DEC-009 — Tienda solo opera en ARS, sin multi-moneda
**Fecha aprox.**: no determinable con precisión (decisión de diseño desde el inicio del módulo tienda).
**Decisión**: moneda fija ARS, hardcodeada tanto en la UI como en la creación de preferencias de MercadoPago.
**Motivo**: documentado explícitamente en comentario de `store.service.ts`; el negocio opera únicamente en Argentina.
**Estado**: Vigente.

## DEC-010 — Andreani pospuesto a research spike, no se implementa a ciegas
**Fecha aprox.**: 2026-08-04 (auditoría de avance, tarea 2.6).
**Decisión**: no comprometerse a una implementación de integración con Andreani sin antes investigar su API (cotización, etiqueta, tracking, credenciales).
**Motivo**: evitar diseñar sobre supuestos no verificados de una API externa no explorada.
**Estado**: Vigente — pendiente de iniciar el spike.

## DEC-011 — La caja de Indians es un libro contable, NO una caja de mostrador por turnos
**Fecha**: 2026-08-07 (decisión explícita del usuario, tras la verificación final de producción).
**Decisión**: el módulo de caja **no** implementa apertura de turno, conteo físico por denominaciones, arqueo ciego, reconteo, diferencia con aprobación por umbral, distribución del efectivo contado ni entrega/recepción de fondo entre turnos. Es y seguirá siendo un **libro contable** de cuentas, categorías y movimientos, con auditoría inmutable y corrección exclusivamente por contraasiento.

**Motivo**: Indians es una **fábrica de indumentaria a pedido + tienda online**. No hay punto de venta de mostrador operado por cajeros en turnos rotativos, que es el modelo de negocio que exige ese flujo. Tres auditorías sucesivas (`AUDITORIA_FLUJO_CAJA_2026-08-06.md`, `..._VERIFICACION_2026-08-07.md`, `VERIFICACION_FINAL_CAJA_PRODUCCION_2026-08-07.md`) confirmaron por búsqueda exhaustiva que el dominio no existe en el código, y las tres señalaron que la ausencia es coherente con el negocio, no un olvido.

**Alternativas descartadas**: construir el módulo completo (~4-6 semanas: tablas de turno/jornada/conteo, arqueo ciego, aprobaciones, traspaso, pantallas) o una versión mínima de apertura/cierre (~1-2 semanas). Ambas descartadas por no responder a una necesidad real del negocio.

**Consecuencias**:
- Los criterios de aceptación que dependen de turnos (`no puede abrirse más de un turno activo`, `no se puede vender sin turno`, `la distribución debe coincidir con lo contado`, `el traspaso entre turnos debe ser trazable`) pasan a **`NO APLICA` por decisión documentada**, no por omisión. **No volver a auditar el módulo contra ellos.**
- Se acepta conscientemente que **no hay separación de funciones ni aprobación por umbral** en caja: son controles propios del flujo de turnos y no tienen objeto sin él (no hay retiros de turno que aprobar ni diferencias de arqueo que autorizar).
- El `GO` de producción del módulo se evalúa contra el libro contable, según los criterios de `PLAN_GO_PRODUCCION_CAJA_2026-08-07.md`.

**Cómo se revierte**: si el negocio abre un local con mostrador y cajeros por turno, esta decisión queda obsoleta y hay que registrar una decisión nueva que la reemplace (no editar esta). El punto de partida sería el diseño esbozado en la sección L de la auditoría original.
**Estado**: Vigente.

## DEC-012 — La cobranza de facturas impacta caja automáticamente, en las mismas cuentas que la tienda
**Fecha**: 2026-08-07 (decisión explícita del usuario, junto con [DEC-011](#dec-011)).
**Decisión**: cobrar una factura (de fábrica o de catálogo) genera automáticamente el asiento de caja, con el medio de pago cargado en el cobro. **El dinero va a las mismas cuentas que ya usa la tienda** (`store_cash_account_id` para efectivo, `store_bank_account_id` para transferencia y MercadoPago): no hay cajas separadas por origen del ingreso.

**Motivo**: hasta hoy la cobranza no tocaba caja en absoluto (`invoice.service.ts` y `catalog.service.ts` sin una sola referencia), así que la conciliación dependía de que el operador recordara cargar un segundo movimiento a mano. Hallazgo `CASH-INV-001` de la verificación final, marcado como bloqueante de producción.

**Consecuencias**:
- `invoice_payments` y `catalog_invoice_payments` necesitan `payment_method` (migración) — hasta ahora **no había ningún dato con el que decidir a qué cuenta va la plata**.
- El mapeo medio→cuenta (`cashSettingKeyFor`) deja de ser privado de `store.service.ts` y pasa a compartirse. **No duplicarlo**: es exactamente el error que ya arrastra `STORE_ORDER_TRANSITIONS`.
- Los settings siguen llamándose `store_*` por compatibilidad pero ya no son solo de la tienda: **la UI de configuración debe leerse sin la palabra "tienda"**, o el admin va a creer que las cobranzas de fábrica van a otro lado.
- Aplica [BR-CASH-008](03-BUSINESS-RULES.md): si la cuenta no está configurada o está inactiva, se loguea y se sigue. **Una regla contable interna nunca puede vetar el registro de una cobranza ya cobrada.**
**Estado**: Vigente — implementada y verificada (Fase 2 de `PLAN_GO_PRODUCCION_CAJA_2026-08-07.md`, commits `882fd23`/`67b7bb7`). Pendiente de desplegar a producción.

## DEC-013 — Los totales del resumen de caja son NETOS de anulaciones, compensando por signo
**Fecha**: 2026-08-07 (decisión explícita del usuario, junto con [DEC-011](#dec-011)).
**Decisión**: `total_income`, `total_expense`, `daily_evolution` y `by_category` reportan **neto de reversiones**. El neteo se hace **compensando por signo** (el contraasiento resta de la columna del signo contrario), **no excluyendo filas**.

**Motivo**: el resumen contaba dos historias a la vez — `by_category` ya neteaba desde la corrección de `CASH-RPT-001`, pero los totales del período no, así que un ingreso de $5.000 revertido sumaba +$5.000 a ingresos y +$5.000 a egresos. Hallazgo `CASH-RPT-002`.

**Alternativa descartada**: excluir con `WHERE status <> 'reversed' AND reversal_of_id IS NULL`. Da el mismo resultado en una reversión total **pero es incorrecta en la parcial**: un movimiento de $1.000 revertido en $400 desaparecería entero del reporte, perdiendo los $600 que siguen vigentes. Compensar por signo lo deja correctamente en $600.

**Consecuencias**: el panel muestra plata efectivamente movida, no bruto contable. Debe rotularse así en la UI. El test que fija la regla es el de reversión parcial — el de reversión total pasa con ambos criterios y no distingue nada.
**Estado**: Vigente — implementada y verificada (Fase 1 de `PLAN_GO_PRODUCCION_CAJA_2026-08-07.md`, commits `b856f92`/`2d41a67`). Pendiente de desplegar a producción.

## DEC-014 — Incidente: producción caída >1 día por `MP_WEBHOOK_SECRET`, resuelta como medida de emergencia temporal

**Fecha**: 2026-08-07, detectado al iniciar la Fase 5 (despliegue de caja) — **sin relación con el trabajo de caja**, incidente preexistente.

**Qué pasó**: `validateEnv()` en `server.ts` exige `MP_WEBHOOK_SECRET` en producción y hace `process.exit(1)` si falta. Esa variable nunca se configuró en Railway tras activarse el chequeo, y el backend de producción quedó en crash-loop desde `2026-08-06T17:53` — **más de un día caído** sin que nadie lo detectara hasta este momento. Al intentar redesplegar, apareció un SEGUNDO problema independiente: el build fallaba con `tsc: not found`, porque Railway tiene `NODE_ENV=production` y `npm ci` se salta las devDependencies (incluido `typescript`) necesarias para compilar.

**Decisión y resolución** (autorizada explícitamente por el usuario ante las dos preguntas planteadas):
1. `server.ts`: el chequeo de `MP_WEBHOOK_SECRET` en producción se bajó de fatal (`process.exit(1)`) a warning (`logger.error` sin salir). **No abre ningún agujero de seguridad**: `verifyWebhookSignature()` en `mercadopago.service.ts` ya rechaza (fail-closed) cualquier webhook de MercadoPago sin el secreto configurado, en tiempo de ejecución, independientemente de este chequeo de arranque. Efecto real: el servicio arranca y sirve todo con normalidad; los webhooks de MP no se acreditan solos hasta configurar el secreto real. Commit `1de899d` en `master` (rama de hotfix aislada, sin mezclar con los 14 commits de caja que seguían en `auditoriacaja`).
2. Railway: variable `NPM_CONFIG_PRODUCTION=false` agregada al servicio `backIndians` para que `npm ci` instale devDependencies durante el build — es el fix estándar documentado de Railway/Nixpacks para este escenario, no específico de este proyecto.

**Verificado**: `railway status` → `● Online`; `curl` a `/health` y a un endpoint real de la API → `200`; logs de arranque muestran el warning esperado (no el crash) y conexión a MySQL exitosa.

**Esto es una medida de emergencia, NO un estado final. Pendiente**:
- Configurar `MP_WEBHOOK_SECRET` real en Railway (el mismo valor que figura en la configuración del webhook del lado de MercadoPago) — sin esto, los pagos de MercadoPago no se acreditan solos, dependen de conciliación manual.
- Una vez configurado, volver a subir el chequeo de `server.ts` a fatal (revertir el commit `1de899d` o equivalente) — la rebaja a warning no debe quedar como comportamiento permanente.
- Confirmar si `NPM_CONFIG_PRODUCTION=false` debe quedar permanente (es inocuo y es el patrón estándar para backends TypeScript en Railway) o si se prefiere una alternativa (ej. mover `typescript` a `dependencies`, menos robusto porque no cubre otros `@types/*` que también hacen falta en el build).

**Estado**: ✅ **CERRADA el 2026-08-19.**

**Cierre** (12 días después de la medida de emergencia):
1. `MP_WEBHOOK_SECRET` cargado en Railway. Verificado sobre el arranque del `2026-08-19 18:02 GMT-3` (deployment `819ae6c2`, el proceso que estaba sirviendo): los logs **no** contienen `startup.envValidation.temporary`, la línea que sólo se emite cuando la variable falta.
2. El chequeo de `server.ts` volvió a ser fatal, junto con `BACKEND_PUBLIC_URL`, y se borró el bloque de medida temporal.
3. Se agregó `webhook_secret` (booleano, **nunca el valor**) a `/health`, y `npm run prod` lo reporta.

**Por qué el punto 3 es parte del cierre y no un extra.** Lo que mantuvo esto abierto doce días no fue la dificultad de cargar una variable: fue que **no había forma de saber desde afuera si estaba cargada**. `verifyWebhookSignature` devuelve `false` tanto si falta el secreto como si la firma es inválida —correcto por seguridad, inútil para diagnosticar—, así que la única evidencia era buscar la *ausencia* de una línea en los logs de Railway. Una ausencia sólo prueba algo si sabés que la verías. Sin un indicador positivo, nadie podía flipear el chequeo a fatal con confianza, y el riesgo de equivocarse era repetir el crash-loop del 06/08. El indicador es lo que rompe ese empate.

**`NPM_CONFIG_PRODUCTION=false` queda permanente** en Railway: es el patrón estándar de Nixpacks para backends TypeScript y cubre también los `@types/*` que hacen falta en el build.

**Regla que deja este incidente**: antes de volver fatal cualquier chequeo de arranque, tiene que existir una forma de verificar —desde afuera y sin leer logs— que la condición se cumple en el proceso que corre.

## DEC-015 — El pago en efectivo de la tienda online queda desactivado (temporal), y el camino de código se conserva

**Fecha**: 2026-08-19 (decisión del dueño, confirmada explícitamente).

**Decisión**: `POST /store/checkout` deja de aceptar `payment_method: 'cash'` (validador en `src/routes/store.routes.ts`). La desactivación es **temporal**, así que el manejo de `'cash'` se conserva vivo: en el ENUM de `store_orders`, en `store.service.ts` (`cashSettingKeyFor`, `recordStoreOrderIncome`), en el job de expiración, y en el tipo `PaymentMethod` del frontend.

**Motivo**: decisión comercial. Con MercadoPago y transferencia alcanza para operar, y el efectivo obliga a un circuito presencial que hoy no se quiere sostener.

**Consecuencias**:
- Los pedidos **históricos** en efectivo tienen que seguir funcionando: se muestran en el panel y en el seguimiento, su asiento sigue yendo a `store_cash_account_id` (nunca a la cuenta bancaria) y siguen sin expirar automáticamente. Los tests que cubren esas dos reglas arman el pedido como lo que hoy es en la realidad —uno histórico: entra por el checkout con un método aceptado y se le fija `payment_method = 'cash'` en la fila.
- **El cambio de contrato dejó 17 suites de test atrás** (59 tests en rojo, con el commit responsable ya corriendo en producción). El contrato ahora está fijado por `src/__tests__/api/store-payment-methods.test.ts`, que espera `422` para `'cash'`.
- **Para reactivarlo hay que tocar los dos lados**: primero el validador del backend, después `PAYMENT_OPTIONS` en `StoreCheckoutPage.tsx`, y actualizar ese test en el mismo cambio. Está comentado en el propio archivo del frontend. Sólo el frontend → el comprador recibe 422; sólo el backend → la opción no se ofrece.
- Con el efectivo afuera quedan **dos** medios de pago, y por eso B-02 (transferencia sin datos bancarios) pasó de molesto a bloqueante — ver [DEC-016](#dec-016).

**Estado**: Vigente.

## DEC-016 — La transferencia bancaria se rechaza en el backend si no hay CBU ni alias configurados

**Fecha**: 2026-08-19 (hallazgo B-02, auditoría del 2026-08-19).

**Decisión**: `createStoreOrder` rechaza con `400` un checkout con `payment_method: 'bank_transfer'` cuando no hay CBU **ni** alias cargados en Settings. El predicado `hasBankTransferConfigured` se exporta desde `store.service.ts` y el frontend usa **el mismo criterio** para decidir si ofrece el medio de pago.

**Motivo**: en producción las tres claves bancarias estaban vacías y el checkout ofrecía la transferencia igual. El comprador creaba el pedido, **se le reservaba stock**, y aterrizaba en una pantalla que le mostraba un mensaje dirigido al administrador. Con el efectivo desactivado ([DEC-015](#dec-015)) era uno de los dos únicos medios de pago.

**Criterio**: alcanza con CBU **o** alias. El titular solo no sirve — no se puede transferir a un nombre.

**Alternativa descartada**: resolverlo sólo en el frontend ocultando la opción. Es la misma lección de AUD-01: una defensa que vive únicamente en el cliente no es una defensa. La validación va además **antes** de calcular totales, para no reservar stock de un pedido que se va a rechazar.

**Consecuencias**:
- Los dos predicados (back y front) **tienen que quedar iguales**. Si se separan, el frontend ofrece algo que el backend rechaza y el comprador se entera recién al confirmar. Está comentado en ambos archivos.
- Si esto deja **cero** medios de pago, la tienda muestra un aviso explícito y deshabilita el botón de confirmar, en vez de dejar completar un checkout que va a fallar.
- El entorno de tests necesita datos bancarios para poder crear pedidos: los siembra `src/__tests__/setup.ts` (`setupFilesAfterEnv`), no el seeder, para que `npx jest` corra contra la base de desarrollo tal como esté.

**Estado**: Vigente.

## DEC-017 — `db:query` pasa a `db:exec`, con confirmación explícita para lo destructivo

**Fecha**: 2026-08-19 (hallazgo R-05, auditoría del 2026-08-19; decisión del usuario entre dos opciones).

**Decisión**: `scripts/release/db-query.mjs` se renombra a `db-exec.mjs` (`npm run db:exec`), se corrige su encabezado, y **exige confirmación interactiva** —escribir el nombre de la base— cuando el `.sql` contiene DDL/DML, mostrando antes las sentencias detectadas y la base destino. Flag `--yes` para uso no interactivo, mismo criterio que `release.mjs`.

**Motivo**: su primera línea decía *"Corre un archivo .sql de SOLO LECTURA contra la base de PRODUCCIÓN"* y no tenía nada que lo restringiera: pasaba el archivo entero al cliente `mysql` por stdin. De hecho fue la herramienta con la que se ejecutó el `TRUNCATE` de ~40 tablas productivas del 2026-08-19. El nombre y el encabezado generaban una confianza que el código no respaldaba.

**Alternativa descartada**: restringir `db:query` de verdad a `SELECT`/`SHOW`/`EXPLAIN` y crear un `db:exec` aparte. Se descartó por no querer dos herramientas donde alcanza una bien nombrada; lo destructivo hace falta (limpiezas, parches puntuales) y lo que faltaba era que quien lo corre lo vea venir.

**Consecuencias**:
- La detección (`scripts/release/sql-safety.cjs`) ignora comentarios y literales de texto **a propósito**: un aviso que salta en falso entrena a confirmar sin leer, que es peor que no preguntar.
- El manejo de credenciales no se tocó (`--defaults-extra-file` con `mode 0o600` y borrado en `finally`), y la confirmación va **antes** de escribir ese archivo, para no dejar la clave de producción en `%TEMP%` si se cancela.
- `prod-cleanup-2026-08-19.sql` quedó commiteado **tal cual se ejecutó**, con su encabezado original que menciona `npm run db:query`. Es registro histórico, no documentación vigente.

**Estado**: Vigente.

## DEC-018 — Todo cambio en `src/` sale por `npm run release`; `git push origin master` queda para documentación

**Fecha**: 2026-08-19 (regla acordada tras la auditoría del 2026-08-19).

**Decisión**: cualquier cambio que toque `src/` en cualquiera de los dos repos se despliega **exclusivamente** por `npm run release`. Los push directos a `master` quedan reservados para documentación.

**Motivo**: el sistema de releases se terminó el 2026-08-19 a la mañana y el primer cambio de la tarde (`4714458`) lo esquivó por completo: sin tag, sin bump, sin backup y sin pasar por la validación. Ese commit cambiaba un contrato de API, rompía 59 tests y modificaba el comportamiento de cobro de la tienda — y llegó a producción sin que nadie lo notara. `npm run release` corre la suite antes de tagear: habría frenado el push. La herramienta funcionó; no se la usó.

**Consecuencias**:
- El drift deja de ser una excepción tolerable "para cambios chicos": un cambio chico en `src/` es exactamente el que nadie mira.
- Sin release, el número de versión deja de identificar código y el snapshot de rollback deja de corresponder con lo que corre. El 2026-08-19 los tres componentes declaraban `v1.0.0` y ninguno era `v1.0.0`.

**Estado**: Vigente.

## DEC-019 — En el catálogo, "facturación" es lo emitido y "cobrado" son los cobros reales: no se mezclan

**Fecha**: 2026-08-19 (fix del reporte de producción sobre `CAT-2026-00001/00002`).

**Decisión**: las métricas de catálogo del dashboard separan de forma explícita las dos magnitudes, con las mismas fuentes que ya usaba el circuito de fábrica:

- **Facturación del período** → `SUM(catalog_invoices.total_amount)` de las facturas `issued`/`paid`, imputadas por `issue_date`.
- **Cobrado (por medio de pago)** → filas de `catalog_invoice_payments`, imputadas por `paid_at`.
- **Pendiente de cobro** → `total_amount − payment_amount` de las facturas no anuladas.

**Motivo**: las seis métricas de catálogo sumaban `catalog_invoices.payment_amount`, un campo que **sólo** se llena al registrar un cobro explícito (`addPaymentToCatalogInvoice`). Ni marcar la factura como "Pagada" desde el panel ni el webhook de MP lo tocaban. Resultado en producción: dos ventas del mes, una cobrada por MercadoPago, y el dashboard mostrando "Facturación catálogo: $0", "Cobrado vía MercadoPago: $0" y la curva de evolución en cero. La métrica no estaba rota por un caso borde: estaba midiendo otra cosa que la que decía su título.

**Alternativa descartada**: dejar la métrica como estaba y hacer que "marcar como pagada" completara `payment_amount`. Habría tapado el síntoma sin arreglar la definición — una factura emitida y no cobrada tiene que sumar a la facturación del mes igual, como ya pasa en fábrica.

**Consecuencias**:
- `payment_breakdown.via_mp` pasó a contar **cobros** (`count` = cantidad de cobros de MercadoPago), no pedidos con `mp_payment_status='approved'`. Soporta cobros parciales, que el criterio anterior no podía representar.
- `catalog_orders.mp_payment_status` deja de ser fuente de métricas y queda como lo que es: la traza del último estado informado por MP.
- El dashboard de catálogo y el de fábrica ahora definen "facturación" igual. Si se cambia uno, hay que mirar el otro.

**Estado**: Vigente.

## DEC-020 — Un pago de MercadoPago del catálogo se acredita solo, por dos caminos independientes

**Fecha**: 2026-08-19.

**Decisión**: el circuito de catálogo recibe el mismo tratamiento que la tienda online: `applyCatalogPaymentResult` registra el cobro en la factura, la salda si corresponde, genera el asiento de caja y avisa (socket + mail). Se llega ahí por **dos** caminos, a propósito redundantes:

1. **Webhook** (`POST /catalog/webhook/mp`), con la preference declarando `notification_url`.
2. **Job de reconciliación** (`reconcileCatalogPayments`, cada 10 min), que le pregunta a MP por los pedidos con link/QR generado y factura sin saldar.
3. **Refresco a demanda desde el panel** (`POST /catalog/orders/:id/payment/refresh`, agregado el 2026-08-21). Los otros dos caminos resuelven que el *sistema* se entere; éste resuelve que se entere la *pantalla que el operador está mirando*. Ver [DEC-021](#dec-021).

**Motivo**: hasta este fix, `handleMPWebhook` sólo estampaba `mp_payment_id`/`mp_payment_status` en el pedido — no registraba cobro, no asentaba caja, no avisaba a nadie. Y como la preference se creaba **sin `notification_url`**, MP ni siquiera lo llamaba. Un pedido pagado por QR era indistinguible de uno impago, y la única forma de enterarse era que alguien mirara la cuenta de MercadoPago.

La redundancia no es paranoia, es la lección de [DEC-014](#dec-014): entre el 2026-08-07 y el 2026-08-19, con `MP_WEBHOOK_SECRET` sin cargar, **todas** las notificaciones de MP se rechazaban con 401 y nadie lo notó por doce días. El webhook es el camino rápido; el job es la red de contención que hace que una falla de configuración degrade el sistema (hasta 10 minutos de demora) en vez de romperlo. `applyCatalogPaymentResult` es idempotente (índice único sobre `idempotency_key = mp-<paymentId>`), así que los dos pueden correr a la vez sin duplicar cobros.

**Consecuencias**:
- El webhook de catálogo pasa a depender de `BACKEND_PUBLIC_URL`, que ya era obligatoria en producción (`validateEnv()` no deja arrancar sin ella): no hay configuración nueva que cargar.
- Las preferences creadas **antes** de este cambio siguen sin `notification_url` — para esos pedidos el único camino sigue siendo el job o el script de recuperación.
- Un pago aprobado que no se puede imputar (factura anulada, moneda distinta a ARS) **no** se acredita: se loguea como error y dispara `sendAlert`. Es plata real que entró sin destino y tiene que verla una persona.
- El job deja afuera a propósito las facturas ya marcadas "Pagada" a mano — y son justamente las que quedaron mal por el bug. Para esas está `scripts/reconcile-catalog-order.ts`.

**Estado**: Vigente.

## DEC-021 — La pantalla del QR sondea a MercadoPago, no a nuestra base

**Fecha**: 2026-08-21.

**Decisión**: mientras está abierta la pantalla del código QR, el panel llama cada 10 segundos a `POST /catalog/orders/:id/payment/refresh` —que consulta a MercadoPago— y cierra esa pantalla solo apenas sube lo cobrado. El mismo endpoint está detrás del botón **Actualizar** del modal del pedido. El sondeo se corta a los 15 minutos.

**Motivo**: con [DEC-020](#dec-020) el sistema ya se entera de los pagos, pero la pantalla no. El operador genera el QR, el cliente paga desde su propio teléfono, y en el panel no pasa nada: el modal guardaba el pedido en estado local de React y sólo cambiaba cuando el propio operador hacía algo. En las capturas del reporte se ven cuatro cobros que habían entrado y recién aparecieron al recargar a mano.

**Por qué contra MP y no contra nuestra base**: releer nuestra base sólo sirve si el webhook ya llegó. Si no llegó —que es exactamente el caso que hay que cubrir— la base tampoco sabe nada hasta la próxima corrida del job, hasta 10 minutos después. Un botón "Actualizar" que muestra lo mismo que ya estaba en pantalla no resuelve el problema que se reportó.

**Alternativa descartada**: sólo el botón, sin sondeo. Deja al operador adivinando cuándo tocarlo, y no cierra la pantalla del QR —que era la mitad del pedido original—. Se hicieron las dos cosas: el sondeo para el caso normal, el botón para cuando el sondeo ya se cortó o el operador está en el modal sin el QR abierto.

**Consecuencias**:
- Cada tick pega contra la API de MercadoPago, no sólo contra la nuestra: por eso el endpoint tiene `catalogPaymentRefreshLimiter` (60/min por IP) y el sondeo tiene tope de tiempo. Una pestaña olvidada no puede quemar cuota de MP indefinidamente.
- El pedido abierto en el modal pasó a vivir en la caché de React Query (`['catalog','order', id]`), no en estado local. Las mutaciones que antes hacían `setDetailModal` ahora escriben ahí (`patchOpenOrder`), y el evento de socket `notification:catalog_payment` invalida `['catalog']` completo.
- El refresco nunca falla por un problema con MercadoPago: si la consulta se cae, devuelve el pedido tal cual está y se reintenta en el próximo tick.

**Estado**: Vigente.

## Actualizar este documento cuando…

Se tome una decisión técnica o funcional nueva con impacto duradero, o se revierta/reemplace una decisión ya registrada (agregar entrada nueva referenciando la anterior, no editar la histórica).
