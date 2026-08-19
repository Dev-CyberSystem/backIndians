# Prompt de corrección — hallazgos de la auditoría del 2026-08-19

> Pegar el bloque completo de abajo en una sesión nueva de Claude Code, con el working directory en `indians/`.

---

## Contexto

Sos el desarrollador a cargo del sistema **Indians** (gestión textil + tienda online B2C). Antes de tocar nada, leé `backIndians/CLAUDE.md` y `backIndians/docs/project-brain/00-INDEX.md`, y de ahí sólo los documentos que hagan falta para cada tarea.

El informe que origina este trabajo es **`backIndians/documentos/AUDITORIA_PANEL_SEIS_ROLES_2026-08-19.md`**. Leelo entero antes de empezar: cada tarea de abajo tiene su evidencia ahí. El informe del día anterior (`..._2026-08-18.md`) es el contexto previo.

**Estado de partida (verificado el 2026-08-19):**

- Ambos repos en `master`, todo pusheado. Tag `v1.0.0` en los dos.
- Producción: backend en Railway corriendo el commit `4714458`; frontend en `9f91f57`. **Los dos declaran `v1.0.0` pero ninguno es el commit del tag** — hay drift.
- **La suite del backend está en rojo: 17 suites / 59 tests fallando** (`npx jest --forceExit`). Reproducible.
- Typecheck backend limpio. Vitest frontend 47/47 verde. ESLint frontend: 165 errores preexistentes (no es tarea de esta sesión arreglarlos).
- El vaciado de datos de producción del 2026-08-19 fue **pedido y deliberado** (eran datos de prueba). No es un problema y no hay que revertirlo ni cuestionarlo.

**Objetivo de la sesión:** dejar la suite en verde, cerrar los hallazgos de seguridad y compliance que son de código, y terminar con una release `v1.0.1` tageada, desplegada y con rollback real.

---

## Reglas de trabajo (no negociables)

1. **Nunca leas ni imprimas** `.env`, `.env.*`, `.env.release`, `.env.deploy` ni `backIndians/documentos/Users.txt`. Si necesitás saber si una variable existe, comprobá presencia/longitud, nunca el valor.
2. **No toques producción por fuera del sistema de releases.** Nada de `git push origin master` con cambios en `src/`. Cada tarea va en su rama, se mergea a `master`, y el despliegue sale de `npm run release`.
3. **Una rama por bloque de tareas**, con commits en español siguiendo el estilo del repo (`fix(area): ...`, `feat(area): ...`).
4. Si una tarea implica **cambiar una regla de negocio o un contrato de API**, avisame y esperá confirmación antes de hacerla. Las tareas de abajo que ya la requieren están marcadas con ⚠️.
5. **No borres código ni datos** que no estén explícitamente listados acá.
6. Al terminar, **actualizá el cerebro documental** (`docs/project-brain/`) y `10-SESSION-HANDOFF.md`.
7. Si algo de este prompt no coincide con el código real cuando lo abras, **decímelo en vez de improvisar** — el informe es una fotografía del 2026-08-19.

---

## BLOQUE 1 — Devolver la suite a verde (prioridad absoluta)

Nada de lo demás se puede releasear hasta que esto esté hecho: `npm run release` corre la suite y aborta si falla.

### 1.1 — Arreglar los 17 archivos de test rotos

**Qué pasó:** el commit `4714458` sacó `'cash'` del validador de `payment_method` en `backIndians/src/routes/store.routes.ts:69`:

```diff
-  body('payment_method').optional().isIn(['mercadopago', 'cash', 'bank_transfer'])
+  body('payment_method').optional().isIn(['mercadopago', 'bank_transfer'])
```

Los 17 archivos de test que hacen checkout con `payment_method: 'cash'` ahora reciben `422` donde esperaban `201`:

```
audit-preprod-regressions.test.ts   cash-reversal-automatic.test.ts
purchase-flow.test.ts               checkout-idempotency.test.ts
store-cash-income.test.ts           coupon-per-customer.test.ts
expire-stale-orders.test.ts         legal.test.ts
stock-ledger.test.ts                store-returns.test.ts
checkout-quote.test.ts              report-inconsistencies-2-7.test.ts
stock-reservation.test.ts           store-order-item-size-id.test.ts
webhook-robustness.test.ts          stock-restoration.test.ts
store-tracking.test.ts
```

**Qué hacer:**

- Reemplazar `payment_method: 'cash'` por `'bank_transfer'` en esos archivos. **Ojo con dos casos que no son un reemplazo mecánico:**
  - `store-cash-income.test.ts` y `cash-reversal-automatic.test.ts` prueban específicamente que un pedido en efectivo genera su asiento en la cuenta de caja de efectivo (`store_cash_account_id`). Con `bank_transfer` el asiento va a `store_bank_account_id`. Adaptá la expectativa a la cuenta correcta, **no cambies la lógica de negocio para que el test pase**.
  - `audit-preprod-regressions.test.ts` es la red de regresión de las cuatro P1 de agosto (AUD-01/02/03/15). Cambiá lo mínimo indispensable para que vuelva a correr: su valor está en lo que verifica, no en el medio de pago que usa.
- **Agregar un test nuevo** que verifique que `POST /store/checkout` con `payment_method: 'cash'` devuelve **422**. Es lo que debería haber acompañado al commit original: sin él, mañana alguien reactiva `'cash'` y nadie se entera.
- Revisar si quedó algún test que dependa del flujo de efectivo de la tienda y que ahora no tenga sentido; si lo hay, **avisame antes de borrarlo**.

**Criterio de aceptación:** `npx jest --forceExit` → 48 suites / 326+ tests, **0 fallas**. Corrélo dos veces.

### 1.2 — Limpiar el camino muerto de `'cash'` en el frontend

En `frontIndians/src/pages/store/StoreCheckoutPage.tsx` la opción ya no se ofrece (líneas 48-49), pero el tipo y las ramas siguen vivas: líneas 42, 150, 196, 417.

⚠️ **Antes de tocarlo, preguntame si la desactivación del pago en efectivo es definitiva o temporal.**
- Si es **definitiva**: sacá el camino muerto por completo (tipo `PaymentMethod`, ramas, textos).
- Si es **temporal**: dejalo, pero agregá un comentario que explique por qué está ahí y qué hay que tocar en el backend (`store.routes.ts:69`) para reactivarlo. Es una trampa esperando: hoy la UI y el validador pueden desincronizarse sin que nada avise.

**No toques** el manejo de `'cash'` en `store.service.ts` ni el ENUM de la base: los pedidos históricos con ese método tienen que seguir funcionando.

---

## BLOQUE 2 — Recuperar la capacidad de rollback

### 2.1 — Endurecer la verificación del backup (R-01, `BLOQUEANTE`)

**Qué pasó:** `backIndians/.releases/db/pre-limpieza-20260819-135247.sql.gz` está truncado: descomprime 142.263 bytes, corta a mitad de un `INSERT` de `store_events` y le faltan 9 tablas enteras (`store_orders`, `store_order_items`, `store_order_status_history`, `store_return_items`, `store_returns`, `store_wishlist`, `store_withdrawal_requests`, `users`, `webhook_events`). **`db-backup.mjs` lo dio por bueno**: el `pipeline` resolvió limpio, `mysqldump` no devolvió código distinto de cero, y el archivo superó el chequeo de tamaño.

Comprobalo vos mismo antes de arreglar nada, para entender el modo de falla:

```bash
cd backIndians/.releases/db
for f in *.sql.gz; do echo "--- $f"; gzip -t "$f" && echo OK; done
gzip -dc pre-limpieza-*.sql.gz 2>/dev/null | tail -c 120
gzip -dc v1.0.0-20260819-095900.sql.gz 2>/dev/null | tail -c 120
```

**Qué hacer en `backIndians/scripts/release/db-backup.mjs`**, después de escribir el archivo y antes de declarar éxito:

1. Verificar la integridad del gzip (`gzip -t` o descomprimir con `zlib` en streaming y comprobar que no lanza).
2. Verificar que el contenido descomprimido **termina con el trailer de mysqldump** (`-- Dump completed on`). Es lo único que distingue un dump completo de uno cortado.
3. Verificar que la cantidad de `-- Table structure for table` es **la esperada** — compará contra un conteo de tablas de la base, o como mínimo contra un piso configurable, y avisá si bajó respecto del backup anterior.
4. Si cualquiera de las tres falla: **borrar el archivo y abortar con un mensaje claro**. Un backup roto que se conserva es peor que ninguno, porque genera confianza falsa.

Agregá tests para la lógica de verificación (podés probarla contra un `.sql.gz` truncado a propósito, sin necesidad de base real).

**No borres** los tres backups que están en `.releases/db/`. El `pre-limpieza` roto queda como evidencia hasta que confirmes conmigo.

### 2.2 — Sincerar `db-query.mjs` (R-05, `ALTO`)

`backIndians/scripts/release/db-query.mjs` dice en su primera línea *"Corre un archivo .sql de SOLO LECTURA contra la base de PRODUCCIÓN"*. **No hay nada que lo restrinja**: hace `spawnSync(mysql, ..., { input: readFileSync(sqlFile) })` y ejecuta cualquier cosa. De hecho es la herramienta con la que se ejecutó el `TRUNCATE` de ~40 tablas productivas (`prod-cleanup-2026-08-19.sql:9` documenta ese uso).

**Qué hacer** — elegí una de las dos y decime cuál:

- **Opción A (recomendada):** renombrar el script a `db-exec.mjs` / `npm run db:exec`, corregir el encabezado para que diga lo que realmente hace, y **exigir confirmación interactiva explícita** cuando el SQL contenga DDL o DML destructivo (`TRUNCATE`, `DROP`, `DELETE`, `UPDATE`, `ALTER`) — mostrando antes las sentencias detectadas y la base de destino. Un flag `--yes` para uso no interactivo, igual que `release.mjs`.
- **Opción B:** dejar `db:query` restringido de verdad a `SELECT`/`SHOW`/`EXPLAIN` (rechazando cualquier otra sentencia) y crear `db:exec` aparte para lo destructivo.

El manejo de credenciales actual está bien (`--defaults-extra-file` con `mode 0o600` y borrado en `finally`) — **no lo toques**.

### 2.3 — Poner en git lo que no está (R-06, `ALTO`)

`git status` en `backIndians` muestra sin trackear:

- `scripts/release/db-query.mjs`
- `scripts/release/prod-cleanup-2026-08-19.sql` ← **el script que vació producción**
- `package.json` modificado (agrega `db:query`)

La operación más destructiva del proyecto no tiene historia. Commiteá los tres (con el rename de 2.2 si elegiste la opción A). El `.sql` de limpieza va commiteado **tal cual se ejecutó**, como registro histórico — no lo reescribas ni lo "mejores".

También está sin trackear `documentos/AUDITORIA_PANEL_SEIS_ROLES_2026-08-18.md` y el del 19: commitealos junto con el resto de la documentación.

---

## BLOQUE 3 — Seguridad y compliance (código)

### 3.1 — Allowlist en el endpoint público de settings (S-01, `CRÍTICO`)

`GET /api/v1/store/settings` es **público, sin autenticación y cacheado 60 s como `public`**, y devuelve **las 75 claves** de la tabla `settings`. La causa está en `backIndians/src/services/store.service.ts:335-341`:

```js
export async function getPublicStoreSettings(): Promise<Record<string, string>> {
  return cached('store:settings', 60_000, async () => {
    const rows = await Settings.findAll();   // ← sin where
    return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
  });
}
```

Su hermano interno, `getAllSettings()` en `settings.service.ts:73`, sí filtra por `VALID_KEYS`.

**El problema es de diseño, no de contenido de hoy**: es una lista negra por omisión. El día que se agregue una credencial de courier (Andreani está en el backlog) a `VALID_KEYS`, queda publicada en internet sin que nadie toque este archivo.

**Qué hacer:**

- Definir un `PUBLIC_SETTING_KEYS` explícito y filtrar por él.
- **Cuidado, esto es lo importante:** varias claves que *suenan* sensibles **tienen que seguir siendo públicas**, porque los textos legales las necesitan y la normativa exige publicarlas. Derivá la lista de los consumidores reales antes de recortar:
  - `frontIndians/src/pages/store/legal/useLegalInfo.ts` → `company_name`, `company_cuit`, `company_address`, `company_email`, `company_phone`, `company_iva_condition`, `store_data_fiscal_url`, `store_whatsapp`
  - `frontIndians/src/pages/store/StoreLandingPage.tsx` → todo el bloque `store_*` (hero, carrusel, spotlight, promo, marquee…)
  - `frontIndians/src/pages/store/StoreCheckoutFlowPages.tsx` y `StoreAccountPage.tsx` → `bank_transfer_cbu`, `bank_transfer_alias`, `bank_transfer_holder`
  - `shipping_cost`, `free_shipping_min`, `store_active`, `tracking_link_expiry_days`, `store_chatbot_*`
- Lo que **sí hay que sacar**: `afip_enabled`, `afip_environment`, `afip_punto_venta`, `afip_concepto_default`, `store_cash_account_id`, `store_bank_account_id`, `invoice_due_days`, `invoice_point_of_sale`, `invoice_default_type`, `company_activity_start`, `company_website` (salvo que algún componente lo use — verificalo).
- **Agregá un test que falle si una clave que no está en `PUBLIC_SETTING_KEYS` aparece en la respuesta.** Es lo que evita la regresión el día de Andreani.
- Después del cambio, **probá las tres páginas legales y la landing en el navegador**: si recortás de más, los textos legales pierden la identificación del titular y volvés a incumplir la Res. 104/2005.

### 3.2 — Contraseñas de staff (S-02, `ALTO`)

`PWD_REGEX` topea en **10 caracteres** en `backIndians/src/routes/auth.routes.ts:9` y `src/routes/user.routes.ts:9`. Los compradores de la tienda tienen `min: 6, max: 100` (`store.routes.ts:115`). O sea: el comprador puede usar una passphrase, el administrador que mueve la caja no. No hay razón técnica — bcrypt corta a 72 bytes.

**Qué hacer:** subir a `{10,128}` en ambos archivos y actualizar `PWD_MSG`. El login **no** revalida contra el regex, así que las contraseñas actuales de 6-10 caracteres siguen funcionando; el cambio sólo aplica al crear o cambiar una.

⚠️ **Preguntame** si querés además forzar rotación de las contraseñas existentes (se puede con `session_version`, pero es una decisión de negocio: expulsa a todos los usuarios).

### 3.3 — `ensureSchema` no debe correr en producción (A-01, `ALTO`)

`backIndians/src/server.ts:85-86` llama a `ensureSchema()` **y** `ensureLegalSchema()` sin ninguna guarda de entorno. Las dos hacen DDL real (`addColumn`, `removeIndex`, `addIndex`). En producción, cada reinicio del contenedor puede alterar el esquema sin quedar registrado en `SequelizeMeta`. `config/db.ts:55` sí tiene la guarda correcta — el patrón se replicó en vez de corregirse.

**Qué hacer:** envolver las dos llamadas en `if (process.env.NODE_ENV !== 'production')`, con un comentario que explique por qué (son parches para el flujo de `sync()` de desarrollo; producción usa migraciones).

**Verificá antes** que las columnas que esos dos archivos parchean tengan su migración correspondiente aplicada — si alguna sólo existe vía `ensureSchema`, poner la guarda la rompe en producción. Prestá atención a `store_customers.terms_accepted_at` / `terms_version` (migración `098`) y a las columnas de `garment_types`.

### 3.4 — Alertar cuando falla un job (D-02, `ALTO`)

`sendAlert` se invoca **desde un solo lugar**: `backIndians/src/utils/errorRateMonitor.ts:45` (errores 5xx). Los tres jobs de `src/jobs/scheduler.ts:23-48` capturan su excepción y sólo hacen `logger.error`.

Consecuencia concreta: `reconcilePendingPayments` es hoy **el único camino por el que se acreditan los pagos de MercadoPago** (el webhook está deshabilitado, ver 4.1). Si se rompe, los pagos dejan de acreditarse y nadie recibe un aviso. Es la forma exacta del incidente del 2026-08-07.

**Qué hacer:** enganchar `sendAlert` en los tres `catch` de `scheduler.ts` con una `key` distinta por job (para que el cooldown funcione por separado), y también en `reportDailyInconsistencies` cuando **encuentre** inconsistencias (hoy sólo las loguea — está anotado como pendiente en `documentos/ALERTAS_Y_MONITOREO.md:139-140`). Agregá tests siguiendo el patrón de `src/__tests__/api/alerts.test.ts`.

### 3.5 — Dependencias del frontend (S-04, `MEDIO`)

`npm audit` en `frontIndians`: 1 alta (`nanoid`, loop infinito con `size` 0) y 2 moderadas (`react-router` / `react-router-dom`: open redirect vía backslash en `<Link>`/`useNavigate`, y *arbitrary constructor injection* en `deserializeErrors()`). **Las tres tienen fix sin cambio mayor.**

**Qué hacer:** `npm audit fix`, y después probar en el navegador la navegación de la tienda y del panel (es react-router: si algo se rompe, se rompe en las rutas). Correr Vitest y el build.

Las 4 moderadas del backend vienen de `uuid` transitivo de `sequelize` y `autocannon`; el fix exige un major de Sequelize. **No las toques.**

---

## BLOQUE 4 — Compliance de la tienda

### 4.1 — Constancia de arrepentimiento por mail (L-03, `ALTO`)

`POST /store/legal/withdrawal` genera un `code` correlativo y lo devuelve en pantalla, pero **no envía ningún mail**. La Res. 424/2020 exige que el proveedor envíe al consumidor la constancia del arrepentimiento **dentro de las 24 horas**.

**Qué hacer:** mandar el mail al `customer_email` del formulario usando `emailQueue` (desacoplado, como el resto de los mails de estado), con el código, la fecha y los datos del titular. Respetá `mailGuard` — no debe salir bajo Jest ni hacia dominios de prueba. Avisá también al administrador (hay bandeja en `/ecommerce/legal`, pero un mail evita que el reclamo duerma).

### 4.2 — Ocultar transferencia bancaria si no está configurada (B-02, `BLOQUEANTE`)

En producción, `bank_transfer_cbu`, `bank_transfer_alias` y `bank_transfer_holder` están **vacíos**, y el checkout igual ofrece el medio de pago (`frontIndians/src/pages/store/StoreCheckoutPage.tsx:48-49`). El comprador crea el pedido, **reserva stock**, y aterriza en una pantalla que le muestra un mensaje dirigido al administrador (`StoreCheckoutFlowPages.tsx:167-183`). Con el efectivo desactivado, es **uno de los dos únicos medios de pago**.

**Qué hacer:**

- **Frontend:** no ofrecer `bank_transfer` en el selector si las tres claves vienen vacías de `/store/settings`. Si eso deja **cero** medios de pago disponibles, mostrar un aviso claro de "la tienda no puede procesar pagos en este momento" en lugar de dejar completar el checkout.
- **Backend:** rechazar en `POST /store/checkout` un `payment_method: 'bank_transfer'` cuando los datos bancarios no estén configurados. La defensa del frontend sola no alcanza — es la misma lección de AUD-01. Con test.
- La carga de los datos bancarios reales es tarea mía (ver "Tareas para mí" abajo), pero el código tiene que aguantar que falten.

---

## BLOQUE 5 — Release

**Sólo cuando los bloques 1 a 4 estén mergeados a `master` y la suite en verde.**

1. Correr `npm run prod` y confirmar el estado de partida.
2. `cd backIndians && npm run release -- patch`.
3. Verificar que `npm run prod` deja de reportar drift en los tres componentes (backend, sistema, tienda) y que ya existe una release anterior a la cual volver.
4. Humo en producción: `/health` con la versión nueva, login del panel, la tienda cargando, y las tres páginas legales respondiendo.

**Por qué este paso importa tanto:** hoy `npm run prod` reporta que **no hay ninguna versión a la que volver** (v1.0.0 es la única release), y que el snapshot de frontend guardado para `v1.0.0` es el commit `36dc6fc` mientras producción corre `9f91f57`. Un `npm run rollback -- v1.0.0` hoy **republicaría un frontend que todavía ofrece el pago en efectivo**. La release `v1.0.1` resuelve las cuatro cosas de una vez: drift de backend, drift de frontend, snapshot alineado y backup verificado con la lógica nueva de 2.1.

**Regla permanente que quiero que quede escrita en el cerebro:** de acá en adelante, todo cambio en `src/` va por `npm run release`. `git push origin master` queda sólo para documentación. El sistema se construyó el 2026-08-19 a la mañana y el primer cambio de la tarde lo esquivó — así no sirve de nada.

---

## BLOQUE 6 — Documentación

- Actualizar `docs/project-brain/10-SESSION-HANDOFF.md` con lo hecho, lo que quedó y cómo retomar.
- Si tocaste contratos de API (3.1, 4.2), actualizar `06-API-AND-INTEGRATIONS.md`.
- Si tocaste reglas de negocio (1.2 con efectivo definitivo, 4.2), actualizar `03-BUSINESS-RULES.md`.
- Registrar en `08-DECISIONS.md`: la desactivación del pago en efectivo, la decisión sobre `db-query`/`db-exec`, y la regla de "todo cambio de `src/` va por release".
- Actualizar `09-CURRENT-STATUS.md` con el estado de los hallazgos cerrados.
- En `documentos/ALERTAS_Y_MONITOREO.md`, marcar lo que corresponda de la sección "Qué NO cubre" si 3.4 lo resolvió.

---

## Validación final (correr todo, pegarme la salida)

```bash
cd backIndians
npm run typecheck          # 0 errores
npx jest --forceExit       # 48+ suites, 0 fallas — correr dos veces
npm run prod               # sin drift, con release anterior disponible

cd ../frontIndians
npm run lint               # que NO suba de 165 errores
npm test                   # 47+ tests verdes
npm run build              # exit 0
```

Además, probá **en el navegador** (Vitest no cubre componentes):
- Las tres páginas legales de la tienda, con y sin datos de empresa cargados.
- El checkout de la tienda con y sin datos bancarios configurados.
- La landing de la tienda después del recorte de settings (3.1).

---

## Tareas que son mías, no tuyas — recordámelas al terminar

No son de código; van en Railway o en el panel de administración:

1. **`MP_WEBHOOK_SECRET` en Railway** y volver `backIndians/src/server.ts:68` a fatal (condición C1, abierta desde el 2026-08-07). El código lo podés dejar preparado, pero **no lo subas a fatal hasta que yo confirme que la variable está cargada** — si no, el servicio entra en crash-loop, que es exactamente el incidente que originó la medida temporal.
2. **Cargar en Settings → Empresa:** `company_address` (hoy vacío, los legales muestran "—") y `company_iva_condition`.
3. **Cargar en Settings → Tienda online:** `store_data_fiscal_url` (el QR de Data Fiscal de ARCA, RG 4004-E — el soporte ya está en código y el campo existe en el panel) y los datos de `bank_transfer_*`.
4. **Reconfirmar las cuentas de caja** de la tienda: `store_cash_account_id` y `store_bank_account_id`. La limpieza del 2026-08-19 reseteó a cero los saldos de las cuentas 1, 2 y 3.
5. **Dar de alta el monitoreo (C7)**: UptimeRobot contra `/health`, `ALERT_EMAIL_TO` y `CALLMEBOT_*` en Railway, y la prueba real de pausar el servicio. Las 8 casillas de `documentos/ALERTAS_Y_MONITOREO.md:148-155` siguen sin marcar.
6. **Copia de los backups fuera de esta máquina.** Hoy viven sólo en `backIndians/.releases/db/`, gitignored, en una carpeta de OneDrive.

---

## Decisiones que necesito tomar yo — preguntámelas cuando llegues a cada una

1. ¿El pago en efectivo se desactiva en forma definitiva? (tarea 1.2)
2. ¿`db-query` pasa a `db-exec` con confirmación, o se restringe de verdad a solo lectura? (tarea 2.2)
3. ¿Fuerzo rotación de contraseñas del staff al subir el mínimo a 10? (tarea 3.2)
4. ¿Activamos HSTS en el frontend? (condición C6, abierta desde el 2026-08-08; es difícil de revertir porque el navegador la cachea meses)
5. ¿La sesión única por usuario de staff es deliberada? Hoy loguearse en el celular expulsa la sesión de la PC; la tienda sí permite sesiones concurrentes (REV-07, sin respuesta desde el 08/08)

---

## Fuera de alcance de esta sesión

No las toques salvo que te lo pida:

- Los 165 errores de ESLint del frontend.
- Tests de componentes React (deuda reconocida).
- `DELETE /me` y purga de `store_events` (L-01) — la política de privacidad ofrece canal por email, que cumple; queda para septiembre.
- CSP en el frontend (S-03) y HSTS (C6) — dependen de la decisión 4.
- AUD-05/07/08/09/10/11/13/14/16, A-02 (rate limit en memoria), A-03 (`STORE_ORDER_TRANSITIONS` duplicado), A-05 — backlog aceptado, con fechas en la sección 7 del informe.
- Integración con Andreani.
