# Auditoría de panel — seis roles independientes (3ª pasada, post-corrección)

**Fecha:** 2026-08-19 (tarde) · **Auditorías previas:** `..._2026-08-18.md` (`NO-GO`) y `..._2026-08-19.md` (`NO-GO`)
**Alcance:** verificación de los hallazgos cerrados en la sesión de corrección, más búsqueda de hallazgos nuevos introducidos por ella.
**Método:** git de ambos repos, ejecución de las puertas de calidad **contra base limpia y sembrada**, verificación de los artefactos de release y backup, y sondas HTTP de solo lectura contra producción.

---

# VEREDICTO: `GO CONDICIONADO`

**Los cuatro bloqueantes de la mañana están cerrados, y verificados uno por uno.** La suite volvió a verde, el drift desapareció, existe una versión a la cual volver, el verificador de backups rechaza efectivamente el dump corrupto que ayer pasó por bueno, y la transferencia bancaria ya no se puede elegir si no hay a dónde transferir. `v1.0.1` está tageada en ambos repos, desplegada, y `npm run prod` confirma que el commit que corre en producción es exactamente el del tag. Es la primera vez en las tres pasadas que el proyecto está en un estado del que se puede volver atrás.

Además, cada corrección vino con su test: cuatro suites nuevas (`store-payment-methods`, `store-public-settings`, `password-policy`, `job-alerts`) y dos de unidad (`verify-dump`, `sql-safety`). No se arreglaron los síntomas, se cerraron los agujeros.

**Lo que impide un `GO` limpio** no es código roto sino tres cosas concretas: la suite **no es idempotente** —pasa contra base limpia (386/387) y falla 11 suites después de varias corridas seguidas sin resembrar—, lo que vuelve poco confiable la compuerta del release; un test nuevo (`store-withdrawal-email`) **falla contra base recién sembrada** porque depende de una configuración que nadie siembra; y la tienda sigue sin catálogo, sin datos fiscales cargados y con **un solo medio de pago operativo**. Las condiciones que quedan son casi todas de configuración, no de programación.

---

## 2. Resumen ejecutivo

1. **R-02 cerrado.** Suite: **386 de 387 tests en verde** contra base limpia (55 suites, creció desde 48). El único fallo es un test nuevo, no una regresión.
2. **R-01 cerrado y probado.** `verify-dump.cjs` rechaza el backup corrupto de ayer (*"gzip truncado"*, 42 tablas) y acepta los buenos (51 tablas). Lo corrí contra los cuatro dumps del disco.
3. **R-03 y R-04 cerrados.** `npm run prod` reporta cero drift en los tres componentes y ofrece `v1.0.0` como objetivo de rollback, con snapshot de frontend y backup previo disponibles.
4. **B-02 cerrado en código.** El frontend oculta la transferencia si no hay CBU ni alias; el backend la rechaza con el **mismo criterio**, antes de reservar stock. Con test.
5. **S-01 cerrado.** El endpoint público pasó de **75 a 68 claves**: se fueron `afip_*`, `store_cash_account_id`, `store_bank_account_id`, `invoice_*` y `company_activity_start`. Las que exige la normativa siguen publicadas, que era el riesgo de recortar de más.
6. **S-02, A-01, D-02, R-05 y R-06 cerrados.** Contraseñas `{10,128}`, `ensureSchema` fuera de producción con auditoría de migraciones en el comentario, alertas en los tres jobs y en el reporte de inconsistencias, `db-query` renombrado a `db-exec` con detección de sentencias destructivas, y todo commiteado —incluido el `.sql` que vació producción.
7. **L-03 implementado**, con un defecto: el aviso al administrador se saltea en silencio si no hay `company_email` ni `LEGAL_NOTIFICATIONS_EMAIL` ni `ALERT_EMAIL_TO`.
8. **Nuevo `ALTO`: la suite no es idempotente.** Tras varias corridas seguidas sin resembrar, fallan 11 suites (todas de caja/facturas/factory). Contra base limpia pasan. La compuerta del release depende del estado de la base de quien la corra.
9. **Nuevo `MEDIO`: `store-withdrawal-email.test.ts` falla contra base recién sembrada** — necesita `company_email`, que no siembra ni el seed ni el `setup.ts`. Pasó en el release por casualidad de estado.
10. **S-04 parcial.** `nanoid` (alta) resuelta. Quedan 2 moderadas de `react-router` que **ahora exigen un major** (v7): open redirect y *arbitrary constructor injection*.
11. **La tienda tiene un solo medio de pago operativo**: efectivo desactivado y transferencia oculta por falta de datos. Todo el ingreso depende de MercadoPago.
12. Sin cambios y pendientes de vos: `MP_WEBHOOK_SECRET` (C1, abierta desde el 07/08), las 8 casillas del monitoreo (C7), `company_address`, `company_iva_condition`, `store_data_fiscal_url` y los datos bancarios.
13. CSP y HSTS siguen ausentes — fuera de alcance por decisión, esperando tu respuesta.
14. Documentación al día: `DEC-018` deja escrita la regla de que todo cambio en `src/` sale por release, y está replicada en `09-CURRENT-STATUS` y `11-RELEASE-Y-ROLLBACK`.
15. **Para llegar a `GO` limpio: ~3 h de código** (idempotencia de la suite y el test roto) más la configuración que depende de vos.

---

## 3. Estado de los hallazgos anteriores

### 3.1. Bloqueantes de la 2ª pasada — los cuatro cerrados

| ID | Estado | Cómo lo verifiqué |
|---|---|---|
| **R-02** suite roja + commit sin release | ✅ **CERRADO** | `npx jest` contra base limpia: 55 suites, **386/387**. Suite nueva `store-payment-methods.test.ts:55` verifica que `'cash'` ahora devuelve 422 |
| **R-01** backup corrupto | ✅ **CERRADO** | Corrí `verifyDump()` contra los 4 dumps: rechaza `pre-limpieza` (42 tablas, gzip truncado), acepta los tres buenos (51 tablas). `verify-dump.cjs` chequea gzip íntegro + trailer `-- Dump completed on` + piso de tablas |
| **R-03** drift de commit | ✅ **CERRADO** | `npm run prod`: *"Backend: commit bd8b975 corresponde al tag v1.0.1"* y lo mismo para sistema y tienda |
| **R-04** sin rollback | ✅ **CERRADO** | `npm run prod`: *"objetivo seguro común: v1.0.0"*, con snapshot de frontend, tag en ambos repos y backup previo |

### 3.2. Resto de hallazgos

| ID | Estado | Evidencia |
|---|---|---|
| **B-02** transferencia sin CBU | ✅ **CERRADO en código** | `store.service.ts:852` `hasBankTransferConfigured()` + rechazo en `createStoreOrder` **antes de reservar stock**; `StoreCheckoutPage.tsx:77` usa el criterio idéntico. Faltan los datos (tarea tuya) |
| **S-01** settings públicos | ✅ **CERRADO** | Producción: **68 claves**, cero internas. `PUBLIC_SETTING_KEYS` en `settings.service.ts:104` con test en `store-public-settings.test.ts` |
| **S-02** contraseñas ≤10 | ✅ **CERRADO** | `{10,128}` en ambos routers + `password-policy.test.ts` |
| **A-01** `ensureSchema` en prod | ✅ **CERRADO** | `server.ts:96` con guarda `NODE_ENV !== 'production'` y comentario que enumera las migraciones que respaldan cada parche (059, 063, 065, 066, 069, 091-095, 098) |
| **D-02** alertas de jobs | ✅ **CERRADO** | `sendAlert` en `scheduler.ts:31` y `reportInconsistencies.ts:180` + `job-alerts.test.ts` |
| **R-05** `db-query` engañoso | ✅ **CERRADO** | Renombrado a `db-exec.mjs`, encabezado sincerado, `sql-safety.cjs` detecta 11 verbos destructivos ignorando comentarios y literales, confirmación previa con `--yes` para no interactivo |
| **R-06** archivos sin trackear | ✅ **CERRADO** | `git ls-files`: los tres scripts nuevos, el `prod-cleanup-2026-08-19.sql` y los tres documentos de auditoría |
| **L-03** constancia de arrepentimiento | 🟡 **IMPLEMENTADO, con defecto** | `legal.service.ts:220` manda al consumidor y `:234` al administrador — pero el segundo se saltea sin avisar si falta la configuración (ver Q-C) |
| **S-04** dependencias | 🟡 **PARCIAL** | `nanoid` resuelta. `react-router`: 2 moderadas cuyo fix ahora es `react-router-dom@7` (major) |
| **L-04 / L-05** datos fiscales | ❌ **ABIERTO** (tuyo) | Producción: `company_address` vacío, `company_iva_condition` y `store_data_fiscal_url` sin fila |
| **B-04** `MP_WEBHOOK_SECRET` | ❌ **ABIERTO** (tuyo) | `server.ts` sin cambios — correcto, se dejó así a propósito hasta que cargues la variable |
| **D-01** monitoreo C7 | ❌ **ABIERTO** (tuyo) | Las 8 casillas de `ALERTAS_Y_MONITOREO.md:148-155` siguen sin marcar |
| **S-03** CSP · **C6** HSTS | ⏸️ **DIFERIDO** | Verificado en producción: ninguno de los dos presente. Fuera de alcance por decisión pendiente |
| **L-01** supresión y retención | ⏸️ **DEUDA ACEPTADA** | Sin `DELETE /me` ni purga. Objetivo 2026-09-30 |
| **Q-01** tests de frontend | ❌ **ABIERTO** | Vitest 47/47 en 4 archivos, ninguno de componente. Lint estable en 165 errores (no subió) |

---

## 4. Hallazgos nuevos

| ID | Área | Rol | Criticidad | Evidencia | Esfuerzo |
|---|---|---|---|---|---|
| **Q-B** | Testing | QA / DevOps | `ALTO` | Tras varias corridas seguidas sin resembrar: **11 suites / 57 tests fallan**. Las mismas pasan en aislamiento y con base limpia. `maxWorkers: 1`, así que no es paralelismo: es estado acumulado entre suites | 3 h |
| **Q-A** | Testing | QA | `MEDIO` | `store-withdrawal-email.test.ts` falla contra base **recién sembrada**: necesita `settings.company_email`, que no siembra ni `seeders/` ni `src/__tests__/setup.ts` | 30 min |
| **Q-C** | Observabilidad | Arquitecto | `MEDIO` | `legal.service.ts:233` — si no hay `LEGAL_NOTIFICATIONS_EMAIL`, `company_email` ni `ALERT_EMAIL_TO`, el aviso al administrador se saltea **sin un solo log**. Un arrepentimiento puede quedar sin gestionar | 15 min |
| **N-01** | Negocio | Arquitecto / QA | `MEDIO` | La tienda queda con **un único medio de pago operativo** (MercadoPago): el efectivo está desactivado y la transferencia oculta por falta de datos. Todo el ingreso pasa por un proveedor externo sin alternativa | Configuración |
| **S-04b** | Dependencias | Seguridad | `MEDIO` | `react-router` 6.30.x: open redirect vía backslash y *arbitrary constructor injection*. El fix pasó a exigir `react-router-dom@7` (major) — ya no es un `npm audit fix` | 4-8 h |

---

## 5. Detalle por rol

### 5.1. Ingeniero de Calidad Senior — el hallazgo principal vuelve a ser suyo, pero es otro

**Lo primero, y es una corrección a mi propia lectura inicial.** Corrí la suite y me dio **11 suites / 57 tests fallando**. Antes de anotarlo como regresión, aislé una de las suites caídas (`users-welcome-email.test.ts`) y **pasó sola: 13/13**. Después hice `npm run db:reset && npm run seed:test && npx jest`: **386 de 387 en verde**. Las 11 suites que fallaban eran contaminación de estado acumulada por mis propias corridas repetidas del día. **No hay ninguna regresión funcional** — el trabajo de la sesión de corrección está bien hecho.

**Q-B — pero eso mismo es un hallazgo, y no menor.** La suite no es idempotente: se ensucia a sí misma. Las 11 que caen son todas de caja, facturas y `factory-*`, las que dependen de datos maestros (cuentas de caja, categorías, clientes, tipos de prenda) que otras suites van modificando. `jest.config.js` ya fuerza `maxWorkers: 1` con un comentario que explica que las suites comparten una sola base, así que el problema no es paralelismo: es que **ninguna suite deja la base como la encontró**.

Por qué importa más de lo que parece: **`npm run release` corre la suite como compuerta**. Si el resultado depende de cuántas veces se corrió antes sin resembrar, la compuerta es poco confiable en las dos direcciones — puede frenar una release legítima, y sobre todo puede entrenar a quien la corra a pensar *"otra vez la base sucia"* y pasar de largo justo el día en que el rojo es real. Con la suite creciendo (48 → 55 suites, 325 → 387 tests) esto empeora solo.

La salida más barata es que `npm run release` resiembre antes de correr la suite (`npm run test:full` en vez de `npm test`), o que el `setup.ts` global garantice los datos maestros mínimos —el mismo patrón que ya se usó, bien, para `bank_transfer_*`.

**Q-A — el único test que falla contra base limpia.** `store-withdrawal-email.test.ts` › *"también avisa al administrador para que el reclamo no duerma"*: `expected 1 call, received 0`. Reproducible en aislamiento (3 de 4 tests pasan). La causa es `legal.service.ts:227-231`: el aviso al administrador sale a `LEGAL_NOTIFICATIONS_EMAIL || settings.company_email || ALERT_EMAIL_TO`, y **ninguna de las tres existe en una base recién sembrada** — `company_email` no está en `seeders/` ni en `setup.ts`. En producción sí está cargada (21 caracteres, verificado), así que **el comportamiento productivo es correcto**; lo que falla es el test.

Que haya pasado durante el release de `v1.0.1` fue casualidad: la base de desarrollo todavía tenía el valor de sesiones anteriores. Es el mismo tipo de dependencia de estado que Q-B, en versión chica.

**Cobertura nueva, y está bien orientada.** Cuatro suites de API nuevas (`store-payment-methods`, `store-public-settings`, `password-policy`, `job-alerts`) y dos de unidad (`verify-dump`, `sql-safety`). Cada corrección de la sesión tiene un test que la protege, incluido el que verifica que `'cash'` ahora se rechaza — que es exactamente lo que faltaba en el commit que originó el problema de la mañana.

**Frontend:** Vitest 47/47 verde, `tsc -b` y build OK, ESLint estable en **165 errores** (no subió con el código nuevo, que es lo que importaba). Sigue sin tests de componente. No corrí los E2E de Playwright ni pruebas de carga.

### 5.2. Ingeniero DevOps — de "no hay rollback" a rollback verificado en un día

`npm run prod`, salida literal:

```
backIndians    master   bd8b975  pkg 1.0.1
frontIndians   master   3430d18  pkg 1.0.1
último tag: v1.0.1 · 2 release(s) en la historia

OK Backend: commit bd8b975 corresponde al tag v1.0.1.
OK Frontend sistema: commit d01bdcf corresponde al snapshot v1.0.1.
OK Frontend tienda:  commit d01bdcf corresponde al snapshot v1.0.1.
OK La release tageada localmente es exactamente la que está en producción.

> Rollback
  OK objetivo seguro común: v1.0.0
  OK frontend: snapshot local v1.0.0 disponible
  OK backend: el tag existe en ambos repos
  OK base: existe backup previo al release v1.0.1
```

Los tres `XX` de la mañana son tres `OK`. Y lo más importante: **ya existe un objetivo de rollback real**, con las tres piezas (snapshot de frontend, tag de backend, backup de base) presentes y verificadas.

**R-01 — el verificador funciona, y lo probé contra el caso real.** Ejecuté `verifyDump()` sobre los cuatro dumps del disco:

```
XX  pre-limpieza-20260819-135247.sql.gz   42 tablas — gzip truncado o corrupto
OK  v1.0.0-20260819-094557.sql.gz         51 tablas
OK  v1.0.0-20260819-095900.sql.gz         51 tablas
OK  v1.0.1-20260819-165443.sql.gz         51 tablas
```

El archivo que ayer pasó por bueno hoy se rechaza. Las tres comprobaciones —gzip íntegro, trailer `-- Dump completed on`, piso de tablas configurable con `BACKUP_MIN_TABLES`— son exactamente las que distinguen un dump completo de uno cortado, y el módulo está aislado en `.cjs` para poder testearse sin base real, con justificación escrita de por qué. El backup de `v1.0.1` se tomó y verificó solo.

**R-05 — `db-exec` ya dice lo que hace.** El encabezado sincerado, `sql-safety.cjs` clasificando 11 verbos destructivos, y —el detalle que hace que sirva— `stripNoise()` saca comentarios y literales antes de buscar, para que un `SELECT ... WHERE msg = 'DROP TABLE'` no dispare un falso positivo. El comentario lo dice mejor de lo que lo diría yo: los falsos positivos *"entrenan a quien lo usa a confirmar sin leer, que es peor que no preguntar"*. La confirmación va **antes** de escribir el archivo de credenciales.

**Lo que sigue exactamente igual y es tuyo:** las 8 casillas de C7 sin marcar y `MP_WEBHOOK_SECRET` sin configurar. Que el código de `server.ts` no se haya tocado es lo correcto —subirlo a fatal antes de cargar la variable reproduce el crash-loop del 07/08—, pero la condición C1 lleva **12 días abierta**.

**R-07 sigue abierto:** los cuatro backups viven sólo en `backIndians/.releases/db/`, gitignored, en una carpeta de OneDrive.

### 5.3. Auditor de Ciberseguridad

**S-01 cerrado, y cerrado bien.** El endpoint público pasó de 75 a 68 claves y verifiqué contra producción que no queda ninguna interna: cero coincidencias con `afip_*`, `*_account_id`, `invoice_*` y `company_activity_start`. Lo importante es que **no se recortó de más**: `company_cuit`, `company_email`, `company_phone`, `company_iva_condition`, `store_data_fiscal_url` y `bank_transfer_*` siguen en la allowlist, que era el riesgo real —recortarlas rompía los textos legales y volvía a incumplir la Res. 104/2005. Los comentarios de `PUBLIC_SETTING_KEYS` explican clave por clave por qué está, y hay test de regresión. Es la diferencia entre tapar un agujero y cerrar la clase de agujero.

**S-02 cerrado**, `{10,128}` en los dos routers. El login no revalida contra el regex, así que las contraseñas existentes siguen funcionando — la decisión sobre forzar rotación quedó abierta y es tuya.

**B-02, la parte que me interesa como auditor de seguridad:** la validación quedó en los dos lados con el mismo criterio y, sobre todo, **el backend rechaza antes de reservar stock**. El comentario cita explícitamente AUD-01 como precedente (*"una defensa que vive únicamente en el cliente no es una defensa"*). Es la lección aplicada, no repetida.

**S-04b — la única regresión de postura de seguridad.** `nanoid` se resolvió, pero las dos moderadas de `react-router` **cambiaron de categoría**: ayer tenían fix sin major, hoy `npm audit` propone `react-router-dom@7`. Siguen abiertas el open redirect vía backslash en `<Link>`/`useNavigate` y la inyección de constructor en `deserializeErrors()`. Ya no es media hora: es una migración de major con revisión de todas las rutas. Conviene decidirlo pronto, porque la ventana de "fix barato" se cerró y no se va a reabrir.

**Sin cambios:** sin CSP y sin HSTS en el frontend (verificado hoy contra producción), refresh token en `localStorage`. Los tres están encadenados a la decisión que quedó pendiente.

### 5.4. Arquitecto de Software Senior

**A-01 cerrado con más rigor del que pedí.** No sólo se puso la guarda: el comentario **enumera las migraciones que respaldan cada columna que esas funciones parchean** (059, 063, 065, 066, 069, 091-095 y 098). Ese era el riesgo real de poner la guarda a ciegas —si alguna columna sólo existiera vía `ensureSchema`, producción se rompía— y se verificó en vez de asumirse.

**Q-C — degradación silenciosa en `notifyWithdrawal`.** `legal.service.ts:233` es un `if (adminEmail)` sin `else`. Si las tres fuentes faltan, el aviso al administrador no sale y **no queda registro de que no salió**. Hoy en producción `company_email` está cargada, así que funciona; pero es precisamente el patrón que D-02 acaba de corregir en los jobs —fallar sin avisar— reaparecido tres archivos más allá. Un `logger.warn` de una línea lo cierra. El aviso al consumidor sí sale siempre, que es la obligación legal; lo que se pierde es la gestión interna.

**N-01 — un solo medio de pago.** Con el efectivo desactivado y la transferencia oculta por falta de datos, la tienda productiva ofrece **únicamente MercadoPago**. No es un defecto de código —el sistema se comporta correctamente— pero sí un punto único de falla de ingresos: una caída de MP, un token vencido o un problema de cuenta deja la tienda sin forma de cobrar, sin alternativa. Se resuelve cargando los datos bancarios, que ya está en tu lista.

**Contratos de API.** Los dos cambios de esta sesión (rechazo de `bank_transfer` sin configurar, recorte de `/store/settings`) están documentados en `06-API-AND-INTEGRATIONS.md`. El recorte es *breaking* para cualquier consumidor externo del endpoint público — hoy sólo lo consume el propio frontend, así que el impacto es nulo, pero vale que quede dicho.

### 5.5. Especialista Legal y de Privacidad

**El código está listo; falta cargar cuatro valores.** Las tres páginas legales responden 200 en producción (verificado), el arrepentimiento tiene su alias corto, hay constancia de aceptación con IP y user-agent, y desde hoy el consumidor **recibe la constancia por mail con su código** — que era la obligación de la Res. 424/2020 que faltaba (L-03). El aviso al administrador también existe, con la salvedad de Q-C.

**Lo que sigue incumplido, y es configuración pura:**

- **`store_data_fiscal_url` sin fila** → el QR de Data Fiscal de ARCA (RG 4004-E) no se muestra. El soporte está completo desde ayer: clave en `VALID_KEYS`, campo en el panel, hook que lo lee.
- **`company_address` vacío** y **`company_iva_condition` sin fila** → la identificación del titular que exige la Res. 104/2005 se publica incompleta; `legalShared.tsx:112` renderiza `—` en su lugar, en los tres documentos.

Son literalmente cuatro campos en el panel de administración. Es la brecha más barata de cerrar de todo el informe y la que más expone.

**Sin cambios:** L-01 (supresión manual, sin `DELETE /me` ni purga de `store_events`) sigue como deuda aceptada con objetivo a septiembre — el canal por email que declara la política cumple la ley, pero el plazo de 5 días hábiles ahora obliga y no hay herramienta que lo asista. L-02 (transferencias internacionales a Cloudflare, MercadoPago, Cloudinary, Resend y Google) sigue sin declararse en la política de privacidad.

### 5.6. Release Manager — integración

**Dónde los roles no coinciden.**

*Sobre Q-B (la suite no idempotente).* **Calidad lo pone en `ALTO`**: la compuerta del release es la única validación automática que tiene el proyecto —no hay CI—, y una compuerta cuyo resultado depende del estado de la base de quien la corra no es una compuerta, es un ritual. **DevOps lo bajaría a `MEDIO`**: el release ya pasó dos veces, el camino documentado (`npm run test:full`) siembra antes de correr, y contra base limpia la suite es sólida. **No promedio.** Lo dejo en `ALTO` por una razón de comportamiento, no de técnica: el modo de falla entrena a ignorar el rojo, y el rojo de esta mañana —59 tests por un cambio de contrato real— es exactamente el que no hay que aprender a ignorar.

*Sobre el veredicto general.* **Seguridad y Arquitectura firmarían `GO`**: no queda ningún hallazgo de código abierto por encima de `MEDIO`, y los que quedan tienen fecha. **Calidad y Compliance sostienen el `CONDICIONADO`**: uno por Q-A/Q-B, el otro porque la tienda publica hoy una identificación fiscal incompleta. Se resuelve en la misma jornada.

**Balance de las tres pasadas.** El 18 los bloqueantes eran de contenido; el 19 a la mañana, de integridad del proceso; hoy a la tarde son de configuración y de higiene de tests. Es la progresión correcta: cada pasada encontró problemas menos graves que la anterior. Y por primera vez las correcciones no fueron sólo parches —`PUBLIC_SETTING_KEYS`, `verify-dump.cjs`, `sql-safety.cjs` y `DEC-018` cierran clases enteras de problema, no instancias.

**La prueba real de `DEC-018` todavía no ocurrió.** La regla de que todo cambio en `src/` sale por release está escrita en tres lugares del cerebro, pero el próximo cambio urgente es el que va a decir si se cumple. Hasta entonces es una intención bien documentada.

---

## 6. Camino a `GO` limpio

| # | Acción | Tiempo | Quién |
|---|---|---|---|
| 1 | **Q-A** — Sembrar `company_email` en `src/__tests__/setup.ts` (mismo patrón que `bank_transfer_*`) o fijarlo en el test | 30 min | Dev |
| 2 | **Q-C** — `logger.warn` cuando `notifyWithdrawal` se saltea el aviso al administrador | 15 min | Dev |
| 3 | **Q-B** — Que `release.mjs` corra `test:full` (siembra + suite) en vez de `test`, y/o garantizar los datos maestros mínimos en `setup.ts`. Verificar corriendo la suite **dos veces seguidas sin resembrar** | 3 h | Dev |
| 4 | **L-04 / L-05** — Cargar `store_data_fiscal_url`, `company_address` y `company_iva_condition` en el panel | 15 min | Admin |
| 5 | **B-02 / N-01** — Cargar `bank_transfer_holder`, `_cbu` y `_alias`. Devuelve el segundo medio de pago y saca a MercadoPago de punto único de falla | 15 min | Admin |
| 6 | **B-04** — `MP_WEBHOOK_SECRET` en Railway y recién ahí `server.ts:68` a fatal. Cierra C1 y DEC-014 | 1 h | DevOps |
| 7 | **D-01** — UptimeRobot contra `/health`, `ALERT_EMAIL_TO` y `CALLMEBOT_*`, y la prueba real de pausar el servicio | 1 h | DevOps |
| 8 | Release `v1.0.2` con 1, 2 y 3 — **por `npm run release`** | 30 min | Dev |

**Código: ~4 h. Configuración: ~2,5 h.** Los pasos 4 y 5 son 30 minutos en total y cierran dos incumplimientos normativos más el punto único de falla de cobro.

---

## 7. Plan de contingencia

**Por primera vez hay uno real.** `npm run rollback -- v1.0.0 --from=v1.0.1`: confirma el frontend automáticamente desde el snapshot local y guía backend y base. Las tres piezas están verificadas.

**Criterios objetivos de rollback** (sin cambios respecto de la 2ª pasada):

- Un pedido pagado sin su asiento en caja (checks 07, 14-18 del SQL de integridad).
- Divergencia de stock que el ledger no explique (checks 01, 02, 03, 06).
- Más de 10 respuestas 5xx en 5 minutos, en dos ventanas seguidas.
- `/health` en 503 más de 2 minutos.
- Checkout imposible de completar con MercadoPago — que hoy es el **único** medio operativo (N-01).

**Qué monitorear:**

| Ventana | Qué | Umbral |
|---|---|---|
| Continuo | `npm run prod` | Cualquier `XX` de drift |
| Tras cada backup | Que `verifyDump` lo apruebe | Cualquier rechazo |
| T+0 a T+2 h tras un release | `/health`: `version` y `commit` contra el tag | Diferencia |
| T+2 a T+24 h | `jobs.*Failed` en el log — **ahora también llegan por mail/WhatsApp** si C7 está configurado | Una aparición |
| T+24 h | `reportDailyInconsistencies` de las 03:00 — **ahora alerta**, no sólo loguea | Cualquier inconsistencia |
| Semanal | `auditoria-integridad-preprod.sql` | `INTEGRIDAD FALLA` |

---

## 8. Deuda aceptada

Se mantiene la lista de las pasadas anteriores (A-05/AUD-16, A-03, A-04, AUD-08/09/10/11, A-02, S-05, REV-07, I-03, L-01, R-07, camino muerto de `'cash'` en el frontend), con una incorporación y un cambio:

| ID | Con qué se convive | Por qué | Fecha objetivo |
|---|---|---|---|
| **S-04b** | react-router 6.30.x con open redirect y constructor injection | El fix pasó a exigir un major; no hay explotación conocida en las rutas del proyecto | 2026-09-30 — **decidir, no postergar por defecto** |
| **Q-01** | Sin tests de componente en el frontend | Los E2E cubren los flujos críticos | Antes del próximo refactor de checkout |

---

## 9. Preguntas abiertas

| # | Pregunta | Quién |
|---|---|---|
| 1 | ¿Migramos a `react-router-dom@7` o asumimos las dos moderadas por escrito? (S-04b — la ventana de fix barato se cerró) | Dueño + Dev |
| 2 | ¿Activamos HSTS? (C6, abierta desde el 2026-08-08) | Dueño + Dev |
| 3 | ¿Agregamos CSP al `.htaccess`? (S-03) | Dueño + Dev |
| 4 | ¿Forzamos rotación de contraseñas del staff ahora que el mínimo es 10? | Dueño |
| 5 | ¿La sesión única por usuario de staff es deliberada? (REV-07, sin respuesta desde el 08/08) | Dueño |
| 6 | ¿Están cargadas `ALERT_EMAIL_TO` y `CALLMEBOT_*` en Railway? ¿Existe el monitor de UptimeRobot? | DevOps |
| 7 | ¿`TURNSTILE_SECRET_KEY` está configurada en producción? | DevOps |
| 8 | ¿Cuándo se carga el catálogo real? La tienda está activa e indexable con **0 productos** | Dueño |

---

## 10. Falsos positivos descartados

- **"La suite tiene una regresión: 11 suites en rojo."** Descartado, y era mi lectura inicial. Aislé `users-welcome-email.test.ts` (pasó 13/13) y después corrí `db:reset` + `seed:test` + suite completa: **386/387**. Las 11 caídas eran contaminación de mis propias corridas repetidas. Queda como Q-B, que es un problema distinto y menor.
- **"Los tests fallan por paralelismo."** Descartado: `jest.config.js` ya fuerza `maxWorkers: 1`, con comentario que lo explica. Es estado acumulado en ejecución serial, no concurrencia.
- **"El aviso de arrepentimiento al administrador está roto en producción."** Descartado: falla en el test porque falta `company_email` en la base sembrada; en producción esa clave está cargada. Lo que queda es Q-C, el salteo silencioso.
- **"`setup.ts` pisa settings y por eso fallan las suites de caja."** Descartado: sólo completa `bank_transfer_*` si están vacías y no toca cuentas de caja.
- **"Se recortaron claves de más en `/store/settings` y los legales van a mostrar vacíos."** Descartado: verifiqué contra la allowlist y contra producción que `company_*`, `bank_transfer_*` y `store_data_fiscal_url` siguen expuestas. Lo que falta son los **valores**, no las claves.
- **Cabeceras de seguridad del frontend.** Siguen vivas en producción (`nosniff`, `SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`).

---

## 11. Limitaciones declaradas

- Sin acceso al panel de Railway, a UptimeRobot ni a la base productiva. Todo lo de variables de entorno queda en preguntas abiertas.
- No leí ningún `.env*`, `.env.release` ni `documentos/Users.txt`.
- Las sondas contra producción fueron **sólo `GET`/`HEAD` sobre endpoints públicos**, más `npm run prod` (que sólo hace HTTP). No ejecuté nada contra la base productiva. De `/store/settings` se reportan nombres de claves y longitudes, nunca valores.
- Los backups se verificaron con el propio `verifyDump` y con `gzip -t`. **Ninguno se restauró**: "íntegro" significa "descomprime completo, cierra con el trailer y tiene las 51 tablas", no "restaura sin errores".
- No corrí los E2E de Playwright ni pruebas de carga. La revisión de accesibilidad sigue siendo superficial.
- **La base de desarrollo quedó reseteada y sembrada** por la verificación de Q-B (`npm run db:reset`), con las credenciales del seed.

---

# VEREDICTO FINAL: `GO CONDICIONADO`

Los cuatro bloqueantes de la mañana están cerrados y los verifiqué uno por uno, no de palabra: la suite pasa 386 de 387 contra base limpia, el verificador rechaza el backup que ayer pasó por bueno, `npm run prod` no reporta drift y ofrece un rollback con sus tres piezas presentes. Cada corrección trajo su test, y varias —la allowlist de settings, la detección de SQL destructivo, la verificación de dumps— cierran la clase de problema y no sólo el caso.

Lo que falta para un `GO` limpio son unas cuatro horas de código (higiene de la suite y un test que depende de configuración no sembrada) y unos treinta minutos en el panel de administración que cierran dos incumplimientos normativos y sacan a MercadoPago de ser el único medio de cobro. Nada de eso es difícil; todo eso es lo que separa "funciona" de "está listo".

Y una observación que vale más que la lista: **la tienda sigue activa, indexable y con cero productos**. El sistema está cada vez más sano, pero todavía no vende nada. El siguiente cuello de botella ya no es técnico.
