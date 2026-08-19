# Auditoría de panel — seis roles independientes

**Fecha:** 2026-08-18 · **Alcance:** `backIndians` + `frontIndians` (rama `master` en ambos, working tree limpio, todo pusheado)
**Método:** lectura del cerebro documental y las auditorías previas, luego verificación contra el código real, la suite de tests y **la producción viva** (sondas HTTP de solo lectura contra `indians.com.ar`, `sistema.indians.com.ar` y `backindians-production.up.railway.app`).

---

# VEREDICTO: `NO-GO` PARA LA APERTURA PÚBLICA DE LA TIENDA · `GO` PARA EL SISTEMA DE GESTIÓN

**Primero, una corrección de premisa que cambia la pregunta.** No hay un release pendiente para mañana: ambos repos están pusheados, el backend está desplegado y sano en Railway, y el frontend se subió **hoy a las 21:00 UTC** (`Last-Modified` de `indians.com.ar`). Lo que hay que decidir no es "si sale", sino **si lo que ya está afuera puede quedarse afuera**. Y la respuesta, para la tienda, es no.

La tienda está `store_active=true`, indexable (`Allow: /`, sitemap publicado) y vendiendo **cuatro productos de prueba a entre 5 y 50 pesos** con stock real y checkout funcionando. En paralelo, el medio de pago "Transferencia bancaria" está ofrecido en el checkout pero **sin CBU, alias ni titular cargados en producción**: el comprador crea el pedido, reserva stock y aterriza en una pantalla que le dice *"Completá los datos bancarios en el panel de administración"*. Y no existe ni política de privacidad, ni términos y condiciones (aunque el registro afirma que el usuario los acepta), ni botón de arrepentimiento, ni Data Fiscal. Nada de esto es deuda técnica: son tres formas distintas de perder plata o quedar expuesto legalmente el mismo día en que alguien encuentre el sitio. **El sistema de gestión interno, en cambio, está sólido**: 47 suites / 313 tests en verde, typecheck limpio, autorización correcta en los 18 routers, y las cuatro P1 de la auditoría del 2026-08-08 efectivamente cerradas y con test de regresión.

---

## 2. Resumen ejecutivo

1. **El backend productivo está vivo y sano** (`/health` → 200, `database: ok`, HSTS y cabeceras de helmet activas).
2. **La tienda está abierta al público con datos de prueba.** 4 productos, precios de $5 a $50, stock real, comprables. Verificado hoy contra la API productiva.
3. **Un medio de pago está roto de cara al cliente.** Transferencia bancaria: sin datos de cuenta cargados; el comprador ve un mensaje interno de administración.
4. **No hay ningún texto legal.** Sin privacidad, sin términos (que el registro dice que se aceptan), sin botón de arrepentimiento (Res. SCI 424/2020), sin Data Fiscal (RG AFIP 4004-E), sin forma de dar de baja la cuenta (Ley 25.326).
5. **La condición C1 de la auditoría anterior sigue abierta 10 días después.** `MP_WEBHOOK_SECRET` no está configurado; el chequeo sigue en "modo emergencia" y los pagos de MercadoPago se acreditan por un job cada 10 minutos, no por webhook.
6. **Hallazgo nuevo de exposición de datos**: el endpoint público `GET /store/settings` devuelve **las 75 claves** de la tabla `settings` sin filtro alguno — CUIT, mail y teléfono de la empresa, config de AFIP, IDs de cuentas de caja. Y está cacheado 60 s como `public`.
7. **Contraseñas del staff topeadas en 10 caracteres.** Señalado el 2026-08-08 como AUD-04, sigue igual.
8. **El monitoreo está escrito pero no dado de alta.** Las 8 casillas del checklist de C7 siguen sin marcar; y las alertas sólo cubren errores 5xx: si se rompe el job de conciliación de pagos, nadie se entera.
9. **No hay CI/CD.** Ningún `.github/` en ninguno de los dos repos. Todo se valida a mano.
10. **El deploy del frontend no es atómico ni reversible**: FTP en claro por defecto, sin conservar el `dist` anterior, con validación de certificado desactivada.
11. **Cero tests de componentes React** y 161 errores de ESLint preexistentes.
12. **Cloudflare está delante del sitio y no figura en la documentación** — el `robots.txt` que se sirve no es el del repo.
13. Lo que está bien y conviene no romper: autorización por rol, ledger de stock, idempotencia de checkout, dos JWT separados, logging estructurado, y una cultura de auditoría con tests de regresión que efectivamente fallan contra el código viejo.
14. **Costo de los bloqueantes: ~11 h de trabajo técnico** + el tiempo legal de redactar los textos (externo).
15. Recomendación: bajar `store_active` o poner el sitio en `noindex` **hoy**, y reabrir cuando los cuatro bloqueantes estén cerrados.

---

## 3. Tabla consolidada de hallazgos

| ID | Área | Rol | Criticidad | Evidencia | Riesgo (prob × impacto) | Detección | Esfuerzo |
|---|---|---|---|---|---|---|---|
| **B-01** | Datos productivos | QA / Arq. | `BLOQUEANTE` | API prod: 4 productos, `price` 5–50, `stock` 2–8, `show_in_store:true`, `store_active:"true"` | Alta × Alto (dinero + stock real + reputación) | Sólo al ver el pedido | 0,5 h |
| **B-02** | Pagos | QA / Arq. | `BLOQUEANTE` | `settings` prod: `bank_transfer_cbu/alias/holder` vacíos; `StoreCheckoutPage.tsx:43` ofrece el medio; `StoreCheckoutFlowPages.tsx:180` muestra texto de admin al cliente | Alta × Alto (venta perdida + stock reservado 48 h) | Sólo si el cliente reclama | 2 h |
| **B-03** | Legal | Compliance | `BLOQUEANTE` | `src/router/index.tsx` sin rutas legales; `StoreAuthPage.tsx:343` afirma aceptación de términos inexistentes | Media × Muy alto (multa AAIP / Defensa del Consumidor) | Semanas o meses | 4 h dev + legal |
| **B-04** | Pagos / DevOps | DevOps / Seg. | `BLOQUEANTE` | `server.ts:56-73` sigue en medida temporal; C1 abierta desde 2026-08-07 | Alta × Medio (demora de 10 min en acreditar) | Ya ocurrió (DEC-014) | 1 h |
| **S-01** | Exposición de datos | Seguridad | `CRÍTICO` | `store.service.ts:335-341` → `Settings.findAll()` sin allowlist; verificado: 75 claves públicas, `Cache-Control: public, max-age=60` | Media × Alto (hoy fuga menor; mañana, la primera clave sensible que se agregue) | Nunca | 1 h |
| **S-02** | Autenticación | Seguridad | `ALTO` | `auth.routes.ts:9`, `user.routes.ts:9` → `{6,10}` | Media × Alto (cuentas admin) | Nunca | 1 h |
| **D-01** | Observabilidad | DevOps | `ALTO` | `ALERTAS_Y_MONITOREO.md:148-155`, 8 casillas sin marcar | Media × Muy alto (repetir el incidente del 07/08) | — | 1 h |
| **D-02** | Observabilidad | DevOps | `ALTO` | `sendAlert` sólo se invoca desde `errorRateMonitor.ts:45`; `scheduler.ts:23-48` sólo loguea | Media × Alto (pagos sin acreditar en silencio) | Semanas | 1 h |
| **A-01** | Base de datos | Arquitecto | `ALTO` | `server.ts:85` llama `ensureSchema()` sin guarda de `NODE_ENV`; `db.ts:55` sí la tiene | Baja × Alto (DDL en cada arranque de prod) | Sólo si falla | 0,5 h |
| **S-03** | XSS / sesión | Seguridad | `ALTO` | Verificado en prod: `indians.com.ar` no manda CSP; refresh token en `localStorage` (`authStore.ts:29`) | Baja × Muy alto | Nunca | 3 h |
| **Q-01** | Testing | QA | `ALTO` | 3 archivos Vitest (sólo utils); 161 errores ESLint | Alta × Medio | — | Continuo |
| **L-01** | Privacidad | Compliance | `ALTO` | `store_events` sin purga (`scheduler.ts`); sin `DELETE /store/me` en `store.routes.ts` | Media × Alto | Ante un reclamo | 4 h |
| **S-04** | Dependencias | Seguridad | `MEDIO` | `npm audit`: react-router (open redirect + constructor injection), nanoid HIGH — fix disponible | Baja × Medio | — | 0,5 h |
| **S-05** | Anti-bot | Seguridad | `MEDIO` | `turnstile.ts:32-42` y `:78-85` → fail-open sin secret y ante error de red | Media × Bajo | Al ver spam | 0,5 h |
| **S-06** | Recupero de clave | Seguridad | `MEDIO` | `auth.service.ts:112-121` → token `uuidv4` guardado en claro | Baja × Alto | Nunca | 1 h |
| **S-07** | Uploads | Seguridad | `MEDIO` | `upload.routes.ts:21` → `folder` del body sin validar; mimetype declarado por el cliente | Baja × Bajo | — | 0,5 h |
| **D-03** | Deploy | DevOps | `MEDIO` | `deploy-ftp.mjs:66-85`: `FTP_SECURE` default `false`, `rejectUnauthorized:false`, sin backup del `dist` previo, subida no atómica | Media × Alto (rollback imposible) | Minutos | 2 h |
| **D-04** | CI/CD | DevOps | `MEDIO` | No existe `.github/` en ninguno de los dos repos | Alta × Medio | — | 4 h |
| **D-05** | Topología | DevOps | `MEDIO` | `Server: cloudflare` en ambos dominios; `robots.txt` servido ≠ el del repo (bloque *Cloudflare Managed*) | Media × Medio | — | 1 h |
| **D-06** | Migraciones | DevOps | `MEDIO` | `railway.toml:6` → `npm run migrate` en cada arranque (AUD-13); C4 depende de recordarlo | Baja × Alto | Al fallar el deploy | 2 h |
| **A-02** | Escalado | Arquitecto | `MEDIO` | `rateLimit.ts` y `errorRateMonitor.ts` con estado en memoria | Baja × Medio (sólo si se suma réplica) | — | 3 h |
| **A-03** | Acoplamiento | Arquitecto | `MEDIO` | `storeOrderFlow.ts` ↔ `frontIndians/src/api/store.ts` duplicados | Media × Medio | Al desincronizarse | 2 h |
| **A-04** | Recuperación | Arquitecto / DevOps | `MEDIO` | Tabla `products` sin migración (AUD-07): el esquema no se reconstruye sólo con `npm run migrate` | Baja × Alto (en un DR) | Sólo en el desastre | 1 h |
| **A-05** | Datos | Arquitecto | `MEDIO` | AUD-16: `catalog_products.stock_quantity` diverge de la suma de talles | Alta × Bajo | Ya ocurre | 3 h |
| **L-02** | Privacidad | Compliance | `MEDIO` | Cloudflare, MercadoPago, Cloudinary, Resend, Google — transferencias internacionales sin declarar | Media × Medio | Ante un reclamo | Con B-03 |
| **REV-07** | Sesiones | Arq. / QA | `MEDIO` | `loginService` incrementa `session_version` en cada login → una sola sesión por usuario staff | Alta × Bajo (fricción diaria) | Primer día de uso | Decisión |
| **C6** | Transporte | Seguridad | `MEDIO` | Verificado: sin `Strict-Transport-Security` en `indians.com.ar` ni `sistema.` (sí en la API) | Baja × Medio | Nunca | 0,5 h + decisión |
| **AUD-10** | Sesión tienda | Seguridad | `BAJO` | `storeAuth.ts:14-26` no revalida `active`/`session_version` | Baja × Bajo (ventana 15 min) | Nunca | 1 h |
| **AUD-09** | Webhook MP | Seguridad | `BAJO` | Sin validación de frescura del `ts`; mitigado por idempotencia | Baja × Bajo | Nunca | 1 h |
| **I-01** | Logs | Seguridad | `BAJO` | `logs.routes.ts:18` público, `context` arbitrario y `operationName` sin sanear | Media × Bajo (ruido/costo) | Al ver el log | 0,5 h |
| **AUD-08** | Esquema | Arquitecto | `BAJO` | `order_items.color` 150 (modelo) vs 100 (migración) | Baja × Bajo | Al truncar | 0,5 h |
| **Q-02** | a11y | QA | `BAJO` | 2 de 19 `<img>` de tienda sin `alt` | Alta × Bajo | — | 0,5 h |
| **I-02** | Datos | QA | `INFORMATIVO` | Producto 3: `price:5` / `public_price:11`; envío $10.000 con productos de $11 | — | — | Con B-01 |
| **I-03** | Proceso | QA | `INFORMATIVO` | `f0373b8` eliminó el bloqueo por checklist en los 6 controles: se perdió una compuerta de calidad (decisión explícita del cliente, documentada en BR-ORDER-005) | — | — | — |

---

## 4. Detalle por rol

### 4.1. Auditor de Ciberseguridad

**Lo que está bien, verificado línea por línea.** Los 18 routers tienen autenticación: 10 con `router.use(authenticate)` global y los 4 restantes (`auth`, `dashboard`, `settings`, `user`) la aplican por ruta o con `router.use(authenticate, authorize(...))` — no hay ni un endpoint interno colgado sin protección. La autorización por rol es un factory limpio (`authorize.ts`) y el *scoping* del vendedor está bien hecho: `order.service.ts:389-391` fuerza `seller_id` en el listado y `:415` y `:537` lo revalidan en el detalle y la edición. El aislamiento de los dos JWT se sostiene: `store.auth.service.ts:277` rechaza explícitamente tokens del sistema aunque `STORE_JWT_SECRET` caiga a `JWT_SECRET`. Los limitadores de tasa son once, granulares y bien razonados. `trust proxy` está en `1`, numérico, no `true`.

**Inyección SQL: descartada.** Los 20 usos de `sequelize.literal()` / `sequelize.query()` son constantes o pasan por `sequelize.escape()` — verifiqué el caso más expuesto (`store.service.ts:181`, filtro de talle desde querystring) y está escapado. `catalog.service.ts:46` interpola `${year}`, que viene de `new Date().getFullYear()`. Coincide con §4.4 de la auditoría anterior.

**S-01 — el hallazgo nuevo.** `getPublicStoreSettings()` (`store.service.ts:335-341`) hace `Settings.findAll()` **sin `where`** y devuelve todo. Su hermano interno, `getAllSettings()` (`settings.service.ts:73`), sí filtra por `VALID_KEYS`. Verificado contra producción: el endpoint público devuelve 75 claves, entre ellas `company_cuit`, `company_email`, `company_phone`, `afip_enabled`, `afip_environment`, `store_cash_account_id` y `store_bank_account_id`. Hoy el daño es acotado: el CUIT es semipúblico y los datos bancarios están vacíos. **El problema real es de diseño, no de contenido**: es una lista negra por omisión. El día que alguien agregue una clave de API de un courier o un token a `VALID_KEYS` — que es exactamente lo que va a pasar con la integración de Andreani — queda publicada en internet y cacheada 60 segundos, sin que nadie toque una línea de este archivo. *Hecho verificado.*

**S-02 — contraseñas de 10 caracteres máximo.** `PWD_REGEX` en `auth.routes.ts:9` y `user.routes.ts:9` topea en `{6,10}`. Los compradores de la tienda tienen `min:6, max:100` (`store.routes.ts:115`). O sea: el comprador puede usar una passphrase; el administrador que mueve la caja, no. No hay razón técnica — bcrypt corta a 72 bytes, muy por encima. Señalado como AUD-04 hace 10 días, sigue igual. *Hecho verificado.*

**S-03 — CSP ausente + token en `localStorage`.** Sondeé producción: `indians.com.ar` y `sistema.indians.com.ar` devuelven `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` (el `.htaccess` de AUD-06 funciona, C5 confirmada), pero **no hay `Content-Security-Policy`**. El único `dangerouslySetInnerHTML` (`JsonLd.tsx:29`) está escapado con `safeJsonLd`, así que hoy no hay XSS conocido. Pero el refresh token vive en `localStorage` 7 días (staff) / 30 días (tienda), así que el primer XSS que aparezca entrega sesiones completas. CSP es la red que falta debajo. *Hecho verificado (ausencia); el impacto es condicional.*

**S-05 — Turnstile falla abierto dos veces.** Sin `TURNSTILE_SECRET_KEY` deja pasar (`:32-42`) y ante timeout de Cloudflare también (`:78-85`). El segundo caso es defendible; el primero convierte una variable olvidada en "sin CAPTCHA" silencioso. No pude verificar si la variable está cargada en Railway. *Sospecha que requiere validación.*

**S-06 — token de reseteo en claro.** `auth.service.ts:112-121` guarda el `uuidv4` tal cual. La entropía está bien (122 bits, CSPRNG); el problema es que un volcado de base — un backup mal guardado, un insider — permite tomar cualquier cuenta con reseteo pendiente dentro de la hora. Guardar el hash cuesta media hora. *Hecho verificado.*

**S-07 — `folder` sin validar en uploads.** `upload.routes.ts:21` toma `req.body.folder` crudo y lo pasa a Cloudinary. Requiere estar autenticado como staff, así que el techo es bajo (escribir en carpetas ajenas de la propia cuenta de Cloudinary), pero es entrada de usuario yendo directo a un servicio externo. El `fileFilter` confía en el mimetype declarado por el cliente; Cloudinary con `resource_type:'image'` tapa el hueco. *Hecho verificado, impacto bajo.*

**S-04 — dependencias.** Backend: 4 moderadas, todas por `uuid` transitivo de `sequelize` y `autocannon`; el fix es un major de Sequelize, no vale la pena. Frontend: **1 alta** (`nanoid`, loop infinito) y **2 moderadas en `react-router` — open redirect vía backslash en `<Link>`/`useNavigate` y *arbitrary constructor injection* en `deserializeErrors()`** — y para las tres **hay fix sin cambio mayor**. Es media hora de trabajo. *Hecho verificado.*

**Secretos.** `.gitignore` cubre `.env*` y `documentos/Users.txt`; `git ls-files` sólo trackea los `.env.example`. Ningún literal de contraseña/secreto en `src/` ni `seeders/` (el `reset-admin-prod.ts` que el cerebro marcaba ya lee de `ADMIN_PASSWORD`). El bundle sólo expone lo que debe ser público (`VITE_API_URL`, site keys). *Falso positivo descartado.*

### 4.2. Ingeniero DevOps

**No hay pipeline. Punto.** Ni `.github/` en `backIndians` ni en `frontIndians`. El typecheck, los 313 tests, el lint y el build se corren cuando alguien se acuerda. El backend despliega solo al pushear a `master` — es decir, **un `git push` equivocado va a producción sin que nada lo frene**. Eso, combinado con `railway.toml:6` (`npm run migrate && npm start`), significa que un push puede aplicar migraciones en la base productiva sin revisión. Es el mayor riesgo estructural del proyecto y no aparece en las auditorías anteriores con esta crudeza. *Hecho verificado.*

**A-01 — DDL en producción en cada arranque.** `db.ts:55` guarda correctamente el `sync()` detrás de `NODE_ENV !== 'production'`, pero `server.ts:85` llama a `ensureSchema()` **sin ninguna guarda**, y `ensureSchema.ts` hace `addColumn`, `removeIndex` y `addIndex` reales. Su comentario dice "en producción es no-op: las columnas ya existen" — y es cierto *mientras* el estado sea el esperado. Cada reinicio del contenedor ejecuta `describeTable` y `showIndex` sobre varias tablas y, si algo no coincide, altera el esquema productivo sin que nadie lo pida y sin quedar registrado en `SequelizeMeta`. Con `restartPolicyMaxRetries=3` y reinicios automáticos, eso puede pasar de madrugada. *Hecho verificado.*

**D-01/D-02 — el monitoreo está escrito pero no encendido.** El código de C7 es bueno: `/health` consulta la base con timeout de 5 s y devuelve 503 (verificado: responde 200 con `database:"ok"`), y `errorRateMonitor` detecta 5xx sostenidos. Pero el checklist de verificación de `ALERTAS_Y_MONITOREO.md:148-155` tiene **las ocho casillas sin marcar**, incluidas "monitor creado en UptimeRobot" y "variables cargadas en Railway". `alerts.ts:67` y `:90` retornan en silencio si faltan `ALERT_EMAIL_TO` o `CALLMEBOT_*`. **No puedo verificar el panel de Railway ni la cuenta de UptimeRobot desde acá: es una pregunta abierta, no un hallazgo cerrado.**

Lo que sí es hallazgo cerrado: `sendAlert` se invoca **desde un solo lugar** (`errorRateMonitor.ts:45`). Los tres jobs de `scheduler.ts` capturan sus excepciones y sólo hacen `logger.error`. Si `reconcilePendingPayments` se rompe — y hoy es el único camino por el que se acreditan los pagos de MercadoPago, porque el webhook está deshabilitado por B-04 — **los pagos dejan de acreditarse y nadie recibe un aviso**. Los dos huecos combinados reproducen exactamente la forma del incidente del 2026-08-07. *Hecho verificado.*

**D-03 — el deploy del frontend no se puede deshacer.** `deploy-ftp.mjs` sube `dist/` sobre `/public_html` con `uploadFromDir`: no borra lo viejo, no es atómico (hay una ventana en la que el `index.html` nuevo convive con assets a medio subir), y **no conserva el `dist` anterior**. El runbook de la auditoría previa dice "⚠️ conservarlo antes de pisar" — el script no lo hace, así que depende de que la persona se acuerde. Además `FTP_SECURE` es `false` por defecto (credenciales y build en texto plano) y, aun activándolo, `secureOptions:{rejectUnauthorized:false}` desactiva la validación del certificado. *Hecho verificado.*

**D-05 — la topología documentada no es la real.** Ambos dominios responden `Server: cloudflare`. La documentación (`deployment-topology`, comentarios del `.htaccess`) habla de Donweb/Ferozo y no menciona Cloudflare. Consecuencia concreta: el `robots.txt` que se sirve **no es el del repo** — Cloudflare le antepone un bloque *Managed content* con sus propios `Content-Signal` y `Disallow` para bots de IA. El trabajo de SEO del repo se está sirviendo modificado por una capa que nadie documentó. El caché sí está bien resuelto por casualidad: el HTML sale `no-cache` y `cf-cache-status: DYNAMIC`, y los assets llevan hash, así que un deploy no queda pegado. *Hecho verificado.*

**Backups.** La auditoría del 08/08 validó el *procedimiento* (`mysqldump` → base nueva → conteos idénticos) pero dejó explícito que **el backup productivo nunca se probó** (condición C3). No hay evidencia en el repo de que eso haya cambiado. Sumado a A-04 (la tabla `products` no tiene migración), el camino "reconstruir desde migraciones" tampoco es una red completa. *Pregunta abierta.*

**A-02 — estado en memoria.** Los rate limiters y el contador de 5xx viven en el proceso. Con una réplica funcionan; con dos, los límites se duplican de hecho y el umbral de alerta se vuelve arbitrario. Hoy es correcto porque C4 fija una sola réplica — pero es una restricción implícita que sólo vive en un documento.

### 4.3. Ingeniero de Calidad Senior

**Lo que corrí yo, hoy, y su resultado.** `npm run typecheck` en backend: **0 errores**. Suite Jest completa contra MySQL real: **47 suites / 313 tests, todos en verde, 232 s** (crece desde los 301 del 08/08: +12 tests, coherente con los commits nuevos). `eslint .` en frontend: **161 errores y 11 warnings** — 57 `react-refresh/only-export-components`, 48 `no-explicit-any`, 17 `no-unused-vars`, 13 `no-useless-escape`, y **24 de la familia `react-hooks`, de los cuales 6 son `rules-of-hooks`**. Ese último grupo no es cosmético: `rules-of-hooks` señala hooks llamados condicionalmente, que es una fuente real de bugs de render, no ruido de estilo. La afirmación de la auditoría previa de que "ninguno es un bug de runtime" merece revisarse.

**Q-01 — la cobertura útil está desbalanceada.** El backend tiene una red de seguridad genuinamente buena: 47 suites de integración contra MySQL real, con tests que fallan contra el código anterior (el criterio correcto). El frontend tiene **3 archivos de Vitest y todos prueban utils puras** (`formatters`, `host`, `validations`). Ni un test de componente, ni uno de hook. Toda la lógica de `OrderItemForm`, del checkout, de los stores de Zustand y de los formularios con `react-hook-form` + Zod está sin cubrir. Los 8 specs de Playwright son la única cobertura real de esa capa — y **no se corren automáticamente**; no los ejecuté en esta auditoría porque requieren backend y frontend levantados.

**Los bloqueantes que encontré son, en el fondo, un hueco de QA.** B-01 y B-02 no son bugs de código: son **estados de configuración productiva que ninguna prueba verifica**. No hay un smoke test post-deploy que pregunte "¿el catálogo tiene precios plausibles?" o "¿los medios de pago ofrecidos están configurados?". El runbook del 08/08 tiene smoke tests manuales (§8, pasos 8-12) que habrían encontrado B-02 en el paso 9 — pero son manuales, y no hay registro de que se hayan corrido después del deploy de hoy.

**Datos de prueba.** El producto 3 tiene `price:5` y `public_price:11`, el 5 tiene 85 % de descuento sobre $50. `shipping_cost` es $10.000 y `free_shipping_min` $50.000, con productos de $11. No es un catálogo real ni por asomo.

**Accesibilidad (WCAG 2.1 AA).** Revisión superficial, no exhaustiva: 2 de 19 `<img>` de la tienda sin `alt`, y 37 `aria-label` presentes — mejor de lo esperable, pero sin auditoría formal de contraste, foco visible ni navegación por teclado. *Área revisada de forma incompleta, lo declaro como tal.*

**Rendimiento.** No hay pruebas de carga vigentes. `autocannon` está en `devDependencies` sin script que lo invoque. El *bundle* está bien particionado: 2,7 MB totales, pero los chunks pesados (`pdf` 628 KB, `charts` 391 KB) son *lazy* y sólo los carga el panel de administración, no el comprador (`vite.config.ts:22-34`). *Falso positivo descartado: el peso total no representa lo que descarga un visitante de la tienda.*

### 4.4. Arquitecto de Software Senior

**La arquitectura es coherente y las convenciones se respetan.** Servicios separados de controladores, dos sistemas de auth con frontera real, ledger de stock, idempotencia en checkout y en cobros, logging estructurado con `transactionId`/`correlationId`, un `errorHandler` central que clasifica correctamente 4xx (WARN) de 5xx (ERROR) y no filtra el mensaje interno en producción (`errorHandler.ts:142-148`). Los timeouts están puestos donde importa: 5 s en el health check, 5 s en Turnstile, 10 s en CallMeBot, 20 s en la conexión a MySQL. Eso es más disciplina de resiliencia de la que se ve habitualmente en un proyecto de este tamaño.

**Las decisiones caras de revertir después del release, en orden:**

**A-01** ya lo cubrí arriba, pero conceptualmente es un problema de arquitectura, no de DevOps: `ensureSchema` es un mecanismo de desarrollo que se ejecuta en producción. Mientras exista, hay dos fuentes de verdad del esquema (las migraciones y este archivo) y el `CLAUDE.md` tiene que recordarle a cada persona que las mantenga sincronizadas a mano. Es deuda que se paga en cada cambio de esquema, para siempre.

**A-03** — `STORE_ORDER_TRANSITIONS` duplicado entre `backIndians/src/config/storeOrderFlow.ts` y `frontIndians/src/api/store.ts`. Está reconocido en el `CLAUDE.md` como deuda conocida, lo cual está bien, pero sigue sin resolverse y va a morder cuando alguien toque estados sin leer el archivo de reglas.

**A-04** — la tabla `products` no tiene migración. Consecuencia que va más allá de "un endpoint da 500": **el esquema productivo no se puede reconstruir sólo con `npm run migrate`**. En un escenario de recuperación real, restaurar el dump funciona; levantar de cero desde el código, no. Es una brecha de recuperación, no un endpoint muerto.

**A-05 (AUD-16)** — `catalog_products.stock_quantity` y `.stock_reserved` se escriben como la suma de los talles al guardar el producto y después nadie los actualiza: divergen con la primera venta. No abre un vector de ataque, pero es un campo que dice una cosa y significa otra, y ya produjo 14 falsos positivos al escribir el SQL de integridad. Cuanto más código nuevo lo lea creyéndole, más caro sale arreglarlo.

**REV-07** — el sistema soporta **una sola sesión concurrente por usuario de staff**: `loginService` incrementa `session_version` en cada login, así que entrar desde el celular expulsa la sesión de la computadora. La tienda sí permite sesiones concurrentes. La asimetría no parece deliberada y sigue sin decisión registrada desde el 08/08. No es un bug de seguridad — al contrario, es más estricto — pero es fricción diaria que el primer usuario va a reportar como falla.

**Contratos de API.** Todo bajo `/api/v1`, sin versionado real más allá del prefijo. `PUT /catalog/products/:id/sizes` cambió de "siempre 200" a "puede devolver 409/400" en el release anterior (AUD-15/C8): el frontend se adaptó, pero no hay mecanismo que impida repetir un cambio de contrato sin coordinación.

### 4.5. Especialista Legal y de Privacidad

**B-03 — no hay ningún texto legal, y el sitio afirma que sí.** `src/router/index.tsx` define 24 rutas de tienda y **ninguna** es de privacidad, términos, arrepentimiento o data fiscal. Peor: `StoreAuthPage.tsx:343` muestra *"Al registrarte aceptás nuestros términos y condiciones"* — texto plano, sin enlace, sin casilla de consentimiento, y sin términos que existan. Eso no es un consentimiento válido bajo ningún criterio; es una afirmación de que el usuario aceptó un documento inexistente.

Para un e-commerce B2C argentino faltan, concretamente:

- **Política de privacidad** con la cláusula obligatoria de la Disposición 10/2008 de la DNPDP y la base legal del tratamiento (Ley 25.326). Además, la base de datos de clientes debería estar inscripta ante la AAIP.
- **Términos y condiciones** accesibles antes de contratar (Ley 24.240; Res. Mercosur 21/04 incorporada por Res. 104/2005).
- **Botón de arrepentimiento** (Res. SCI 424/2020): obligatorio, visible en la home, accesible en un solo clic, para ejercer el derecho de revocación de 10 días corridos del art. 34 de la Ley 24.240.
- **Formulario de Data Fiscal / QR de AFIP** (RG 4004-E), obligatorio en sitios que ofrecen bienes o servicios.
- **Vía de contacto para reclamos** y referencia al régimen de Defensa del Consumidor.

Es lo más barato de arreglar en horas de programación (las rutas y el enlace son media jornada) y lo más caro de arreglar después de una intimación.

**L-01 — no hay retención ni supresión.** `store_events` acumula `session_id`, `customer_id`, `device_type` y **geolocalización a nivel de ciudad y región** por cada vista de producto, búsqueda y evento de carrito. `scheduler.ts` no tiene ningún job de purga: la tabla crece indefinidamente. Cuando el evento lleva `customer_id`, eso es un perfil de navegación asociado a una persona identificada, sin plazo de conservación declarado — contra el principio de minimización del art. 4 de la Ley 25.326.

Y no existe forma de que un comprador se dé de baja: `store.routes.ts` tiene `GET/PUT /me` y `DELETE /me/addresses/:id`, pero **no hay `DELETE /me`**. El derecho de supresión (art. 16) hoy sólo se puede satisfacer con una intervención manual en la base.

**L-02 — transferencias internacionales sin declarar.** Los datos de compradores pasan por Cloudflare (EE. UU.), MercadoPago, Cloudinary (EE. UU.), Resend (EE. UU.) y Google (OAuth). La Ley 25.326 art. 12 restringe la transferencia a países sin protección adecuada y exige, como mínimo, informarlo. Nada de esto está declarado en ningún lado — porque no hay dónde declararlo (ver B-03).

**Licencias de terceros — un punto a favor y uno a vigilar.** Todas las dependencias productivas son MIT/ISC/Apache-2.0, sin copyleft fuerte. Y la rama `fix/tipografia-tienda-proxima-nova` resolvió correctamente el riesgo de usar Proxima Nova sin licencia: se dejó Poppins (OFL) como placeholder y el `@font-face` real comentado. Es la decisión correcta y conviene registrar por qué, para que nadie la "arregle" descomentándolo.

### 4.6. Release Manager — integración

**Dónde los roles no coinciden.**

*Sobre B-01 (productos de prueba en producción).* **Calidad y Arquitectura sostienen que es bloqueante**: el sitio está `store_active=true`, en el sitemap, con `Allow: /` y checkout operativo — desde el punto de vista del sistema, cualquiera que llegue puede comprar mercadería real por el precio de un café, y ni MercadoPago ni el pago en efectivo tienen un piso que lo impida. **DevOps sostiene que es una decisión de negocio, no un defecto**: si la tienda todavía no se anunció, el tráfico es cero y esto se resuelve cargando el catálogo real, sin tocar una línea de código. **No promedio las dos posturas.** La diferencia se decide con un dato que no tengo: si la tienda ya fue difundida. Pero la asimetría de costos es clara — bajar `store_active` cuesta un clic y no rompe nada; descubrir que alguien compró es irreversible.

*Sobre S-01 (settings públicos).* **Seguridad lo clasifica CRÍTICO por el diseño**; **Arquitectura lo bajaría a MEDIO por el contenido actual** (el CUIT es semipúblico y los campos bancarios están vacíos). Ambas son ciertas. Lo dejo en `CRÍTICO` porque cuesta una hora arreglarlo y porque la integración de Andreani —el próximo pendiente grande del proyecto— es precisamente la que va a agregar credenciales a `settings`.

*Sobre I-03 (checklist ya no bloquea).* **Calidad registra la pérdida de una compuerta**: los 6 controles de producción ya no exigen tildar sus ítems para avanzar. **El commit `f0373b8` documenta el motivo del negocio** (ítems que no aplican según la prenda) y actualizó el cerebro con BR-ORDER-005. Es una decisión legítima del cliente, correctamente ejecutada. Lo dejo como informativo, con la constancia de que el checklist es ahora sólo un registro.

**Confrontación con la auditoría del 2026-08-08.** Verifiqué que las cuatro P1 (AUD-01, 02, 03, 15) están efectivamente corregidas en el código de hoy, con sus tests de regresión en `audit-preprod-regressions.test.ts` y toda la suite en verde. C5 y C8 están cerradas y lo confirmé contra producción (las cuatro cabeceras están vivas). **De las 8 condiciones del `GO CONDICIONADO`, siguen sin evidencia de cierre C1, C2, C3, C4, C6 y C7 — seis de ocho, diez días después.** Y del backlog P2/P3, AUD-04, 05, 07, 08, 09, 10, 11, 12, 13, 14 y 16 siguen todas abiertas. No es un reproche al informe anterior, que fue riguroso: es la observación de que **un `GO CONDICIONADO` cuyas condiciones nadie cierra se convierte, en la práctica, en un `GO` a secas**.

---

## 5. Bloqueantes — orden de ejecución

| # | Acción | Tiempo | Responsable |
|---|---|---|---|
| 0 | **Ahora mismo:** bajar `store_active` a `false` (o `noindex` en la tienda) hasta cerrar 1-4. Es un cambio de configuración, sin deploy. | 5 min | Admin |
| 1 | **B-01** — Vaciar o despublicar los 4 productos de prueba (`show_in_store=false`) y cargar el catálogo real con precios y stock reales. Revisar también `shipping_cost` y `free_shipping_min`. | 0,5 h + carga | Admin |
| 2 | **B-02** — Cargar `bank_transfer_holder`/`cbu`/`alias` en Configuración → Tienda online **y** ocultar el medio de pago en el checkout cuando no estén configurados (`StoreCheckoutPage.tsx:43`). Lo segundo es lo que evita que vuelva a pasar. | 2 h | Dev + Admin |
| 3 | **B-04** — Configurar `MP_WEBHOOK_SECRET` en Railway y volver `server.ts:68` a fatal. Cierra C1 y DEC-014. | 1 h | DevOps |
| 4 | **S-01** — Allowlist en `getPublicStoreSettings()`: devolver sólo las claves con prefijo `store_` que la tienda realmente consume, más las bancarias. Test que falle si se filtra una clave nueva. | 1 h | Dev |
| 5 | **B-03** — Rutas `/tienda/privacidad`, `/tienda/terminos`, `/tienda/arrepentimiento`, enlaces en el footer y en el registro (con casilla real), y el QR de Data Fiscal. El contenido de los textos es tarea legal, no técnica. | 4 h dev | Dev + Legal |
| 6 | **D-01** — Dar de alta UptimeRobot contra `/health`, cargar `ALERT_EMAIL_TO` y `CALLMEBOT_*`, y **hacer la prueba real** (pausar el servicio, confirmar que llega el aviso). Marcar el checklist. | 1 h | DevOps |
| 7 | **D-02** — Enganchar `sendAlert` en los tres `catch` de `scheduler.ts` y en `reportDailyInconsistencies`. | 1 h | Dev |
| 8 | **S-02** — Subir `PWD_REGEX` a `{10,128}` en ambos routers. Forzar cambio de clave a los usuarios existentes. | 1 h | Dev |
| 9 | **A-01** — Guardar `ensureSchema()` detrás de `NODE_ENV !== 'production'` en `server.ts:85`. | 0,5 h | Dev |
| 10 | **S-04** — `npm audit fix` en el frontend (react-router y nanoid tienen fix sin major) + regresión de rutas. | 0,5 h | Dev |

**Total técnico: ~11 h**, más el tiempo legal (externo) y la carga del catálogo (negocio). Los pasos 0-4 son de la misma jornada.

---

## 6. Plan de contingencia

**Criterios objetivos de rollback** (cualquiera dispara la vuelta atrás, sin discusión):

- Un pedido de tienda pagado que no genera su asiento en caja (check 07 y 14-18 de `auditoria-integridad-preprod.sql` con filas).
- Cualquier divergencia de stock que el ledger no explique (checks 01, 02, 03, 06).
- Más de 10 respuestas 5xx en 5 minutos sostenidas por dos ventanas seguidas.
- `/health` devolviendo 503 más de 2 minutos.
- Imposibilidad de completar un checkout con cualquiera de los tres medios de pago.
- Un pedido cuyo total facturado no coincide con la suma de sus ítems.

**Qué mirar en las primeras 24/48 h:**

| Ventana | Qué | Umbral que preocupa |
|---|---|---|
| T+0 a T+2 h | `/health` cada 5 min (UptimeRobot); log filtrando `startup.ready`, `jobs.scheduler.started` | Cualquier ausencia |
| T+0 a T+2 h | Smoke manual: login de los 4 roles, un checkout por cada medio de pago, un movimiento de caja y su reversión | Cualquier falla |
| T+2 a T+24 h | `jobs.reconcilePaymentsFailed`, `jobs.expireStaleOrdersFailed` en el log | Una sola aparición |
| T+2 a T+24 h | Pedidos en `pending_payment` con más de 2 h | Más de 3 |
| T+24 h | `reportDailyInconsistencies` de las 03:00 | Cualquier inconsistencia nueva vs. la línea base |
| T+24 a T+48 h | `auditoria-integridad-preprod.sql` completo, comparado contra la línea base | `INTEGRIDAD FALLA` |
| Continuo | `rateLimit.*` en WARN | Un patrón sostenido desde una IP |

**Cómo se vuelve atrás:**

- **Backend:** redeploy del commit anterior desde Railway. Las migraciones de este ciclo no borran datos.
- **Frontend:** volver a subir el `dist` anterior por FTP — **que hoy nadie está guardando (D-03)**. Antes del próximo deploy: bajar el `public_html` actual a un zip fechado. Sin eso, el rollback del frontend no existe.
- **Base:** restaurar el backup sólo ante corrupción, asumiendo la pérdida desde el punto de backup. **Y ese backup nunca se probó en producción (C3).**

---

## 7. Deuda aceptada

| ID | Con qué se convive | Por qué es tolerable | Fecha objetivo |
|---|---|---|---|
| A-05 (AUD-16) | `catalog_products.stock_*` divergen de sus talles | El checkout exige talle y filtra por talle; el campo no gobierna ninguna decisión | 2026-09-30 |
| A-03 | `STORE_ORDER_TRANSITIONS` duplicado | Documentado en `CLAUDE.md`; sólo muerde si se edita un lado | 2026-09-30 |
| A-04 (AUD-07) | Tabla `products` sin migración | El frontend no consume el endpoint; el DR real usa dump | 2026-09-15 |
| AUD-08 | `order_items.color` 150 vs 100 | Ningún color real supera 100 caracteres | 2026-10-31 |
| AUD-09 | Webhook MP sin frescura de `ts` | El procesamiento es idempotente | 2026-10-31 |
| AUD-10 | Sesión de tienda sin revalidar en base | Ventana de 15 min, sin roles del lado comprador | 2026-10-31 |
| AUD-11 | `updateStoreOrderTracking()` muerto | Ninguna ruta lo alcanza | Con la próxima limpieza |
| AUD-12 / S-03 | Refresh token en `localStorage` | Sin XSS conocido; CSP mitiga (pasar CSP a la lista de arriba si se posterga) | 2026-09-30 |
| A-02 | Rate limit en memoria | Una sola réplica (C4) | Cuando se sume réplica |
| Q-01 | Sin tests de componentes | Los E2E cubren los flujos críticos | Antes del próximo refactor de checkout |
| I-03 | Checklist de producción no bloqueante | Decisión explícita del cliente, con registro de quién tildó qué | — |
| S-05 | Turnstile fail-open ante error de red | El rate limit sigue activo | 2026-10-31 |

---

## 8. Preguntas abiertas — hay que responderlas antes de reabrir

| # | Pregunta | Quién responde | Por qué bloquea |
|---|---|---|---|
| 1 | **¿La tienda ya fue difundida públicamente?** (redes, WhatsApp, publicidad) | Dueño | Decide si B-01 es urgencia de hoy o de esta semana |
| 2 | ¿Los productos de $5-$50 son de prueba o hay una lógica de precios que no estoy viendo? | Admin | Es la premisa de B-01 |
| 3 | ¿Están cargadas en Railway `ALERT_EMAIL_TO`, `CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY`? ¿Existe el monitor de UptimeRobot? | DevOps | Determina si C7 está cerrada o sólo escrita |
| 4 | ¿`TURNSTILE_SECRET_KEY` está configurada en producción? | DevOps | Sin ella el registro no tiene CAPTCHA y nadie lo nota |
| 5 | ¿Se probó **restaurar** un backup de la base productiva? (C3) | DevOps | Sin esto no hay plan de recuperación, sólo la intención |
| 6 | ¿Railway está en una sola réplica? (C4) | DevOps | Con dos, las migraciones al arranque y los rate limiters se rompen |
| 7 | ¿`store_cash_account_id`=1 y `store_bank_account_id`=3 siguen apuntando a cuentas reales y activas? (C2) | Admin | Es lo que evita pedidos pagados sin asiento en caja |
| 8 | ¿Se decide activar HSTS? (C6) | Dueño + Dev | Sigue abierta desde el 08/08; es difícil de revertir, por eso hay que decidirla, no postergarla |
| 9 | ¿La única-sesión-por-usuario del staff es deliberada? (REV-07) | Dueño | Si no lo es, el primer día de uso genera reclamos |
| 10 | ¿Quién redacta los textos legales y para cuándo? | Dueño | B-03 no se cierra con código |
| 11 | ¿Se corrieron los smoke tests del runbook después del deploy de hoy 21:00 UTC? | Dev | El paso 9 habría encontrado B-02 |

---

## 9. Falsos positivos descartados

Los dejo escritos para que nadie los vuelva a levantar mañana.

- **Inyección SQL.** Revisados los 20 usos de `literal()`/`sequelize.query()`. Todos son constantes o pasan por `sequelize.escape()`, incluido el filtro de talle que viene de querystring (`store.service.ts:181`). No hay concatenación de entrada de usuario.
- **Endpoints internos sin autenticación.** Los 18 routers están cubiertos: 10 con `router.use(authenticate)` y los otros por ruta. No falta ninguno.
- **Bundle de 2,7 MB.** El comprador no lo descarga: `pdf` (628 KB) y `charts` (391 KB) son chunks *lazy* de páginas de administración (`vite.config.ts:22-34`).
- **Secretos en el repositorio o en el bundle.** `.gitignore` correcto, `git ls-files` limpio, sin literales de contraseña en `src/` ni `seeders/`, y el bundle sólo expone claves que deben ser públicas.
- **Caché de Cloudflare sirviendo assets viejos tras el deploy.** El HTML sale `no-cache` con `cf-cache-status: DYNAMIC` y los assets llevan hash. Verificado en producción.
- **Confusión entre los dos sistemas de tokens.** `store.auth.service.ts:277` rechaza tokens del sistema aun si `STORE_JWT_SECRET` cae a `JWT_SECRET`. Coincide con §4.1 de la auditoría previa.
- **Cabeceras de seguridad del frontend (AUD-06 / C5).** Están vivas en producción: comprobé `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` en ambos dominios. Lo que falta es CSP y HSTS, que son hallazgos aparte (S-03, C6).

---

## 10. Limitaciones declaradas de esta auditoría

- **No pude ver el panel de Railway, la cuenta de UptimeRobot ni la base productiva.** Todo lo relativo a variables de entorno y datos internos de producción está marcado como *pregunta abierta*, no como hallazgo.
- **No leí ningún `.env*` ni `documentos/Users.txt`**, según la regla del proyecto.
- Las sondas contra producción fueron **exclusivamente `GET`/`HEAD` sobre endpoints públicos**. No modifiqué nada, no creé pedidos, no toqué la base. Los valores sensibles que devolvió `/store/settings` **no se transcriben en este informe** — sólo los nombres de las claves.
- **No corrí los E2E de Playwright** (requieren ambos servidores levantados) ni pruebas de carga.
- La revisión de accesibilidad fue superficial: sin auditoría formal de contraste, foco ni navegación por teclado.
- La suite de tests se corrió contra la base de desarrollo local, que queda sembrada y con los datos que dejó la corrida.

---

# VEREDICTO FINAL: `NO-GO` PARA LA TIENDA PÚBLICA · `GO` PARA EL SISTEMA DE GESTIÓN

El sistema de gestión interno está en condiciones: 313 tests en verde, typecheck limpio, autorización sólida y las P1 de la auditoría anterior efectivamente cerradas. La tienda no, y no por la calidad del código —que es buena— sino porque **está abierta al público con datos de prueba, un medio de pago que no puede completarse y cero textos legales**. Los tres son de configuración y contenido, no de arquitectura: se cierran en una jornada de trabajo más lo que tarde el asesoramiento legal.

Lo que me preocupa más allá de los bloqueantes es el patrón: seis de las ocho condiciones del `GO CONDICIONADO` del 2026-08-08 siguen sin cerrarse diez días después, y el sistema salió igual. Los tres hallazgos que encontré hoy en producción —B-01, B-02 y S-01— no los habría encontrado ninguna revisión de código, porque ninguno vive en el código: viven en el estado real del sistema desplegado. Mientras no exista un smoke test automatizado post-deploy que mire producción y no el repositorio, el próximo hallazgo de esta clase también va a aparecer después de que el cliente lo sufra.
