# Auditoría de panel — seis roles independientes (2ª pasada)

**Fecha:** 2026-08-19 · **Auditoría anterior:** `AUDITORIA_PANEL_SEIS_ROLES_2026-08-18.md` (veredicto `NO-GO` para la tienda)
**Alcance:** `backIndians` + `frontIndians`, rama `master`, más el sistema de releases nuevo y la limpieza de datos ejecutada hoy en producción.
**Método:** relectura del cerebro y del handoff, verificación contra el código, ejecución de las puertas de calidad, inspección de los artefactos de release/backup en disco y sondas HTTP de solo lectura contra producción.

---

# VEREDICTO: `NO-GO` — y por motivos distintos y peores que ayer

Ayer los bloqueantes eran de **contenido y configuración**: catálogo de prueba, transferencia sin CBU, textos legales inexistentes. Se trabajó mucho y bien en las 24 horas siguientes: la limpieza de datos productivos se hizo, los tres documentos legales existen y responden 200 en producción, y se construyó un sistema de releases con versionado, backup, tag coordinado en los dos repos, snapshot de frontend y detección de drift. Eso es progreso real y no lo relativizo.

**Pero hoy los bloqueantes son de integridad del proceso, y eso es peor.** La suite de tests del backend **está en rojo**: 17 suites y 59 tests fallando, de forma reproducible, y el commit que los rompió (`4714458`) **está corriendo en producción ahora mismo**. Entre las suites caídas está `audit-preprod-regressions.test.ts`, que es la red que protege las cuatro P1 de seguridad corregidas en agosto. El backup tomado específicamente para poder deshacer el `TRUNCATE` de ~40 tablas productivas **está corrupto** y el script lo dio por bueno. Y la herramienta de release, cuando se le pregunta, contesta que hay drift en los tres componentes y que **no existe ninguna versión anterior a la cual volver**.

El sistema de releases se construyó justo para impedir esto, y el primer cambio posterior lo esquivó por completo: sin tag, sin bump, sin backup y sin pasar por la validación que habría frenado el push. No hay que rehacer el sistema; hay que empezar a usarlo.

---

## 2. Resumen ejecutivo

1. **Cerrado B-01.** El catálogo de prueba ya no existe: la tienda productiva devuelve **0 productos**. La limpieza se ejecutó.
2. **Cerrado B-03 en código.** Términos, Privacidad y Arrepentimiento existen, están enrutados y responden 200 en producción, con constancia de aceptación (`legal_acceptances`) y `accept_terms` obligatorio en registro y checkout.
3. **Sigue abierto B-02, y empeoró.** Transferencia bancaria sigue ofrecida **sin CBU, alias ni titular** cargados. Como se desactivó el pago en efectivo, ahora es **uno de los dos únicos medios de pago**.
4. **Nuevo bloqueante: la suite del backend está en rojo.** 17 suites / 59 tests fallando, reproducible en dos corridas. Causa única: el commit `4714458` sacó `'cash'` del validador de `payment_method` y no actualizó los 17 archivos de test que lo usan.
5. **Ese commit está en producción** (`/health` reporta `commit: 4714458`), desplegado por push directo a `master`, sin pasar por `npm run release`.
6. **Nuevo bloqueante: el backup `pre-limpieza` está truncado.** Le faltan 9 tablas enteras —incluidas `store_orders` y `users`— y corta a mitad de un `INSERT`. Es el backup que protegía una operación irreversible.
7. **Mitigante importante:** los dos backups `v1.0.0` de la mañana **sí están íntegros** (50 tablas, cierre correcto). La pérdida potencial se acota a lo ocurrido entre las 10:01 y las 13:52.
8. **No hay rollback posible.** La propia herramienta lo dice: v1.0.0 es la única release; no hay versión anterior común.
9. **El snapshot de rollback miente.** `frontIndians/.releases/v1.0.0/` contiene el commit `36dc6fc`, pero producción corre `9f91f57`. Un `npm run rollback -- v1.0.0` **reactivaría el pago en efectivo** sin avisar.
10. **`db-query.mjs` se documenta como "SOLO LECTURA" y ejecuta SQL arbitrario contra producción.** Se usó, de hecho, para correr el `TRUNCATE` de 40 tablas.
11. **La operación más destructiva del proyecto no está en git**: `prod-cleanup-2026-08-19.sql` y `db-query.mjs` siguen sin trackear.
12. Sin cambios respecto de ayer: S-01 (75 claves de settings públicas), S-02 (contraseñas de 10 caracteres), C1/MP_WEBHOOK_SECRET, C7 (8 casillas sin marcar), sin CSP, sin HSTS, `ensureSchema` en producción (ahora **dos** funciones), y las mismas 3 vulnerabilidades de npm con fix disponible.
13. Lo que sí mejoró y conviene sostener: typecheck limpio, Vitest 47/47, backups reales contra producción, `/health` con versión y commit, y detección de drift que funciona.
14. **Camino a verde: ~6 h.** Arreglar los 17 tests, releasear `v1.0.1` desde `master` (resuelve drift + snapshot + backup + rollback de una sola vez), cargar los datos bancarios y commitear las herramientas.
15. Hasta entonces, la tienda no debería recibir tráfico: no hay catálogo, y de los dos medios de pago uno está roto.

---

## 3. Tabla consolidada de hallazgos

### 3.1. Estado de los hallazgos de la auditoría del 2026-08-18

| ID | Estado hoy | Evidencia |
|---|---|---|
| **B-01** productos de prueba | ✅ **CERRADO** | `/store/products` devuelve `total: 0` |
| **B-03** textos legales | 🟡 **CERRADO en código, PARCIAL en datos** | Rutas y páginas 200 en prod; `company_address` y `store_data_fiscal_url` vacíos |
| **B-02** transferencia sin CBU | ❌ **ABIERTO Y AGRAVADO** | `bank_transfer_*` vacíos en prod; `StoreCheckoutPage.tsx:48-49` deja 2 medios, uno roto |
| **B-04** `MP_WEBHOOK_SECRET` | ❌ **ABIERTO** | `server.ts:56-73` sin cambios |
| **S-01** settings públicos | ❌ **ABIERTO** | 75 claves servidas; `store.service.ts` sigue con `Settings.findAll()` |
| **S-02** contraseñas ≤10 chars | ❌ **ABIERTO** | `{6,10}` en `auth.routes.ts:9` y `user.routes.ts:9` |
| **S-03** sin CSP | ❌ **ABIERTO** | Verificado: `indians.com.ar` sin `Content-Security-Policy` |
| **C6** sin HSTS | ❌ **ABIERTO** | Verificado: sin `Strict-Transport-Security` en el frontend |
| **A-01** `ensureSchema` en prod | ❌ **ABIERTO Y AGRAVADO** | `server.ts:85-86`: ahora `ensureSchema()` **y** `ensureLegalSchema()`, ambas sin guarda |
| **D-01** monitoreo C7 | ❌ **ABIERTO** | Las 8 casillas de `ALERTAS_Y_MONITOREO.md:148-155` siguen sin marcar |
| **D-02** alertas de jobs | ❌ **ABIERTO** | `sendAlert` sigue invocándose sólo desde `errorRateMonitor.ts:45` |
| **S-04** npm audit | ❌ **ABIERTO** | Front: 1 alta (nanoid) + 2 moderadas (react-router), fix disponible |
| **D-03** deploy sin rollback | 🟡 **MITIGADO PARCIALMENTE** | Ahora hay snapshot local, pero no coincide con producción (ver R-03) |
| **D-04** sin CI/CD | 🟡 **MITIGADO PARCIALMENTE** | El release corre las validaciones… si se lo usa (ver R-02) |
| **L-01** supresión y retención | 🟡 **PARCIAL** | La política declara canal por email y plazo de 5 días hábiles; sigue sin `DELETE /me` ni purga de `store_events` |
| **Q-01** tests de frontend | ❌ **ABIERTO** | 4 archivos Vitest (era 3), 47 tests, ninguno de componente; lint 165 errores (era 161) |
| **D-06** migrate en cada arranque | ❌ **ABIERTO** | `railway.toml` sin cambios |
| **REV-07** sesión única de staff | ❌ **ABIERTO** | Sin decisión registrada |

### 3.2. Hallazgos nuevos

| ID | Área | Rol | Criticidad | Evidencia | Esfuerzo |
|---|---|---|---|---|---|
| **R-02** | Testing / Proceso | QA / DevOps | `BLOQUEANTE` | `npx jest`: **17 suites / 59 tests fallando**, dos corridas idénticas. Causa: `4714458` quitó `'cash'` de `checkoutValidators` y 17 archivos de test lo usan. **`/health` reporta ese commit en producción** | 2 h |
| **R-01** | Backups | DevOps | `BLOQUEANTE` | `gzip -t .releases/db/pre-limpieza-20260819-135247.sql.gz` → *unexpected end of file*. Descomprime 142.263 B y corta a mitad de un `INSERT` de `store_events`; faltan 9 tablas (`store_orders`, `users`, `webhook_events`, …). Los dos `v1.0.0-*` cierran correctos en 169.998 B | 2 h |
| **R-03** | Release | DevOps | `CRÍTICO` | `npm run prod`: drift en los 3 componentes. El snapshot de `v1.0.0` es `36dc6fc`; producción corre `9f91f57` → un rollback **revertiría la desactivación del efectivo** | Con R-04 |
| **R-04** | Release | DevOps | `CRÍTICO` | `npm run prod`: *"No hay una release anterior común y versionada a la cual volver"* | 1 h |
| **R-05** | Herramientas | Seguridad / DevOps | `ALTO` | `db-query.mjs:1` dice "SOLO LECTURA"; ejecuta cualquier `.sql` contra producción. Se usó para el `TRUNCATE` de ~40 tablas (`prod-cleanup-2026-08-19.sql:9`) | 1 h |
| **R-06** | Trazabilidad | DevOps | `ALTO` | `git status`: `db-query.mjs` y `prod-cleanup-2026-08-19.sql` **sin trackear**; `package.json` modificado sin commitear | 0,5 h |
| **L-03** | Legal | Compliance | `ALTO` | El endpoint de arrepentimiento genera un `code` pero **no envía constancia al consumidor**; la Res. 424/2020 la exige dentro de las 24 h | 2 h |
| **L-04** | Legal | Compliance | `ALTO` | `store_data_fiscal_url` vacío en producción → el **Data Fiscal de ARCA (RG 4004-E) no se muestra**, pese a estar implementado | 15 min |
| **L-05** | Legal | Compliance | `MEDIO` | `company_address` vacío: la identificación del titular que exige la Res. 104/2005 se publica incompleta (los textos muestran "—") | 15 min |
| **A-06** | Contratos de API | Arquitecto | `MEDIO` | Dos cambios de contrato sin versionar en 24 h: `accept_terms` obligatorio y `payment_method` sin `'cash'`. Ambos rompen clientes que funcionaban | Política |
| **R-07** | Release | DevOps | `MEDIO` | Los backups viven sólo en `backIndians/.releases/db/` (gitignored, esta máquina, carpeta OneDrive). Sin copia fuera del equipo | 1 h |

---

## 4. Detalle por rol

### 4.1. Ingeniero de Calidad Senior — el hallazgo principal es suyo

**La suite del backend está en rojo y es reproducible.** Corrí `npx jest --forceExit` dos veces con resultado idéntico: **48 suites totales, 17 fallando; 325 tests, 59 fallando**. El handoff de la sesión afirma "48 suites / 325 tests en verde, dos veces" — y le creo: los totales coinciden exactamente, así que la suite **estaba** verde al momento del release. Lo que rompió llegó después.

La causa es única y está aislada. El commit `4714458` cambió una línea:

```diff
-  body('payment_method').optional().isIn(['mercadopago', 'cash', 'bank_transfer'])
+  body('payment_method').optional().isIn(['mercadopago', 'bank_transfer'])
```

Hay **17 archivos de test que hacen checkout con `payment_method: 'cash'`**, y son exactamente las 17 suites que fallan. El síntoma es siempre el mismo: `expected 201, received 422`. No es un bug de la aplicación; es un cambio de contrato que dejó atrás su propia suite.

**Por qué esto importa más de lo que parece.** Entre las suites caídas está `audit-preprod-regressions.test.ts`, que es la red de seguridad de las cuatro P1 corregidas en agosto (AUD-01 escritura cruzada entre compradores, AUD-02 stock sin asiento, AUD-03 sesiones no revocadas, AUD-15 reservas perdidas). Mientras esa suite no corra, **nadie se enteraría si una de esas cuatro regresiones vuelve**. También cayó `legal.test.ts`, la cobertura de la funcionalidad recién estrenada. El resto son los flujos de plata y stock: `stock-ledger`, `stock-reservation`, `stock-restoration`, `checkout-idempotency`, `store-cash-income`, `cash-reversal-automatic`, `webhook-robustness`.

El arreglo es mecánico: cambiar `'cash'` por `'bank_transfer'` (o `'mercadopago'`) en los 17 archivos, y agregar un test que verifique que `'cash'` **ahora se rechaza** — que es lo que debería haber acompañado al cambio.

**Frontend.** Vitest: **47 tests en 4 archivos, todos verdes** (era 3 archivos ayer). Sigue sin un solo test de componente o de hook. ESLint: **165 errores y 11 warnings**, cuatro más que ayer, con los mismos 6 `react-hooks/rules-of-hooks` que no son ruido de estilo. `tsc --noEmit` limpio en ambos repos. Build de producción OK.

**Lo que no pude probar.** Los E2E de Playwright no se corrieron (requieren ambos servidores levantados). No hay pruebas de carga. Y no existe ningún smoke test automatizado que mire el estado de producción — que es, otra vez, donde vivieron los bloqueantes de ayer y donde vive R-01 hoy.

### 4.2. Ingeniero DevOps — el sistema es bueno; el problema es que se lo saltó

**Lo que se construyó está bien pensado.** Tag coordinado en los dos repos, changelog generado, backup previo al despliegue, snapshot del `dist`, `/health` reportando `version` y `commit`, `version.json` publicado por el frontend, y un `status.mjs` que compara producción contra los tags y **detecta drift de commit resolviendo el tag anotado con `^{}`** — ese detalle es de alguien que ya se quemó con eso. Los cinco bugs que se encontraron usándolo por primera vez (guarda de ejecutable en Windows, rechazo no manejado en el pipeline de backup, `git` partido por los paréntesis bajo `cmd.exe`, reversión incompleta del release parcial, `core.autocrlf` confundido con cambios reales) son bugs de calidad, encontrados por los propios guardrails. Nada de eso tocó producción.

**R-01 — el backup que importaba está roto.** El `prod-cleanup-2026-08-19.sql` es explícito en su encabezado: *"REQUISITO: correr backup con `npm run db:backup -- --tag=pre-limpieza` ANTES de ejecutar este script. Es irreversible."* Se corrió: el archivo existe, 23.007 bytes, nombre correcto, timestamp coherente (13:52). **Y está truncado.**

```
pre-limpieza-20260819-135247.sql.gz → gzip: unexpected end of file
  descomprime 142.263 B, termina a mitad de un INSERT de store_events
  tablas presentes: 41 de 50
  faltan: store_order_items, store_order_status_history, store_orders,
          store_return_items, store_returns, store_wishlist,
          store_withdrawal_requests, users, webhook_events

v1.0.0-20260819-094557.sql.gz → gzip OK, 169.998 B, "Dump completed on 2026-08-19 9:47:56"
v1.0.0-20260819-095900.sql.gz → gzip OK, 169.998 B, "Dump completed on 2026-08-19 10:01:00"
```

Las 9 tablas ausentes fueron todas vaciadas por la limpieza. Desde ese backup, **los pedidos de tienda y la tabla `users` no se pueden recuperar**.

**Lo que salva la situación**: los dos backups `v1.0.0` de la mañana están íntegros y contienen las 50 tablas. La limpieza fue a las ~13:52, así que la exposición real es la actividad entre las 10:01 y las 13:52 de una tienda que sólo tenía datos de prueba — probablemente nada. **El daño concreto es bajo; el defecto de proceso es grave**: el script reportó éxito y dejó un archivo que parece válido. `db-backup.mjs` tiene lógica para no conservar dumps rotos (`if (existsSync(outFile)) unlinkSync(outFile)` en el `catch`, más un chequeo de tamaño posterior), pero este caso pasó por el medio: el `pipeline` resolvió limpio, `mysqldump` no devolvió código distinto de cero, y el archivo superó el umbral de tamaño. **Falta la verificación que sí lo habría detectado: `gzip -t` sobre el archivo escrito y comprobar que el texto termina en `-- Dump completed on`.** Son diez líneas.

**R-02/R-03/R-04 — el estado real del release, según su propia herramienta.** Corrí `npm run prod`:

```
backIndians    master   4714458  pkg 1.0.0 · con cambios sin commitear
frontIndians   master   9f91f57  pkg 1.0.0
Backend  OK v1.0.0 (4714458)
sistema  OK v1.0.0 (9f91f57)   tienda  OK v1.0.0 (9f91f57)

XX Backend declara v1.0.0, pero corre 4714458; el tag apunta a 06af3bf.
XX Frontend sistema declara v1.0.0, pero corre 9f91f57; el snapshot validado es 36dc6fc.
XX Frontend tienda  declara v1.0.0, pero corre 9f91f57; el snapshot validado es 36dc6fc.

!! No hay una release anterior común y versionada a la cual volver.
```

Tres cosas, en orden de gravedad:

- **No hay rollback.** v1.0.0 es la única release de la historia. Si algo se rompe hoy, no hay a dónde volver — la capacidad que esta sesión construyó todavía no existe en la práctica.
- **El snapshot de rollback no es lo que corre.** `frontIndians/.releases/v1.0.0/` es el build de `36dc6fc`. Producción es `9f91f57`. Si alguien ejecuta `npm run rollback -- v1.0.0` creyendo que restaura el estado actual, **republica un frontend que todavía ofrece el pago en efectivo** — que es justamente lo que se acaba de desactivar. Un rollback que reintroduce en silencio un cambio de negocio es peor que no tener rollback.
- **Todo declara "v1.0.0" y ninguno es v1.0.0.** El número de versión dejó de identificar código. Cualquier diagnóstico futuro que se apoye en él va a apuntar al lugar equivocado.

El handoff registra el drift como decisión consciente ("no forzar un release completo por cambios chicos"), y para `d52015c` (docs) y `f3981c3` (mejoras del tooling) es defendible. **Para `4714458` no lo es**: cambia un contrato de API, rompe 59 tests y modifica el comportamiento de cobro de la tienda. `npm run release` corre la suite antes de tagear — habría frenado el push. La herramienta funcionó; no se la usó.

**R-05 — `db-query.mjs` no hace lo que dice.** Su primera línea es: *"Corre un archivo .sql de SOLO LECTURA contra la base de PRODUCCIÓN"*. No hay nada que lo restrinja: hace `spawnSync(mysql, ..., { input: readFileSync(sqlFile) })`. Cualquier `.sql` se ejecuta entero. De hecho el `prod-cleanup` documenta su propio uso como `npm run db:query -- scripts/release/prod-cleanup-2026-08-19.sql` — o sea, **la herramienta "de solo lectura" es la que vació 40 tablas de producción**. El manejo de credenciales sí está bien resuelto (`--defaults-extra-file` con `mode 0o600` y borrado en `finally`). Lo que falta es honestidad en el contrato: o se llama `db:exec` y pide confirmación explícita cuando el SQL contiene DDL/DML, o se restringe de verdad a `SELECT`/`SHOW`.

**R-06 — la operación más destructiva del proyecto no está en git.** `git status` muestra `prod-cleanup-2026-08-19.sql` y `db-query.mjs` **sin trackear**, y `package.json` modificado sin commitear. El script que borró los datos productivos existe sólo en este disco. Si mañana hay que auditar qué se borró exactamente, la respuesta depende de que nadie haya tocado ese archivo.

**R-07 — los backups no salen de esta máquina.** Viven en `backIndians/.releases/db/` (gitignored), dentro de una carpeta OneDrive. Es mejor que nada, pero no es una estrategia de respaldo: un borrado sincronizado se los lleva a los tres.

### 4.3. Auditor de Ciberseguridad

**Sin cambios en lo estructural, y eso incluye lo bueno.** Los routers siguen todos protegidos, la separación de los dos JWT sigue intacta, el scoping del vendedor sigue correcto y no aparecieron usos de SQL sin parametrizar en el código nuevo. Los endpoints legales nuevos están bien montados: los tres de administración exigen `authenticate + authorize('admin','billing')`.

**El botón de arrepentimiento es público, sin login y sin captcha — y está bien así.** La Res. 424/2020 exige que sea accesible sin barreras; poner un CAPTCHA delante sería incumplirla. La protección elegida es la correcta: `withdrawalLimiter` a 10 por hora por IP, validadores de longitud en todos los campos, y **no envía ningún mail**, así que no se puede usar como amplificador de spam hacia terceros.

**Lo que sigue igual que ayer**: S-01 (las 75 claves de `settings` servidas sin allowlist en un endpoint público cacheado 60 s), S-02 (contraseñas de staff topeadas en 10 caracteres), sin CSP, sin HSTS en el frontend, y las mismas tres vulnerabilidades de npm en el frontend con fix disponible sin cambio mayor — `nanoid` (alta) y `react-router` (open redirect + *arbitrary constructor injection*).

**Novedad de superficie**: `legal_acceptances` y `store_withdrawal_requests` guardan `ip` y `user_agent`. Es correcto y necesario —son la prueba de la aceptación y del reclamo— pero suma dos tablas con datos personales a un sistema que todavía no tiene ninguna política de retención implementada.

### 4.4. Arquitecto de Software Senior

**A-06 — dos cambios de contrato sin versionar en 24 horas.** `POST /store/checkout` y `POST /store/auth/register` ahora exigen `accept_terms`; `payment_method` dejó de aceptar `'cash'`. Los dos rompen clientes que antes funcionaban, y los dos viven bajo el mismo `/api/v1`. El primero venía acompañado de sus tests; el segundo dejó 17 suites atrás. Con un solo consumidor conocido (el propio frontend) el daño está acotado, pero el patrón —cambiar el contrato y descubrirlo por los tests, o no descubrirlo— ya se repitió dos veces.

Vale marcar un residuo del segundo cambio: el frontend todavía tiene el camino de `'cash'` vivo (`StoreCheckoutPage.tsx:42,150,196,417`) aunque la opción ya no se ofrece. Es código muerto inofensivo hoy, y una trampa el día que alguien reactive la opción en la UI sin tocar el validador del backend.

**A-01 empeoró.** `server.ts:85-86` ahora llama a `ensureSchema()` **y** a `ensureLegalSchema()`, las dos sin guarda de `NODE_ENV`, las dos haciendo DDL real (`addColumn` sobre `store_customers` en la segunda). Cada reinicio del contenedor productivo ejecuta `describeTable` y puede alterar el esquema sin quedar registrado en `SequelizeMeta`. El patrón se replicó en vez de corregirse — es exactamente lo que el `CLAUDE.md` pide no hacer.

**Lo que sí mejoró arquitectónicamente.** `useLegalInfo.ts` resuelve bien un problema real: los datos del titular no se escriben a mano en los textos legales, salen de `Settings`, con un flag `incomplete` que detecta cuándo falta algo que la normativa exige publicar. Es la decisión correcta y está bien documentada en el propio archivo.

### 4.5. Especialista Legal y de Privacidad

**El avance es sustancial y hay que reconocerlo.** Existen los tres documentos, están enrutados (`/tienda/legal/terminos`, `/tienda/legal/privacidad`, `/tienda/legal/arrepentimiento` más el alias corto `/tienda/arrepentimiento` que pide la Res. 424/2020), responden 200 en producción, están versionados con fecha de vigencia servida por el backend, y hay constancia de aceptación con IP y user-agent. La política de privacidad incluye la cláusula textual del art. 14 inc. 3 de la Ley 25.326 que exige la Disposición 10/2008, declara el plazo de 5 días hábiles del art. 16 y ofrece un canal concreto. **Ayer esto no existía y el sitio afirmaba que sí; hoy existe.**

**Lo que falta para que sirva de verdad:**

**L-04 — el Data Fiscal no se muestra.** El soporte está completo en código: `store_data_fiscal_url` está en `VALID_KEYS` (`settings.service.ts:64`), hay campo en el panel (`EcommerceSettingsPage.tsx:336`) y el hook lo lee. Pero en producción la clave no tiene valor, así que el QR de ARCA que exige la RG 4004-E no aparece. **Es cargar una URL.**

**L-05 — la identificación del titular se publica incompleta.** `company_address` está vacío en producción. `legalShared.tsx:112` renderiza `—` cuando falta el dato, así que los tres documentos muestran hoy un domicilio en blanco. La Res. 104/2005 exige que esa identificación esté publicada y sea exacta.

**L-03 — falta la constancia al consumidor.** El endpoint genera un `code` correlativo y lo devuelve, pero **no manda ningún mail**. La Res. 424/2020 exige que el proveedor envíe al consumidor la constancia del arrepentimiento dentro de las 24 horas. Hoy el consumidor se queda con un número en pantalla y nada en su casilla. Es reutilizar `emailQueue`, que ya existe.

**L-01 — la política promete lo que el sistema no puede hacer solo.** Declara supresión en 5 días hábiles, y no hay `DELETE /me` ni purga de `store_events`. Ojo: **esto no es incumplimiento** — la ley admite el canal por email y el sitio lo ofrece. Pero el plazo declarado ahora obliga, y no hay ninguna herramienta que lo asista. La primera solicitud se resuelve a mano contra la base.

**L-02 — transferencias internacionales.** Cloudflare, MercadoPago, Cloudinary, Resend y Google siguen sin declararse. Ahora que existe una política de privacidad, es el lugar donde deben figurar.

### 4.6. Release Manager — integración

**Dónde los roles no coinciden.**

*Sobre R-01 (el backup roto).* **DevOps lo llama bloqueante**: la salvaguarda de una operación irreversible falló en silencio, y el modo de falla —archivo presente, con nombre correcto y tamaño plausible, pero inservible— es el peor posible, porque nadie lo mira hasta que lo necesita. **Calidad lo bajaría a alto**: los dos backups de la mañana están íntegros, la ventana descubierta son 3 horas y 51 minutos de una base que sólo tenía datos de prueba, así que el daño concreto es nulo. **No promedio.** Lo dejo en `BLOQUEANTE` por el defecto de proceso, no por el daño: el mismo script va a proteger la próxima migración destructiva sobre datos reales.

*Sobre R-02 (los 59 tests rojos).* **Aquí no hay desacuerdo entre roles, y por eso lo pongo primero.** Calidad, Arquitectura y DevOps coinciden: el problema no es que 59 tests fallen —eso son dos horas— sino que un cambio de contrato llegó a producción sin que nadie lo notara, tres horas después de terminar de construir el sistema que existe para impedirlo.

*Sobre el drift (R-03/R-04).* **DevOps y el handoff coinciden en que no afecta el funcionamiento** — y es cierto, nada de lo desplegado fuera del tag rompió nada. **Arquitectura agrega el matiz que cambia la conclusión**: el problema no es lo que el drift hace hoy, es que **invalida el rollback**. Y el rollback era el objetivo de toda la sesión.

**Balance honesto de las 24 horas.** Se cerró el bloqueante más caro de ayer (B-03, los legales) y el más visible (B-01, el catálogo de prueba). Se construyó una capacidad que el proyecto no tenía y que necesitaba. Nada de eso es poco. Lo que no cambió es el patrón de fondo que ya señalé ayer: **las condiciones que se dejan abiertas no se cierran solas**. Seis de las ocho condiciones del `GO CONDICIONADO` del 2026-08-08 siguen abiertas once días después. S-01, S-02, A-01, D-01 y D-02 —todos de una a tres horas de trabajo— siguen exactamente igual que ayer. Y el sistema de releases corre riesgo de sumarse a esa lista: existe, funciona, y todavía no cambió cómo se despliega.

---

## 5. Bloqueantes — orden de ejecución

| # | Acción | Tiempo | Por qué en este orden |
|---|---|---|---|
| 1 | **R-02** — Arreglar los 17 archivos de test (`payment_method: 'cash'` → `'bank_transfer'`) y **agregar un test que verifique que `'cash'` ahora devuelve 422** | 2 h | Sin suite verde, `npm run release` no deja avanzar — y no debería |
| 2 | **R-06** — Commitear `db-query.mjs`, `prod-cleanup-2026-08-19.sql` y el `package.json` pendiente | 0,5 h | La limpieza de producción tiene que quedar en la historia |
| 3 | **R-01** — Agregar a `db-backup.mjs` verificación `gzip -t` **y** comprobación de que el dump termina en `-- Dump completed on`. Volver a tomar el backup productivo y validarlo | 2 h | Antes del próximo release, que va a tomar backup |
| 4 | **R-03 + R-04** — `npm run release -- patch` desde `master`. Resuelve de una sola vez: drift de backend y frontend, snapshot alineado, backup nuevo verificado y **la primera versión anterior a la que se puede volver** | 1 h | Depende de 1, 2 y 3 |
| 5 | **B-02** — Cargar `bank_transfer_holder/cbu/alias` **y** ocultar el medio de pago en el checkout cuando falten. Con el efectivo desactivado, es 1 de 2 opciones | 2 h | Es el único bloqueante funcional que queda de ayer |
| 6 | **L-04 + L-05** — Cargar `store_data_fiscal_url` y `company_address` en Settings | 30 min | Es configuración; cierra dos incumplimientos normativos |
| 7 | **L-03** — Enviar la constancia de arrepentimiento por mail (reutilizar `emailQueue`) | 2 h | Res. 424/2020, plazo de 24 h |
| 8 | **B-04** — `MP_WEBHOOK_SECRET` en Railway y `server.ts:68` de vuelta a fatal | 1 h | Abierto desde el 2026-08-07 |

**Total: ~11 h.** Los pasos 1 a 4 (5,5 h) son los que devuelven al proyecto a un estado en el que se puede desplegar con red.

**Y una regla, que vale más que cualquiera de los ocho pasos:** de acá en adelante, **todo lo que toque `src/` va por `npm run release`**. Los push directos a `master` quedan sólo para documentación. Es la única forma de que el trabajo de ayer sirva para algo.

---

## 6. Plan de contingencia

**Situación de partida, dicha sin vueltas: hoy no hay rollback.** Hasta que exista `v1.0.1` (paso 4), el plan de contingencia real es:

- **Backend:** redeploy manual del commit anterior desde Railway (`f3981c3`, o `06af3bf` si hay que llegar al tag). No hay automatismo.
- **Frontend:** el snapshot `v1.0.0` **no sirve tal cual** — republicarlo revierte la desactivación del efectivo. Si hace falta volver atrás hoy, hay que hacer checkout de `9f91f57`, `npm ci` y `npm run deploy`.
- **Base:** restaurar `v1.0.0-20260819-095900.sql.gz` (verificado íntegro). **No usar `pre-limpieza-*.sql.gz`: está truncado.**

**Criterios objetivos de rollback** (cualquiera dispara):

- Un pedido pagado sin su asiento en caja (checks 07, 14-18 del SQL de integridad).
- Divergencia de stock que el ledger no explique (checks 01, 02, 03, 06).
- Más de 10 respuestas 5xx en 5 minutos, en dos ventanas seguidas.
- `/health` en 503 más de 2 minutos.
- Un checkout que no se puede completar con **ninguno** de los dos medios de pago activos.

**Qué monitorear en las primeras 24/48 h:**

| Ventana | Qué | Umbral |
|---|---|---|
| Continuo | `npm run prod` — que deje de reportar drift | Cualquier `XX` |
| T+0 a T+2 h | `/health`: `status`, `database`, `version`, `commit` | Commit ≠ tag esperado |
| T+0 a T+2 h | Checkout de prueba con MercadoPago y con transferencia | Cualquier falla |
| T+2 a T+24 h | `jobs.reconcilePaymentsFailed`, `jobs.expireStaleOrdersFailed` | Una sola aparición |
| T+24 h | `reportDailyInconsistencies` de las 03:00 | Cualquier inconsistencia nueva |
| T+24 a T+48 h | `auditoria-integridad-preprod.sql` completo | `INTEGRIDAD FALLA` |
| Tras cada backup | `gzip -t` + verificar el trailer `Dump completed on` | Cualquier fallo |

---

## 7. Deuda aceptada

Se mantiene la lista del informe del 2026-08-18 (A-05/AUD-16, A-03 transiciones duplicadas, A-04 tabla `products` sin migración, AUD-08, AUD-09, AUD-10, AUD-11, A-02 rate limit en memoria, S-05 Turnstile fail-open, REV-07 sesión única, I-03 checklist no bloqueante), con estas incorporaciones:

| ID | Con qué se convive | Por qué es tolerable | Fecha objetivo |
|---|---|---|---|
| Camino `'cash'` muerto en el frontend | Código de un medio de pago que ya no se ofrece | No es alcanzable desde la UI | Con el próximo toque de checkout |
| R-07 | Backups sólo en esta máquina | Railway mantiene sus propios respaldos del servicio | 2026-09-15 |
| L-01 | Supresión manual, sin `DELETE /me` ni purga | El canal por email cumple la ley; el volumen hoy es cero | 2026-09-30 |

---

## 8. Preguntas abiertas

| # | Pregunta | Quién responde |
|---|---|---|
| 1 | ¿Hubo actividad real en producción entre las 10:01 y las 13:52 de hoy? Es la ventana que el backup roto no cubre | Admin |
| 2 | ¿Están cargadas en Railway `ALERT_EMAIL_TO`, `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY`? ¿Existe el monitor de UptimeRobot? (C7, 8 casillas sin marcar) | DevOps |
| 3 | ¿`TURNSTILE_SECRET_KEY` está configurada en producción? | DevOps |
| 4 | ¿Railway sigue en una sola réplica? (C4) | DevOps |
| 5 | ¿`store_cash_account_id`=1 y `store_bank_account_id`=3 siguen apuntando a cuentas reales? Ojo: la limpieza reseteó los saldos de las cuentas 1, 2 y 3 a cero | Admin |
| 6 | ¿La desactivación del pago en efectivo es definitiva? Si lo es, conviene sacar el camino muerto del frontend; si es temporal, hay que documentarlo | Dueño |
| 7 | ¿Se decide activar HSTS? (C6, abierta desde el 2026-08-08) | Dueño + Dev |
| 8 | ¿Cuándo se cargan `company_address` y `store_data_fiscal_url`? Son 15 minutos y cierran dos incumplimientos | Admin |
| 9 | ¿Quién hace la revisión legal de los textos y la inscripción ante la AAIP? | Dueño |
| 10 | ¿La única-sesión-por-usuario del staff es deliberada? (REV-07, sin respuesta desde el 08/08) | Dueño |

---

## 9. Falsos positivos descartados

- **"El Data Fiscal no se puede configurar porque falta la clave."** Lo sospeché al ver `store_data_fiscal_url` ausente del endpoint público. Es falso: la clave **sí** está en `VALID_KEYS` (`settings.service.ts:64`) y tiene campo en el panel. Simplemente no tiene valor cargado. Es configuración, no un bug.
- **"No hay backups de producción."** También falso: están en `backIndians/.releases/db/`, no en `.backups/` como busqué primero. Hay tres, y dos son íntegros.
- **"Los 59 tests rojos son por la base de desarrollo sucia."** Descartado: reproduje el fallo aislando `purchase-flow.test.ts` y el error es un `422` de validación con los productos presentes en la base. La causa es el validador, no los datos.
- **"El endpoint de arrepentimiento es un vector de spam."** Descartado: no envía ningún mail. Rate-limitado a 10/hora por IP y con validadores de longitud en todos los campos.
- **Inyección SQL en el código nuevo.** Revisados `legal.service.ts` y los scripts de release: todo parametrizado o con literales controlados.
- **Cabeceras de seguridad del frontend.** Siguen vivas en producción (`nosniff`, `SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`). Lo que falta es CSP y HSTS, que son hallazgos aparte.
- **Los legales no cargan en producción.** Descartado: `/tienda/legal/terminos` y `/privacidad` dan 301 → 200 (redirección a barra final, comportamiento normal del `.htaccess`), y `/tienda/arrepentimiento` da 200 directo.

---

## 10. Limitaciones declaradas

- No tuve acceso al panel de Railway, a UptimeRobot ni a la base productiva. Todo lo relativo a variables de entorno está en preguntas abiertas, no en hallazgos.
- No leí ningún `.env*`, `.env.release` ni `documentos/Users.txt`.
- Las sondas contra producción fueron **exclusivamente `GET`/`HEAD` sobre endpoints públicos**, más `npm run prod` (que sólo hace HTTP). No ejecuté nada contra la base productiva. Los valores sensibles de `/store/settings` no se transcriben: sólo los nombres de las claves.
- Los backups se verificaron con `gzip -t` y comparando la lista de tablas y el trailer. **No se restauró ninguno**, así que "íntegro" significa "descomprime completo y cierra bien", no "restaura sin errores".
- No corrí los E2E de Playwright ni pruebas de carga. La revisión de accesibilidad sigue siendo superficial.
- La suite de backend se corrió contra la base de desarrollo local, que queda con los datos que dejó.

---

# VEREDICTO FINAL: `NO-GO`

Se cerraron los dos bloqueantes más caros de ayer y se construyó una capacidad que el proyecto necesitaba. Pero hoy la suite de tests está en rojo con el commit responsable corriendo en producción, el backup que protegía un borrado irreversible está inservible, y la herramienta de release informa que no hay ninguna versión a la que volver.

Ninguno de esos tres es difícil de arreglar: cinco horas y media de trabajo dejan al proyecto en el mejor estado en que estuvo nunca —suite verde, `v1.0.1` tageada, backup verificado y rollback real—. Lo que hay que cambiar no es el código, es la costumbre: **el sistema de releases se terminó a las 10 de la mañana y a las 13 ya se lo había esquivado.** Mientras `git push origin master` siga siendo un camino válido para cambios de `src/`, todo lo que se construyó ayer es decorativo.
