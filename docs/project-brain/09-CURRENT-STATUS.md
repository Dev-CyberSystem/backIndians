# 09 — Estado actual del proyecto

> Fotografía al **2026-08-05**, con una sección de actualización al **2026-08-19** al principio (ver abajo).

## Actualización 2026-08-27 — sección destacada / lanzamiento (genérica, tienda)

Rama `feature/seccion-el-pulga` en **ambos repos** (no mergeada a `main`). Nace como landing para "Despedida del Pulga" y se **generaliza en la misma sesión** a una sección de campaña reutilizable (hoy el Pulga, mañana otra) con landing propia en `/tienda/coleccion/:slug`.

- **Sin cambio de esquema ni de contrato de API.** Los productos que muestra son los del catálogo con el `tag` configurado; usa el filtro `tag` que ya existía en `GET /store/products`. Los productos siguen visibles en toda la tienda (decisión confirmada con el usuario).
- **Backend**: 13 claves `store_collection_*` en `VALID_KEYS` y `PUBLIC_SETTING_KEYS` de `settings.service.ts` (tabla key-value, sin seed ni migración): `_enabled`, `_label`, `_slug`, `_tag`, `_kicker`, `_title`, `_subtitle`, `_description`, `_cta`, `_link_url`, `_link_label`, `_hero_image_url`, `_hero_image_mobile_url`. Coherente con `store-public-settings.test.ts` (todas en ambas listas; la pública sigue más chica que `VALID_KEYS`).
- **Frontend**: `StoreCollectionPage.tsx` (renombrada desde `StorePulgaPage.tsx`), rutas `/tienda/coleccion` + `/tienda/coleccion/:slug` en `router/index.tsx`, ítem de menú + link de footer + franja en la home en `StoreLayout.tsx` / `StoreLandingPage.tsx` (todo condicionado a `store_collection_enabled === 'true'` y a que haya `_label`), y la sección "Sección destacada / lanzamiento" en `EcommerceSettingsPage.tsx`. `generate-sitemap.mjs` agrega la URL (con el slug) solo si está activa. El hero muestra la imagen **entera, sin recortar** (`w-full h-auto`) y el texto encima es opcional.
- **Verificación**: `typecheck` de ambos repos + `vite build` del front en verde. Falta la prueba manual en navegador.
- **Pendiente operativo** (no de código): el admin carga nombre + tag + imagen, activa el toggle, y taggea los productos de catálogo con ese tag.

## Actualización 2026-08-26 — test de estrés pre-lanzamiento (tienda + panel)

Rama `test/stress-carga-lanzamiento` (no mergeada a `master`, requiere confirmación). Prueba de carga local con k6 (`backIndians/stress/`, ver también el script previo `stress/run-stress.js` que ya existía y solo cubría lecturas públicas) buscando el punto de quiebre real del sistema antes del lanzamiento con tráfico real. Metodología: réplica local (no hay staging real desplegado — Railway/Donweb son solo producción), datos de volumen sembrados (`stress/seed-load-data.ts`: 300 productos + 200 compradores de prueba), checkout siempre por transferencia (nunca dispara MercadoPago real) y mails siempre bloqueados (`MAIL_ENABLED=0` + dominios `@example.com`, bloqueados siempre por `mailGuard.ts`).

| Hallazgo | Severidad | Estado | Dónde |
|---|---|---|---|
| **Auto-deadlock del pool de conexiones en checkout**: `generateStoreOrderNumber` corría su `SELECT` sin la `transaction` del checkout → pedía una 2ª conexión del pool mientras la 1ª ya estaba tomada; con checkouts concurrentes ≥ `pool.max` (10), todas competían por esa 2ª conexión y ninguna la conseguía → `SequelizeConnectionAcquireTimeoutError` a los 30s, con apenas 10 usuarios comprando al mismo tiempo | 🔴 Crítico | ✅ Corregido | `store.service.ts` — se le pasa la transacción |
| **Números de pedido duplicados bajo concurrencia**: sin lock, dos checkouts simultáneos podían calcular el mismo `order_number` — el índice único evitaba el duplicado real pero tiraba abajo uno de los dos con 409 (hasta ~45% de los checkouts fallaban con 50+ compradores concurrentes) | 🔴 Crítico | ✅ Corregido | Contador atómico nuevo, tabla `store_order_sequences` (migración 100). Un primer intento con `lock: FOR UPDATE` sobre el `SELECT` original generó deadlocks reales de InnoDB — no repetir ese patrón |
| **Login (staff y comprador) capado a ~3 req/s pase lo que pase**: `bcryptjs` (JS puro) bloquea el único hilo de Node — con concurrencia, los logins se serializan entre sí (a 100 VUs, p50 de login llegó a ~27s) | 🔴 Crítico | ✅ Corregido | Reemplazado por `bcrypt` nativo (thread pool de libuv) en los 3 puntos de uso + seeders. Mismo formato de hash — contraseñas existentes siguen funcionando. Con `UV_THREADPOOL_SIZE` default (4) sube a ~15 req/s; con `UV_THREADPOOL_SIZE=16` a ~24 req/s — **falta cargar esta variable en Railway** |
| Pool de conexiones a MySQL (`max: 10`) se queda corto para lecturas/checkout con 150-300 usuarios concurrentes (throughput se aplana, sin errores, solo latencia creciente) | 🟡 Capacidad | ✅ Mitigado (parcial) | Subido a `max: 25` en `db.ts` — mejora moderada (~50% más margen), no elimina el techo del todo. **Verificar el límite de conexiones del plan de MySQL en Railway antes de confiar en este número en producción** |
| Condición de carrera de stock (venta de más unidades que el stock disponible) | — | ✅ Verificado, sin bug | `stockLedger.service.ts` ya usa `SELECT...FOR UPDATE` correctamente — burst de 50 compradores por 5 unidades: exactamente 5 ventas, ledger reconcilia |
| `UV_THREADPOOL_SIZE` en producción (Railway) | 🟡 Pendiente | ❌ Abierto | Configurar como variable de entorno — no requiere cambio de código, ver `server.ts`/`db.ts` |

**No abordado en esta sesión** (quedó fuera de alcance o requiere más tiempo): el techo real de throughput (~85-170 req/s por endpoint según el escenario) sigue estando bastante por debajo de lo ideal para un pico grande de tráfico simultáneo — probablemente limitado por ser un único proceso Node sin cluster. Evaluar `node:cluster`/múltiples instancias si el volumen esperado lo justifica.

Detalle completo, tabla de resultados por escenario y metodología en `docs/project-brain/10-SESSION-HANDOFF.md`.

## Actualización 2026-08-24 — incidente: `sistema.indians.com.ar` caído (SSL Donweb) + bug de login

Ver [DEC-022](08-DECISIONS.md#dec-022) para el detalle completo. Resumen:

| Ítem | Estado | Dónde |
|---|---|---|
| Bug de login: `password.max(10)` en el frontend bloqueaba contraseñas válidas de 11+ caracteres | ✅ Cerrado y desplegado | `frontIndians/src/pages/auth/LoginPage.tsx`, commit `723400f` en `master` |
| Certificado SSL de `sistema.indians.com.ar` (subdominio sin cubrir en el origen de Donweb) | ❌ Abierto | Requiere contactar soporte de Donweb — el self-service del panel no permite subdominios |
| `sistema.indianstextil.com.ar` como vía de emergencia mientras el SSL sigue caído | ✅ Documentado, en uso | Mismo backend/DB/build que `indians.com.ar`, no es un sistema aparte |
| Link de "recuperar contraseña" fijo a `SYSTEM_URL` (queda roto si `sistema.indians.com.ar` vuelve a caerse) | ❌ Abierto, sin decisión | `auth.service.ts` / `user.service.ts` |

## Actualización 2026-08-19 — cierre de los hallazgos de la auditoría de panel

Lo que cerró la sesión del 2026-08-19 (informe: `documentos/AUDITORIA_PANEL_SEIS_ROLES_2026-08-19.md`):

| Hallazgo | Estado | Dónde |
|---|---|---|
| **R-02** suite en rojo (17 suites / 59 tests) | ✅ Cerrado | 17 archivos adaptados + `store-payment-methods.test.ts` fija el contrato. **55 suites / 387 tests en verde** |
| **R-01** backup truncado dado por bueno | ✅ Cerrado | `scripts/release/verify-dump.cjs`: gzip íntegro + trailer `-- Dump completed on` + piso de tablas. Falla → borra y aborta |
| **R-05** `db-query` "de solo lectura" que ejecutaba cualquier cosa | ✅ Cerrado | Renombrado a `db-exec.mjs` / `npm run db:exec`, con confirmación explícita. [DEC-017](08-DECISIONS.md) |
| **R-06** herramientas sin trackear | ✅ Cerrado | `db-exec.mjs`, `prod-cleanup-2026-08-19.sql` y `package.json` commiteados |
| **S-01** 75 claves de settings públicas | ✅ Cerrado | `PUBLIC_SETTING_KEYS` — 40 claves, verificado en vivo. `BR-STORE-011` |
| **S-02** contraseñas de staff topeadas en 10 | ✅ Cerrado | `{10,128}` en back y front. Sin rotación forzada (decisión del usuario) |
| **A-01** `ensureSchema` haciendo DDL en producción | ✅ Cerrado | Guarda `NODE_ENV !== 'production'` en `server.ts` |
| **D-02** jobs que fallan sin avisar | ✅ Cerrado | `runScheduledJob` + alerta de `reportDailyInconsistencies` |
| **B-02** transferencia ofrecida sin CBU | ✅ Cerrado **en código** | `BR-STORE-010`. **Falta cargar los datos bancarios reales** (tarea de configuración) |
| **L-03** constancia de arrepentimiento por mail | ✅ Ya estaba implementada | Lo que faltaba era el test: `store-withdrawal-email.test.ts` |
| **S-04** `npm audit` del frontend | 🟡 Parcial | `nanoid` (alta) cerrada. `react-router` (2 moderadas) **requiere el major v7** — pendiente de decisión |
| **R-03/R-04** drift y sin rollback | Ver `11-RELEASE-Y-ROLLBACK.md` | Se resuelven con el release `v1.0.1` |
| **B-04** `MP_WEBHOOK_SECRET` | ✅ Cerrado (2026-08-19) | Variable cargada en Railway + chequeo de arranque de vuelta a fatal + `webhook_secret` en `/health`. Cierra [DEC-014](08-DECISIONS.md) |
| **L-04/L-05** Data Fiscal y domicilio | ❌ Abierto | Configuración en el panel, no código |
| **D-01/C7** monitoreo externo | ❌ Abierto | 8 casillas de `documentos/ALERTAS_Y_MONITOREO.md` |
| **C6** HSTS | ❌ Abierto | Decisión del dueño: **no activar por ahora** (2026-08-19) |

**Regla nueva y permanente**: todo cambio en `src/` sale por `npm run release`; `git push origin master` queda para documentación — [DEC-018](08-DECISIONS.md).

## Actualización 2026-08-19 (noche) — pagos de MercadoPago del catálogo

Rama `fix/catalogo-mp-metricas` (ambos repos), **sin mergear ni releasear**. Reporte de producción: dos ventas de catálogo del mes, una cobrada por MercadoPago, y el dashboard mostrando $0 facturado y $0 cobrado.

| Defecto | Estado | Dónde |
|---|---|---|
| Métricas de catálogo sumando `payment_amount` (facturado ≠ cobrado) | ✅ Cerrado | `dashboard.service.ts`. [DEC-019](08-DECISIONS.md#dec-019), `BR-CATALOG-002` |
| Preference de catálogo creada sin `notification_url` — MP nunca llamaba al webhook | ✅ Cerrado | `catalog.service.ts` (`buildCatalogNotificationUrl`) |
| Webhook de catálogo que no acreditaba el cobro ni asentaba en caja ni avisaba | ✅ Cerrado | `applyCatalogPaymentResult` + `reconcileCatalogPayments`. [DEC-020](08-DECISIONS.md#dec-020), `BR-CATALOG-001` |
| `back_urls` armadas con `FRONTEND_URL` cruda (que es un CSV) | ✅ Cerrado | `catalog.controller.ts` |
| Sin aviso automático de cobro | ✅ Cerrado | Socket `notification:catalog_payment` + mail (`CATALOG_PAYMENT_NOTIFY_EMAIL`/`ALERT_EMAIL_TO`) |
| Los dos pedidos ya afectados en producción | ❌ Abierto | Se recuperan con `scripts/reconcile-catalog-order.ts` **después** de desplegar |
| Verificación con un pago real de MercadoPago | ❌ Abierto | Los tests simulan MP con `jest.spyOn` — el circuito de punta a punta no se probó todavía |

**Todo lo de arriba se desplegó como `v1.0.4`.**

## Actualización 2026-08-21 (noche) — la pantalla del panel se entera del pago

Rama `fix/catalogo-refresco-pago` (ambos repos), **sin mergear ni releasear**. El sistema ya acreditaba los pagos (v1.0.4), pero el modal del pedido no se actualizaba: guardaba el pedido en estado local de React y sólo cambiaba si el operador hacía algo.

| Cambio | Estado | Dónde |
|---|---|---|
| Endpoint de refresco contra MercadoPago | ✅ Cerrado | `POST /catalog/orders/:id/payment/refresh`, con `catalogPaymentRefreshLimiter`. [DEC-021](08-DECISIONS.md#dec-021) |
| La pantalla del QR se cierra sola al entrar el pago | ✅ Cerrado | Sondeo cada 10s, tope 15 min (`CatalogOrdersPage.tsx`) |
| Botón "Actualizar" en el modal del pedido | ✅ Cerrado | Encabezado de la factura |
| El pedido abierto deja de vivir en estado local | ✅ Cerrado | Caché de React Query `['catalog','order', id]` |
| Prueba en navegador del ciclo QR → pago → cierre | ❌ Abierto | Es el comportamiento central del cambio y no está verificado a ojo |

---

> Lo que sigue es la fotografía original al **2026-08-05**. Basado en `git log`/`git status` reales de ambos repos y en `backIndians/documentos/AUDITORIA_TIENDA_ONLINE_AVANCE.md`.

## Estado de los repos

- `backIndians`: rama `fixauditoria`, **working tree limpio**, sin cambios sin commitear.
- `frontIndians`: rama `fixauditoria`, **working tree limpio**, sin cambios sin commitear.
- Raíz `indians/`: no es un repo git funcional (solo contiene los dos repos + `.claude/`).
- **Nota sobre memoria previa de sesiones anteriores**: la nota de memoria "AFIP mergeado a fixauditoria pero sin commitear" queda **desactualizada** — el `git log` confirma que sí se commiteó (commits `4e7cd68` backend / `721a8f0` frontend).

## Módulos terminados (implementados y verificados)

- Autenticación (sistema + tienda, dos JWT independientes).
- Usuarios y clientes (CRUD).
- Pedidos de fábrica con ficha técnica completa.
- Controles de producción con checklist (estructura y persistencia — reglas finas de "observado" no verificadas línea por línea).
- Stock de insumos.
- Facturación interna con pagos parciales.
- Caja (cuentas, categorías, transacciones, transferencias).
- Costos de prendas versionados por cliente.
- Catálogo mayorista con pago MercadoPago.
- Tienda online: catálogo público, carrito, checkout (3 medios de pago), cupones, seguimiento con mail por estado, reserva de stock con vencimiento, expiración automática, reconciliación de pagos, analítica de audiencia/carritos abandonados.
- Devoluciones de tienda con revisión manual.
- Facturación electrónica AFIP/ARCA (código completo, ver estado de habilitación abajo).
- SEO técnico de la tienda (metadata React 19, JSON-LD, sitemap, prerender puntual).
- Logging estructurado backend+frontend.

## Módulos/funcionalidades parciales

| Ítem | Qué falta | Fuente |
|---|---|---|
| AFIP/ARCA | Certificado real no cargado, `afip_enabled=false` por defecto — código listo, no habilitado en producción | `.env.example`, migración 078 |
| Conexión tienda→caja | Mecanismo implementado, requiere que `admin` configure `store_cash_account_id` manualmente | `AUDITORIA_TIENDA_ONLINE_AVANCE.md` |
| UI de stock disponible en la tienda pública | Backend calcula `stock_quantity - stock_reserved` correctamente; algunos puntos de la UI todavía muestran la cantidad física | tarea 3.1 de la auditoría original |
| `saveProductSizes` (editor admin de talles) | No pasa por el ledger de movimientos de stock — exclusión consciente, no bug | tareas 1.2/2.1 de la auditoría |
| `EcommerceAnalyticsPage.tsx` (frontend) | Archivo existe pero no está registrado en el router — confirmar si es código huérfano o pendiente de enrutar | `frontIndians/src/router/index.tsx` |

## Trabajo en progreso

Ninguno detectado — ambos repos están con working tree limpio y la última sesión de trabajo (Fase 2 de la auditoría de tienda) fue cerrada explícitamente con un commit de documentación (`65e9d74 docs: cierre de Fase 2`).

## Pendientes (planificados, no implementados)

- **Terminar de unificar el cobro de la tienda en MercadoPago**: el checkout ya **oculta** transferencia y retiro en local (2026-08-24), así que la contradicción con el centro de ayuda está resuelta de cara al comprador. Lo que sigue abierto es que el ocultamiento es **solo de UI**: el backend continúa aceptando `bank_transfer` y `shipping_type: 'pickup'`, y los T&C (`legal/TermsPage.tsx`, secciones 8 y 9) siguen mencionando transferencia, efectivo y retiro — se dejaron así a propósito. Si la decisión se vuelve definitiva, falta desactivar `bank_transfer` en el backend (mismo patrón que `cash`, con su test de contrato), actualizar los T&C y decidir qué pasa con `bank_transfer_*` en Settings. Ver [02-FUNCTIONAL-MAP.md, sección 11c](02-FUNCTIONAL-MAP.md#11c-centro-de-ayuda-de-la-tienda).
- **Definir el costo del primer cambio de talle**: el centro de ayuda dice hoy que el costo logístico de un cambio por talle o preferencia "se informa antes de confirmar la solicitud", sin fijarlo. La recomendación del documento fuente es ofrecer el primer cambio sin cargo por pedido; es una decisión comercial, no de código.
- **Medidas reales de talles por producto**: las tablas publicadas en `/tienda/ayuda#talles` son de referencia general. Cuando existan las medidas oficiales por modelo, deberían mostrarse en la ficha del producto (la sección ya aclara que, si un producto publica su propia tabla, esa es la que vale).
- **Integración con Andreani** (courier): sin empezar, requiere research spike de su API antes de poder desglosarse en tareas. Es el único ítem grande pendiente de la auditoría de tienda.
- **Habilitar AFIP en producción**: requiere acción externa al código (tramitar/cargar certificado real ante ARCA, configurar `afip_enabled=true` y datos fiscales de la empresa).
- **Configurar `store_cash_account_id`**: acción de configuración de negocio, no de código.
- **Rotar credenciales** mencionadas en `documentos/Users.txt` y en el comentario de `seeders/reset-admin-prod.ts` — señalado como riesgo en la auditoría de base de datos de esta sesión, pendiente de confirmación del usuario.
- **CI/CD**: no existe ningún pipeline en servidor. Desde el 2026-08-19 sí hay un **sistema de releases versionados**
  (`npm run release` en backIndians) que corre las validaciones, saca backup de producción y tagea ambos repos;
  las validaciones siguen ejecutándose en la máquina de quien releasea. **Primer release real: `v1.0.0`, desplegado
  el 2026-08-19** (no sólo implementado — usado de punta a punta contra la producción de Railway/Ferozo). Ver
  [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md).

## Deuda técnica anotada explícitamente (por el propio equipo, en `AUDITORIA_TIENDA_ONLINE_AVANCE.md`)

1. **`STORE_ORDER_TRANSITIONS` duplicado** entre `backIndians/src/config/storeOrderFlow.ts` y `frontIndians/src/api/store.ts` — fuente de desincronización futura si se edita solo un lado.
2. **165 errores / 11 warnings de ESLint preexistentes** en `frontIndians` (eran 162 al 2026-08-05), no corregidos, quedaron para una "Fase 4" no confirmada como iniciada.
3. UI de stock disponible (ver tabla de arriba).

## Deuda técnica detectada en esta auditoría (no necesariamente conocida por el equipo)

- `products`/`product_categories`: modelo y (parcialmente) migración sin uso funcional en el código actual — candidatos a limpieza o a confirmar si hay planes de reactivarlos.
- Numeración de migración duplicada (dos migraciones con el número `018`) — no rompe nada, pero indica falta de coordinación de numeración entre branches en algún momento.
- Posibles índices redundantes en `orders`/`invoices` (índice simple + índice compuesto con la misma columna líder).
- Lógica de esquema duplicada entre 5 migraciones puntuales y `ensureSchema.ts` — mantenimiento doble si se edita solo un lado. **Desde el 2026-08-19 `ensureSchema` sólo corre fuera de producción** (hallazgo A-01), así que la divergencia ya no puede alterar el esquema productivo en silencio; el mantenimiento doble sigue.

- **`react-router` v6 con dos vulnerabilidades moderadas abiertas** (open redirect por backslash en `<Link>`/`useNavigate`, y arbitrary constructor injection en `deserializeErrors()`). El fix exige el major v7 sobre todo el ruteo de la app — no entra en un release patch, requiere decisión.
- Índice único de `OrderChecklistCheck` definido tanto en el modelo como en la migración — riesgo de duplicado bajo `sync()`.
- `store_wishlist` rompe la convención `createdAt`/`updatedAt` camelCase del resto del proyecto.
- Inconsistencia menor entre `Order.order_number` (modelo TS: `allowNull:true`) y la migración 005 (`NOT NULL` tras backfill) — confirmar contra la base real.

## Riesgos

- **Migraciones "down" en `db:migrate:status`**: el flujo de desarrollo normal usa `sync()`, no `sequelize-cli db:migrate` — las migraciones 059-066 podían figurar como no aplicadas aunque sus tablas ya existieran vía `sync()`/`ensureSchema`. El `startCommand` de producción en Railway sí corre `npm run migrate` en cada deploy; si alguna migración de ese rango no tiene guarda de idempotencia completa, hay riesgo de error en deploy. Verificar `db:migrate:status` contra la base de producción real antes de un próximo deploy grande
  (ahora disponible como `npm run migrate:status -- --env production`). Desde el 2026-08-19, `npm run release`
  saca un backup de producción antes de cada release, así que este riesgo tiene red de contención.
- **Credenciales en texto plano fuera de git pero en disco**: `frontIndians/.env.deploy` (FTP) y `backIndians/documentos/Users.txt` no están trackeados en git, pero existen en el filesystem local — bajo riesgo si la máquina está controlada, pero a tener en cuenta.
- **Proveedor de hosting del frontend inconsistente en la documentación**: el script de deploy dice "Donweb" en comentarios pero el host real configurado es Ferozo (`a0130338.ferozo.com`) — no crítico, pero puede confundir a quien lea el código sin este dato.

## Pruebas — estado

- **Backend**: al 2026-08-19, **55 suites / 387 tests en verde** (Jest+Supertest contra MySQL real, corrido dos veces). La suite necesita que la tienda tenga datos bancarios cargados para poder crear pedidos; los siembra `src/__tests__/setup.ts` vía `setupFilesAfterEnv`, así que `npx jest` corre contra la base de desarrollo tal como esté. *(Dato histórico: 199/199 al cerrar la Fase 2 de la auditoría de tienda.)*
- **Frontend**: solo 3 archivos de test (Vitest), cubren exclusivamente utils puros (`formatters`, `host`, `validations`) — **sin tests de componentes React ni de hooks**, pese a que la lógica de formularios/flows es compleja (ej. `OrderItemForm`, checkout).
- **E2E**: 5 specs de Playwright (`admin`, `customer-flows`, `seo`, `store`, `users`) — cobertura de flujos clave (login, registro/checkout de comprador con 3 medios de pago, SEO, navegación de tienda, CRUD de usuarios), pero acotada frente a la superficie total del sistema.

## Última funcionalidad trabajada

**2026-08-19 — Textos legales de la tienda** (rama `feature/textos-legales`, sin mergear): Términos y Condiciones, Política de Privacidad, botón de arrepentimiento con formulario real y Data Fiscal en el footer, más la constancia registrada de aceptación (`legal_acceptances`, migraciones 096-098) y la pestaña de gestión en el panel. Cierra el bloqueante **B-03** de la auditoría del 2026-08-18; **`accept_terms` pasó a ser obligatorio en registro y checkout**, así que backend y frontend deben desplegarse juntos. Detalle en [10-SESSION-HANDOFF.md](10-SESSION-HANDOFF.md).

Antes de eso: cierre de la Fase 2 de la auditoría de tienda online: cupón único por cliente (2.8) y ampliación del reporte diario de inconsistencias (2.7), seguido de un commit de documentación consolidando el cierre (`65e9d74`). Ver [10-SESSION-HANDOFF.md](10-SESSION-HANDOFF.md) para el detalle exacto de la última sesión conocida.

## Próximos pasos recomendados

1. Confirmar con el usuario los puntos marcados "pendiente de confirmar" en este cerebro (contraseña en `reset-admin-prod.ts`, estado real de `MP_WEBHOOK_SECRET`/`BACKEND_PUBLIC_URL`/certificado AFIP en Railway).
2. Decidir si se limpia `products`/`product_categories` o se documenta por qué se mantienen.
3. Iniciar (si el negocio lo prioriza) el research spike de Andreani.
4. Si se va a tocar `store_orders.status`/transiciones, primero unificar `STORE_ORDER_TRANSITIONS` entre backend y frontend para no arrastrar la duplicación.
5. Considerar agregar tests de componentes al frontend antes de refactors grandes en `OrderItemForm`/checkout, dado que hoy no hay red de seguridad ahí.

## Actualizar este documento cuando…

Se cierre o abra un módulo, cambie el estado de un pendiente, se resuelva un riesgo, o termine una sesión de trabajo relevante (además de actualizar [10-SESSION-HANDOFF.md](10-SESSION-HANDOFF.md)).
