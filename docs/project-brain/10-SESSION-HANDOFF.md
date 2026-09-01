# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-09-01 — RELEASE v1.5.0 EN PRODUCCIÓN (envío por zona + banner promo mobile + teléfono obligatorio)

Las tres ramas se mergearon a `master` en ambos repos y **se desplegó `v1.5.0`** con `npm run release -- minor`: back `/health` → `1.5.0` (commit `d18d8db`), front `/version.json` → `1.5.0`. Ninguna toca esquema de DB (todo `settings` key-value + JSON de `shipping_address`) → sin migración, rollback solo de código si hiciera falta.

### 1. Costo de envío por zona — `feature/checkout-envio-por-zona` (ambos repos)

**Por qué**: el envío dentro de Tucumán cuesta distinto que al resto del país, y la capital distinto que el interior. Era un valor único.

- **Backend**: `settings.service.ts` — claves `shipping_cost_tucuman_capital` y `shipping_cost_tucuman_interior` en `VALID_KEYS` + `PUBLIC_SETTING_KEYS` (`shipping_cost` = resto del país). `store.service.ts` — `resolveShippingZone({state, shipping_zone})` + `getShippingCostForZone(zone)` (fallback a `shipping_cost` si la clave de Tucumán está vacía → nunca 0); `computeOrderTotals` y `getCheckoutQuote` reciben `shipping_state`/`shipping_zone`; `createStoreOrder` los pasa desde `shipping_address` al recalcular → el guard de `expected_total` no da 409. `store.routes.ts` — `shipping_zone` opcional (enum) en quote y checkout. `StoreOrder.ts` — `ShippingAddress.shipping_zone`. `checkout-quote.test.ts` — 6 casos nuevos. Regla nueva: [BR-STORE-012](03-BUSINESS-RULES.md).
- **Frontend**: `src/data/argentinaProvinces.ts` (nuevo, 24 jurisdicciones + `isTucuman()`); `StoreSelect` nuevo en `components/store/StoreField.tsx`; `StoreCheckoutPage.tsx` — provincia = `<select>` obligatorio para envío, si es Tucumán aparecen 2 radio-cards de zona, `state`+`shipping_zone` en el `queryKey` y el payload del quote/checkout; `api/store.ts` tipos; `EcommerceSettingsPage.tsx` sección Envíos con 3 costos; `EcommerceOrdersPage.tsx` muestra la zona.

### 2. Imagen mobile del banner promo — `feature/banner-promo-responsive-mobile` (ambos repos)

El banner promo de la landing se veía todo negro en mobile (la imagen se ocultaba abajo de `md`). `settings.service.ts` — clave `store_promo_image_mobile_url` en `VALID_KEYS` + `PUBLIC_SETTING_KEYS`. `EcommerceSettingsPage.tsx` — 2º `ImageUploadInput` "Imagen del banner — mobile (opcional)". `StoreLandingPage.tsx` — `<picture>` con `<source media="(max-width: 767px)">`; sin versión mobile cae a la de desktop con `object-cover`.

### 3. Teléfono obligatorio + fixes de entorno de dev — `feature/checkout-telefono-obligatorio` (`frontIndians`)

`StoreCheckoutPage.tsx` — `customer_phone` requerido en el esquema Zod (backend lo sigue aceptando `optional`, sin cambio de contrato). `vite.config.ts` — `strictPort: true` (si 5173 está ocupado, Vite falla en vez de saltar a 5174 y romper CORS). `.gitignore` — `+.env.development` (ahí va `VITE_GOOGLE_CLIENT_ID` de dev; `vite build` no lo toma).

### Falta tras el deploy (operativo, no de código)

1. **Cargar en el panel** *Configuración → Envíos*: `shipping_cost_tucuman_capital` y `shipping_cost_tucuman_interior`. Hasta cargarlos, un envío a Tucumán cobra el de "resto del país" (fallback de `getShippingCostForZone`). Subir también una imagen mobile del banner promo.
2. **Smoke en producción**: checkout eligiendo Tucumán + zona → el total del resumen tiene que cambiar y el checkout no debe dar 409; otra provincia → costo de "resto del país". Home en mobile con el banner.
3. **Ramas `feature/*` locales** (`checkout-envio-por-zona`, `banner-promo-responsive-mobile`, `checkout-telefono-obligatorio`) ya mergeadas — se pueden borrar.
4. **Google OAuth en dev** (no bloquea el release): `VITE_GOOGLE_CLIENT_ID` (front, `.env.development`) = `GOOGLE_CLIENT_ID` (back, `.env`), y `http://localhost:5173` autorizado en Google Cloud Console.

---

## Sesión anterior: 2026-08-31 (mañana) — Sección destacada + ajustes de tienda — RELEASE v1.3.0 y v1.3.1 EN PRODUCCIÓN

**Por qué**: lanzamiento de camisetas homenaje a Luis Miguel "Pulga" Rodríguez. Se pidió que la sección **no sea específica del Pulga** sino **genérica y reutilizable**: hoy "Despedida del Pulga", mañana "Nueva camiseta CAT", etc.

**Estado final**:
- **v1.3.0** (2026-08-29): mergeado a `master` en ambos repos y desplegado (back `70ff84f` + front `eb0438f`). El deploy de Railway quedó ~20 min "Queued" antes de tomar; terminó bien sin intervención. Backup: `.releases/db/v1.3.0-20260828-221951.sql.gz`.
- **v1.3.1** (2026-08-31): parche desplegado — el **pill de la sección destacada en el nav pasó de terracota a celeste** (nuevo color `celeste` en `tailwind.config.js`, tono de la camiseta de Atlético Tucumán) y el beneficio de la home dice **"Con Mercado Pago"** (antes "MercadoPago y transferencia"). El checkout y el centro de ayuda ya eran solo MP. **NO se tocó el T&C** (menciona transferencia de forma condicional; sacarlo requiere bump de versión en `legalDocs.ts`, quedó pendiente por decisión del usuario). Verificado con `release:status` (todo verde) + smoke en `indians.com.ar`. Backup: `.releases/db/v1.3.1-20260831-114905.sql.gz`.

**Qué se hizo** (rama `feature/seccion-el-pulga`, ya mergeada a `master`):

- **Decisión con el usuario**: UNA sección de campaña que el admin repurposea. Landing propia PERO los productos siguen visibles en todo el catálogo. Todo administrable desde el panel. Accesos: menú principal (pill terracota) + footer + franja en la home.
- **Enfoque**: los productos son los del catálogo con un `tag` configurable. Se reusa el filtro `tag` de `GET /store/products` → **sin migración, sin cambio de contrato de API**.
- **Backend** (`backIndians/src/services/settings.service.ts`): 13 claves `store_collection_*` en `VALID_KEYS` y `PUBLIC_SETTING_KEYS` — `_enabled`, `_label`, `_slug`, `_tag`, `_kicker`, `_title`, `_subtitle`, `_description`, `_cta`, `_link_url`, `_link_label`, `_hero_image_url`, `_hero_image_mobile_url`.
- **Frontend**:
  - `src/pages/store/StoreCollectionPage.tsx` (renombrada desde `StorePulgaPage.tsx`): hero con la imagen **entera, sin recortar** (`w-full h-auto`); textos superpuestos opcionales; `ProductCard` de los productos (2 cols si son ≤2, si no 3). Redirige a `/tienda` si no está activa; normaliza el slug a la URL canónica.
  - `src/router/index.tsx`: rutas `/tienda/coleccion` y `/tienda/coleccion/:slug`.
  - `src/components/store/StoreLayout.tsx`: `collectionNavItem(settings)` arma el ítem (pill terracota `bg-clay-600`) en menú desktop + mobile y el link del footer, condicionado a `store_collection_enabled === 'true'` && `_label`.
  - `src/pages/store/StoreLandingPage.tsx`: componente `CollectionBand` (franja en la home).
  - `src/pages/ecommerce/EcommerceSettingsPage.tsx`: sección "Sección destacada / lanzamiento".
  - `scripts/generate-sitemap.mjs`: agrega `/tienda/coleccion/<slug>` solo si está activa.

**Validación del release**: `npm run release -- minor --yes` corrió typecheck + `test:full` (backend) y build + prerender (frontend) en verde, sacó el backup de prod y tageó `v1.3.0` en ambos repos.

**Pendientes tras el deploy**:
1. **Prueba del scroll horizontal en mobile en un iPhone real** — los fixes defensivos (`SmartProductSections` + `overflow-x-clip` en el wrapper de `StoreLayout`) están en producción pero no se pudieron verificar en herramientas (la emulación de Chromium miente con `window.innerWidth`).
2. **Activar la sección** cuando el negocio lo decida: *Tienda online → Configuración → Sección destacada* → Nombre + Tag + imagen + toggle; taggear los productos de catálogo con ese tag.
3. **"Lo más comprado de la semana"**: en producción hoy devuelve 0 productos (no hay compras de los últimos 7 días que resuelvan a productos visibles), así que `SectionShell` esconde la sección. Es el comportamiento esperado del ranking nuevo (solo `purchase`); si se quiere que siempre muestre algo, hay que ampliar el fallback de `getTrendingProducts` (hoy solo cae a "más nuevos" cuando hay CERO eventos de compra, no cuando los eventos resuelven a vacío).

---

## Sesión anterior: 2026-08-26 — Test de estrés pre-lanzamiento (tienda + panel)

**Por qué**: el sistema va a producción con un flujo importante de tráfico real y nunca se había probado bajo concurrencia real de escritura (checkout, login) — solo lecturas públicas (`stress/run-stress.js`, autocannon, ya existía).

**Qué se hizo**: se armó infraestructura de test de carga nueva en `backIndians/stress/` (rama `test/stress-carga-lanzamiento`, NO mergeada a `master`):
- `seed-load-data.ts`: siembra 300 productos de catálogo (`STRESS-*`, stock alto) + 1 producto de stock bajo para el test de condición de carrera (`STRESS-RACE`, stock=5) + 200 compradores de prueba. Guarda de "solo DB local" igual a `scripts/reset-dev-db.js`.
- `k6/01-catalog-browse.js`, `02-store-auth.js`, `03-checkout-transfer.js` (siempre `payment_method: bank_transfer`, nunca dispara MercadoPago real), `05-admin-panel.js`, `04-stock-race.js` (burst de 50 compradores por 5 unidades) + `verify-race-integrity.ts` (chequeo de integridad post-burst).
- `run-k6.mjs`: orquestador que corre cada escenario en niveles crecientes de VUs vía `docker run grafana/k6` (sin instalar nada) y reporta el punto de quiebre (tasa de error/latencia).
- Corrido contra una réplica local (no existe staging real desplegado) con `MAIL_ENABLED=0` + emails de prueba en `@example.com` (bloqueados siempre por `mailGuard.ts`, doble barrera) — cero mails reales, cero pagos MP reales en toda la sesión.

**3 bugs reales encontrados y corregidos** (ver tabla completa en [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md)):
1. **Auto-deadlock del pool de conexiones en checkout**: `generateStoreOrderNumber` no recibía la `transaction` del checkout → con concurrencia ≥ `pool.max` (10), el sistema se autobloqueaba (`SequelizeConnectionAcquireTimeoutError`) con apenas 10 compradores simultáneos. Fix: pasarle la transacción.
2. **Números de pedido duplicados bajo concurrencia** (hasta ~45% de checkouts fallando con 50+ VUs): el cálculo del próximo `order_number` no era atómico. Un primer intento (`lock: FOR UPDATE` sobre el `SELECT` original) generó deadlocks reales de InnoDB — **no repetir ese patrón**, quedó documentado en el código. Fix definitivo: tabla `store_order_sequences` (migración 100) con el modismo atómico de MySQL (`INSERT ... ON DUPLICATE KEY UPDATE next_seq = LAST_INSERT_ID(next_seq + 1)`).
3. **Login capado a ~3 req/s pase lo que pase** (staff y comprador): `bcryptjs` (JS puro) bloqueaba el único hilo de Node bajo logins concurrentes. Fix: reemplazado por `bcrypt` nativo en todo el backend (mismo formato de hash, compatible con contraseñas existentes — verificado en vivo, nadie necesita resetear). Sube a ~15 req/s con el thread pool default de Node, ~24 req/s con `UV_THREADPOOL_SIZE=16`.

También: pool de conexiones subido de `max: 10` a `max: 25` (mejora moderada, no es la bala de plata — el techo real de throughput por endpoint sigue en ~85-170 req/s, probablemente por ser un único proceso Node sin cluster). Verificado que **no hay** condición de carrera de stock (el ledger ya usa `FOR UPDATE` correctamente).

**Validación**: `tsc --noEmit` limpio, `npm run test:full` — **57 suites / 406 tests, todos en verde** (incluye el flujo de checkout con el nuevo contador de `order_number`, sin regresiones). Los 5 escenarios de k6 corridos con resultados numéricos (req/s, p50/p95, tasa de error) mostrados al usuario. Verificación de integridad post-condición-de-carrera: PASA (5 pedidos, 5 reservado de 5 físico, ledger reconcilia).

**Falta / cómo retomar**:
1. **Cargar `UV_THREADPOOL_SIZE` en Railway** (variable de entorno, sin cambio de código) — es lo único de los 3 hallazgos críticos que sigue con una acción pendiente fuera del código.
2. **Verificar el límite de conexiones del plan de MySQL en Railway** antes de confiar en `pool.max: 25` en producción (localmente MySQL permite 151; Railway puede ser distinto).
3. Rama `test/stress-carga-lanzamiento` en `backIndians` sin mergear — pedir confirmación antes de mergear a `master` y desplegar (toca `store.service.ts`, una migración nueva, y la librería de hashing de contraseñas — release delicado, seguir `11-RELEASE-Y-ROLLBACK.md`).
4. Datos de prueba `STRESS-*` / `stress-customer-*@example.com` quedaron en la base de dev local (no en producción) — limpiar con `npx ts-node --project tsconfig.seed.json stress/seed-load-data.ts --cleanup` o `npm run db:reset` si hace falta una base limpia.
5. No evaluado en esta sesión (fuera de alcance): migrar a `node:cluster`/múltiples instancias si el volumen esperado de lanzamiento supera el techo medido (~85-170 req/s por endpoint en esta máquina de desarrollo — no es directamente comparable al hardware de Railway, hay que remedir ahí si el margen preocupa).

Archivos tocados: `src/services/store.service.ts`, `src/services/auth.service.ts`, `src/services/store.auth.service.ts`, `src/services/user.service.ts`, `src/models/StoreOrderSequence.ts` (nuevo), `src/models/index.ts`, `src/config/db.ts`, `migrations/20260826-100-create-store-order-sequences.js` (nueva), `package.json`/`package-lock.json` (bcrypt en vez de bcryptjs), `seeders/*.ts` (mismo swap), `tsconfig.seed.json`, `.gitignore`, todo `backIndians/stress/` (nuevo).

---

## Sesión anterior (2026-08-25): Ficha técnica + código interno en productos de catálogo

Cerrada y validada sin pendientes (código commiteable, probado en navegador real, 406 tests en verde). Detalle completo en el historial de `git log` de `backIndians` y en [05-DATABASE.md](05-DATABASE.md) (migración 099) / [02-FUNCTIONAL-MAP.md](02-FUNCTIONAL-MAP.md) (sección 9) si hace falta el contexto completo.

---

## Sesiones anteriores — pendientes que siguen abiertos

- **SSL `sistema.indians.com.ar`** (sesión 2026-08-24): el certificado del subdominio sigue sin resolverse — requiere contactar soporte de Donweb. Vía de emergencia vigente: `https://sistema.indianstextil.com.ar/`. Detalle en [DEC-022](08-DECISIONS.md#dec-022).
- **`feature/centro-de-ayuda`** (sesión 2026-08-24, ambos repos): rama sin mergear con la reescritura de `/tienda/ayuda` (11 categorías, 63 preguntas, deep links, FAQ JSON-LD) y el checkout alineado (solo Mercado Pago, sin retiro en local). Pendiente: mergear + `npm run deploy` del frontend; decidir si se alinean los T&C (mencionan transferencia/efectivo/retiro) y si se desactiva `bank_transfer` en el backend. Retomar con `cd frontIndians && git checkout feature/centro-de-ayuda`.

Ver [DEC-022](08-DECISIONS.md#dec-022) para el detalle técnico completo. Resumen para retomar:

**Qué se hizo**: se diagnosticó que `sistema.indians.com.ar` devolvía la página de error de Donweb ("sin certificado SSL") en vez de la app — causa: el certificado del hosting cubre `indians.com.ar` raíz pero nunca se dio de alta el subdominio `sistema.` en el panel de Certificados SSL de Donweb, y su self-service no acepta subdominios. Aparte, se encontró y arregló un bug real de login (`LoginPage.tsx` rechazaba contraseñas de más de 10 caracteres, contradiciendo el mínimo de 10 del backend) — commit `723400f`, commiteado y pusheado directo a `master` (no a `feature/centro-de-ayuda`, que quedó intacta), buildeado y desplegado por FTP.

**Cómo retomar**:
1. **Pendiente real**: el certificado SSL de `sistema.indians.com.ar` sigue sin resolverse — hace falta contactar soporte de Donweb (el panel no permite agregarlo como subdominio). Hasta que se resuelva, el acceso al panel es por `https://sistema.indianstextil.com.ar/` (mismo backend/DB/build, documentado como vía de emergencia).
2. Confirmar si el usuario quiere que el link de "recuperar contraseña" deje de depender de `SYSTEM_URL` fijo (propuesto, no implementado — ver DEC-022).
3. `frontIndians` quedó en `master` con el fix de login ya pusheado; `feature/centro-de-ayuda` no se tocó y sigue con sus 2 commits sin mergear (ver la sección siguiente). Al mergear esa rama a `master`, va a traer consigo el fix de login (ya está en `master`, así que no hay conflicto esperado ahí).

---

## Sesión anterior (aún vigente, sin cambios): 2026-08-24 — Centro de ayuda de la tienda

Rama: `feature/centro-de-ayuda` en **ambos** repos (en backIndians solo cambia el cerebro documental: el código del backend no se tocó). No mergeada, no releaseada.

### De dónde salió

El usuario trajo el documento *"INDIANS — Centro de ayuda completo v1.0"* (agosto 2026, 18 páginas: arquitectura, textos de atención, políticas de envíos/cambios/devoluciones/garantía/talles y especificaciones de implementación) y pidió adaptarlo a la sección de ayuda de la tienda.

La página `/tienda/ayuda` ya existía, con cuatro bloques (envíos, cambios, talles, FAQ). El trabajo real no fue escribir texto: fue **resolver las contradicciones** entre lo que el documento propone, lo que la página decía y lo que el sistema hace de verdad.

### Contradicciones encontradas (verificadas contra el código, no contra el documento)

| Documento | Sistema real | Resolución |
|---|---|---|
| Solo Mercado Pago | `StoreCheckoutPage.tsx` ofrecía MP + efectivo + transferencia | Se publica "Mercado Pago" y **se ocultó la transferencia** en el checkout (el efectivo ya estaba oculto desde el 2026-08-19) |
| No hay retiro en local | `shipping_type: 'pickup'` era el **default** del checkout | **Se ocultó el retiro** y el default pasó a `'delivery'` |
| Cambios: 15 días hábiles | La ayuda publicaba 30 días corridos | Se adoptan los 15 días hábiles |
| Envío: 7 a 9 días hábiles | La ayuda publicaba 3-7 días + 24-48 h de despacho | Se adoptan los 7 a 9 días hábiles |
| Garantía: 6 meses | La ayuda no hablaba de garantía | Se publica la garantía legal de 6 meses (Ley 24.240) |
| No publicar tabla de talles genérica | Ya había una publicada | Se **mantienen** las tablas y se suma el instructivo de medición |

Las cuatro decisiones que no eran técnicas (pagos, plazos, talles, estructura de rutas) las tomó el usuario explícitamente. Sobre el retiro en local cambió de criterio a mitad de la sesión: primero se mantenía, después pidió ocultarlo junto con la transferencia.

### Segunda parte: alinear el checkout

Con la ayuda ya publicando "se paga con Mercado Pago", el checkout la contradecía. El usuario pidió **ocultar** transferencia, efectivo y retiro en local, sin tocar T&C ni Settings.

Es ocultamiento de UI, no desactivación, y la diferencia importa: el backend sigue aceptando `bank_transfer` y `shipping_type: 'pickup'`, los pedidos históricos con esos valores se muestran y se gestionan igual, `/tienda/checkout/transferencia` sigue viva y las claves `bank_transfer_*` quedan cargadas. Cada bloque oculto lleva el comentario de cómo revertirlo, siguiendo el patrón que ya había dejado el equipo para el efectivo.

El detalle que no era obvio: `'pickup'` era el **default** del formulario. Ocultar el radio sin cambiar el default habría creado los pedidos como retiro sin que el comprador pudiera verlo ni cambiarlo. El default pasó a `'delivery'`.

### Qué se hizo

**Contenido separado de la UI**: `frontIndians/src/pages/store/help/helpContent.ts` — 11 categorías, 63 preguntas y la constante `HELP_POLICY` con los plazos publicados en un solo lugar. Se puede corregir un texto de atención sin tocar un componente.

**Página** (`StoreHelpPage.tsx`, reescrita): buscador que normaliza acentos, cuatro acciones rápidas, índice de categorías, política destacada por sección, pasos del cambio, tablas de talles y medición, canales de contacto reales tomados de Settings (`store_whatsapp`, `company_email`, `store_instagram`).

**Acordeones con `<details>` nativo** en vez de estado en React: trae teclado y semántica gratis, el navegador lo abre solo cuando el hash apunta adentro, y la respuesta se monta siempre (lo que hace válido el JSON-LD). De paso, sacó el `setState` dentro de un efecto que tenía la versión anterior.

**Deep links**: cada pregunta tiene ancla `#faq-<id>` con botón "copiar enlace" — para que atención mande la respuesta exacta. Las anclas viejas (`#envios`, `#cambios`, `#talles`) siguen funcionando, y `#faq`, que era el bloque único de la versión anterior y está en correos ya enviados, redirige a `#pedidos` en vez de quedar muerta.

**SEO**: `FaqJsonLd` nuevo en `components/seo/JsonLd.tsx` → emite `FAQPage` con las 63 preguntas.

**Consistencia**: el default de `store_announcement` en `StoreLayout` decía "Cambios sin cargo dentro de los 30 días" — se actualizó a los 15 días hábiles. Los links de Ayuda del footer se ampliaron (Centro de ayuda, Garantía, Contacto).

**Checkout** (`StoreCheckoutPage.tsx`): `PAYMENT_OPTIONS` queda solo con `mercadopago`; el radio de retiro en local sale del formulario y el default de `shipping_type` pasa a `'delivery'`; `Building2` sale del import de lucide porque quedaba sin usar. La FAQ de retiro del centro de ayuda pasó de "sí" a "no" en la misma tanda.

### Validación

- `tsc --noEmit` limpio · `npm run build` OK · Vitest **47/47** · ESLint sin errores nuevos (los 5 de `StoreLayout.tsx` son preexistentes: se contaron antes y después del cambio).
- Prueba en navegador real (Playwright, dev server): 11 secciones y 63 preguntas renderizadas, JSON-LD `FAQPage` presente, buscador filtrando (14 resultados para "talle", mensaje de sin resultados OK), deep link `#faq-cuanto-tarda` abriendo la respuesta correcta, alias `#faq` scrolleando, mobile 390px sin scroll horizontal.
- Checkout verificado en navegador con el carrito sembrado en `localStorage` (el backend de dev no estaba levantado): no menciona transferencia, efectivo ni retiro; el único radio de envío es `delivery` y queda seleccionado; pide la dirección; sin scroll horizontal en 390px.

### Qué falta (lo importante para la próxima sesión)

1. **Los T&C siguen mencionando transferencia, efectivo y retiro** (`legal/TermsPage.tsx`, secciones 8 y 9). Se dejaron así por decisión explícita del usuario. No es urgente —describen medios que el comprador ya no puede elegir, no le prometen algo que no va a recibir— pero si la decisión se vuelve definitiva conviene alinearlos, junto con desactivar `bank_transfer` en el backend (mismo patrón que `cash`, con su test de contrato).
2. **Costo del primer cambio de talle**: sin definir (el texto hoy dice que se informa antes de confirmar). El documento recomienda el primero sin cargo.
3. **Medidas reales por producto**: las tablas publicadas son de referencia general.
4. Merge de `feature/centro-de-ayuda` y `npm run deploy` del frontend (FTP) — el backend no cambió.

### Cómo retomar

```bash
cd frontIndians && git checkout feature/centro-de-ayuda
npm run dev            # /tienda/ayuda
```

El contenido está todo en `src/pages/store/help/helpContent.ts`; los plazos, en `HELP_POLICY` al principio de ese archivo.
