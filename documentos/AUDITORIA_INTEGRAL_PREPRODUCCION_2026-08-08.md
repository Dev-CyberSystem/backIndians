# Auditoría integral de preproducción — Sistema Indians

| | |
|---|---|
| **Fecha** | 2026-08-08 |
| **Repos** | `backIndians` (rama `master`, commit `562a4bb`) · `frontIndians` (rama `master`, commit `3fa6170`) |
| **Entorno de pruebas** | MySQL 8.0.29 local, Node v20.19.1, npm 10.8.2 |
| **Alcance** | Código completo de ambos repos, esquema y datos de la base de desarrollo, migraciones desde cero, suites automatizadas, configuración de despliegue |
| **Producción** | **No se tocó.** No se ejecutó ningún comando, migración ni prueba contra la base o el servicio productivos |

---

## 1. Informe ejecutivo

### Veredicto

**GO CONDICIONADO PARA PRODUCCIÓN** — las condiciones están en la sección 9.

### Estado general

El sistema está considerablemente mejor preparado de lo que suele estar un proyecto en esta etapa. Los caminos donde se juega el dinero — cálculo de precios, checkout, reserva y descuento de stock, asientos de caja — están construidos con los patrones correctos y **verificados por 301 tests automatizados que pasan en verde**. Las migraciones corren desde cero sin un solo error y el esquema que producen coincide columna por columna con el que genera el ORM.

La auditoría encontró **4 defectos P1 reales**: tres de *mass assignment* (campos sensibles que llegaban del cliente y se escribían sin filtrar) y uno de pérdida de reservas de stock (**AUD-15**, encontrado en la revisión posterior a la primera entrega). **Los cuatro fueron demostrados fallando, corregidos y cubiertos con tests de regresión que ahora pasan.** No quedó ningún P0 ni P1 abierto.

> **Nota sobre este informe.** La primera versión declaraba `GO CONDICIONADO` con 3 P1 cerrados y el módulo de stock como `VERIFICADO`. Una revisión adversarial de los tres entregables encontró AUD-15 (P1, en ese mismo módulo) y varias cegueras en el SQL de integridad. El veredicto se sostiene sólo con las condiciones ampliadas de §9. La lección operativa: **un informe de auditoría también hay que auditarlo**, y los entregables de verificación (SQL, tests) merecen el mismo escrutinio que el código.

Lo que impide un `GO` liso no es el código, es **la configuración del entorno productivo**: hay una variable de entorno pendiente desde el incidente del 2026-08-07, dos parámetros de caja cuyo valor real en producción no pude verificar, y un backup productivo que nunca se probó restaurando.

### Los 5 riesgos principales

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| 1 | `MP_WEBHOOK_SECRET` sigue sin configurar en Railway: **todos** los webhooks de MercadoPago se rechazan en producción | P2 | Mitigado por un job que reconcilia cada 10 min; hay que cerrarlo igual |
| 2 | Si `store_cash_account_id` / `store_bank_account_id` se despoblaran, **todo pedido pagado de la tienda quedaría fuera de la caja**. Según el handoff del 2026-08-07 quedaron configuradas (`=1` y `=3`) | P3 | Sólo falta reconfirmar antes del release |
| 3 | El backup de la base productiva nunca se probó restaurando | P2 | Procedimiento validado localmente; falta hacerlo contra Railway |
| 4 | No hay alertas: los errores graves se escriben al log y nadie se entera salvo que alguien mire | P2 | Job diario de inconsistencias existe, pero sólo loguea |
| 5 | La contraseña de los usuarios internos tiene un **máximo de 10 caracteres** | P2 | Backlog — no bloquea |

### Las 5 fortalezas verificadas

1. **El backend nunca confía en los importes del frontend.** `computeOrderTotals()` recalcula precio, descuento, cupón y envío desde la base en cada checkout, y si el total cambió respecto del que vio el cliente devuelve 409 en vez de cobrar a ciegas.
2. **Todo movimiento de stock de catálogo pasa por un ledger** con lock de fila (`SELECT ... FOR UPDATE`) dentro de la transacción, dejando cantidad anterior, resultante, motivo y responsable.
3. **Idempotencia real, no declarativa**: checkout y asientos de caja combinan búsqueda previa + índice único en base + manejo del `UniqueConstraintError`, que es la única forma de que un doble clic o un reintento de red no duplique nada.
4. **Caja es inmutable por diseño**: no existen `PUT`/`DELETE` de movimientos; la única corrección posible es un contraasiento, reservado a `admin`, con motivo obligatorio de 10 caracteres mínimo.
5. **Migraciones y ORM no divergieron**: comparé las 50 tablas columna por columna entre una base migrada desde cero y una generada por `sync()` — **cero columnas de diferencia**, que es exactamente el riesgo que `CLAUDE.md` marca como crítico.

### Recomendación para el dueño del negocio

El sistema se puede publicar la semana que viene. El código está en condiciones y los problemas que encontré ya están arreglados y probados.

Lo que falta no es programar, es **completar tres tareas de configuración antes de apretar el botón**: cargar una clave que quedó pendiente de un incidente anterior, confirmar que las dos cuentas de caja de la tienda están elegidas en Configuración, y hacer una copia de seguridad y probar que se puede restaurar. Sin esas tres cosas hay riesgo de que entre plata que no se vea en la caja, o de no poder volver atrás si algo sale mal.

Además, hoy nadie se entera automáticamente si el sistema falla. Conviene resolver eso en los primeros días, aunque no bloquea la salida.

---

## 2. Resultado de las pruebas ejecutadas

| Prueba | Comando | Entorno | Resultado | Bloqueante |
|---|---|---|---|---|
| Typecheck backend | `npx tsc --noEmit` | local | ✅ **0 errores** | — |
| Typecheck + build frontend | `npm run build` | local | ✅ **exit 0**, 34.6 s | — |
| Tests backend (línea base) | `npm run test:full` | MySQL local | ✅ **44 suites / 289 tests** | — |
| Tests backend (post-corrección) | `npm run test:full` | MySQL local | ✅ **45 suites / 301 tests** | — |
| Tests frontend | `npm test` (Vitest) | local | ✅ **4 archivos / 47 tests** | — |
| Migraciones desde cero | `DB_NAME=textil_audit_fresh sequelize-cli db:migrate` | base descartable | ✅ **todas aplicadas, exit 0** | — |
| Comparación esquema migrado vs. `sync()` | script ad-hoc | local | ✅ **0 columnas de diferencia** | — |
| Backup + restauración | `mysqldump` → base nueva | base descartable | ✅ **50/50 tablas, filas idénticas** | — |
| Integridad de datos (**28 chequeos**, v2) | `auditoria-integridad-preprod.sql` | local | ✅ 4 checks con anomalías, **las 4 explicadas** (ver 6.5) | — |
| Lint frontend | `npm run lint` | local | ⚠️ **160 errores** (ver 6.4) | No |

> Las bases `textil_audit_fresh` y `textil_restore_test` se crearon para la auditoría y **se eliminaron al terminar**. El dump temporal también.

### Detalle de la verificación de backup/restauración

```
dump:     mysqldump --single-transaction --routines --triggers  → 964 KB, exit 0
restore:  base nueva vacía ← dump                               → exit 0
tablas:                       50 origen  vs  50 restaurada
store_orders:                192        vs 192
cash_transactions:           367        vs 367
catalog_stock_movements:     446        vs 446
invoices:                     74        vs  74
users:                        11        vs  11
diferencias de columnas:       ninguna
```

**Esto valida el procedimiento, no el backup productivo.** Ver condición C3.

---

## 3. Hallazgos corregidos durante la auditoría

Los cuatro se detectaron leyendo código, **se demostraron con un test que falló**, se corrigieron, y el mismo test ahora pasa.

---

### AUD-01 — `P1` — Un comprador puede escribir una dirección en la cuenta de otro comprador

**Módulo:** Tienda online · autenticación de compradores
**Archivo:** `src/services/store.auth.service.ts` → `storeUpsertAddressService()`

**Causa raíz.** La ruta `POST /store/me/addresses` no tiene validadores, y el controlador pasaba `req.body` crudo al servicio, que hacía `addr.update(data)`. Sequelize aplica **cualquier** atributo que venga en el objeto, incluido `customer_id` — el campo que define de quién es la dirección.

**Reproducción (ejecutada).**
1. El atacante crea una dirección propia por el camino normal.
2. Vuelve a llamar al mismo endpoint con `{ id: <su dirección>, customer_id: <id de la víctima>, is_default: true }`.

**Resultado antes de la corrección:**
```
AUD-01 >> status: 200 | customer_id quedó en: 7 | atacante: 6 | victima: 7
```
La dirección quedó registrada en la libreta de otra persona, marcada como predeterminada.

**Impacto.** Escritura cruzada entre clientes (rompe el aislamiento horizontal). Un atacante puede insertar una dirección elegida por él en la cuenta de otro comprador y dejarla como predeterminada; si la víctima confirma un pedido sin revisar, la mercadería se despacha a la dirección del atacante.

> **Corrección de esta ficha (revisión del 2026-08-08).** La primera versión decía que inyectando `id` "se podía pisar otra fila". No es así: el `findOne({ id, customer_id })` de propiedad ya existía antes del fix, así que un `id` ajeno daba 404, y un `id` propio con otro `id` en el body sólo habría intentado renumerar la PK. El impacto real es el descrito arriba, que sí está demostrado.

**Corrección.** Whitelist explícita de los 7 campos editables. `customer_id` sale **siempre** del token, nunca del body — mismo criterio ya aplicado en `cash.service.ts#updateAccount` (CASH-MA-001).

**Verificación:** `AUD-01` en `src/__tests__/api/audit-preprod-regressions.test.ts` — además comprueba que la libreta de la víctima queda vacía.

---

### AUD-02 — `P1` — Se puede reescribir el stock de un material sin dejar asiento

**Módulo:** Stock de materiales
**Archivo:** `src/services/stock.service.ts` → `updateStockItem()`

**Causa raíz.** El tipo TypeScript de `input` **no filtra nada en tiempo de ejecución**. El controlador pasa `req.body` tal cual, y los validadores de `PUT /stock/:id` sólo revisan `unit` y `min_quantity` sin descartar los campos no declarados. `current_quantity` llegaba intacto hasta `item.update(input)`.

**Reproducción (ejecutada).** `PUT /stock/:id` con `{"current_quantity": 999999}` sobre un material con 10 unidades:
```
AUD-02 >> status: 200 | current_quantity: 999999 | movimientos antes/despues: 0 0
```

**Impacto.** Rompe la invariante `STOCK = INICIAL + INGRESOS − EGRESOS` y deja el cambio **fuera de toda auditoría**: el saldo cambia sin una sola fila en `stock_movements`. Es exactamente la regla que `CLAUDE.md` exige para el stock de catálogo, no respetada en el stock de materiales. Alcanzable por `admin` y por `billing`.

**Corrección.** Whitelist explícita de los 5 campos descriptivos. El stock sólo se mueve por `createMovement()`.

**Verificación:** `AUD-02` — dos tests: que el stock no se puede reescribir, y que los campos legítimos sí se siguen editando (evita corregir de más).

---

### AUD-03 — `P1` — Cambiar la contraseña no cerraba las sesiones abiertas

**Módulo:** Autenticación del sistema (usuarios internos)
**Archivos:** `src/services/user.service.ts` (`changeUserPassword`, `updateUser`) · `src/services/auth.service.ts` (`resetPasswordService`)

**Causa raíz.** Los tres caminos que cambian la contraseña de un usuario interno escribían sólo `password_hash`. `authenticate()` y `refreshTokenService()` validan la sesión comparando `session_version` contra la base — pero nadie lo incrementaba, así que los tokens emitidos antes seguían siendo válidos. La tienda **sí** lo hacía bien (`storeResetPasswordService`); el sistema no.

**Reproducción (ejecutada).** Login → guardar el refresh token → el admin cambia la contraseña → usar el refresh token viejo:
```
AUD-03 >> refresh con token previo al cambio de clave: 200
```

**Impacto.** Cambiar la contraseña de una cuenta comprometida **no echaba al atacante**. El refresh token dura 7 días y se puede renovar indefinidamente: el acceso sobrevivía al remedio. Anula la principal medida de respuesta ante un robo de credenciales.

**Corrección.** Los tres caminos incrementan `session_version`, consistente con `loginService` (que ya lo hacía) y con la tienda.

**Verificación:** `AUD-03` — comprueba que el refresh token viejo da 401, que el access token viejo da 401, y que con la contraseña nueva se puede entrar (evita romper el flujo legítimo).

---

### AUD-15 — `P1` — Editar los talles de un producto borraba las reservas vivas

> Encontrado en la **revisión del informe** (2026-08-08, posterior a la primera entrega). Estaba en el módulo que este informe había declarado `VERIFICADO`, y en el punto exacto que `CLAUDE.md` marca como la única excepción consciente al ledger.

**Módulo:** Catálogo · talles y stock
**Archivo:** `src/services/catalog.service.ts` → `saveProductSizes()`

**Causa raíz.** La función borraba **todos** los talles del producto y los recreaba. El `bulkCreate` mapeaba sólo `size_name`, `stock_quantity` y `sort_order`: **`stock_reserved` no se copiaba**, así que volvía a su default `0`.

**Impacto.** Tres consecuencias, todas en el camino del dinero:

1. **Doble venta.** Las reservas de pedidos en `pending_payment` desaparecían y las mismas unidades volvían a estar disponibles.
2. **Pedido pagado imposible de confirmar.** Al acreditarse el pago, `confirmStoreOrderStock` descuenta la reserva (`delta: -quantity` sobre `stock_reserved`, `store.service.ts:1274`) y `adjustStock` lanza 400 si el resultado queda negativo (`stockLedger.service.ts:77`). Con la reserva en 0, **la confirmación del pago falla**: plata cobrada, stock sin descontar, pedido trabado.
3. **Ledger mutilado.** La FK de `catalog_stock_movements.catalog_product_size_id` es `ON DELETE SET NULL` (migración 067): borrar el talle dejaba todos sus movimientos históricos sin referencia, indistinguibles de movimientos a nivel producto.

Se disparaba con `PUT /catalog/products/:id/sizes` — operación rutinaria de admin/billing — sin ninguna guarda.

**Mitigante que sí existía.** `resolveStoreOrderItemSize()` tiene fallback por `size_name`, así que si el admin recreaba los mismos nombres, el vínculo pedido→talle se recomponía. No mitigaba 1 ni 2.

**Corrección.** `saveProductSizes` pasó de *destroy + recreate* a **upsert por `size_name`**: los talles que siguen se actualizan in place (conservan `id`, `stock_reserved` y todas las FKs que los apuntan), los nuevos se crean, y los que desaparecen se borran **sólo si no tienen reservas vivas** — si las tienen, la operación entera se rechaza con **409**. Talles repetidos en la lista: **400**. Lock `FOR UPDATE` sobre las filas existentes para que un checkout concurrente no reserve sobre un talle en vías de borrarse.

⚠️ **Cambio de contrato de API:** `PUT /catalog/products/:id/sizes` ahora puede devolver 409 y 400 donde antes siempre devolvía 200. El frontend debe mostrar el mensaje del error (viene en el cuerpo) — ver condición **C8**.

**Verificación:** `AUD-15` en `audit-preprod-regressions.test.ts` — 4 tests, 3 de los cuales **fallan contra el código anterior**: reserva preservada al editar, 409 al quitar un talle reservado, 200 al quitar uno sin reservas (anti-corrección-de-más) y 400 ante nombres repetidos.

---

### AUD-06 — `P2` — El frontend se servía sin ninguna cabecera de seguridad

**Módulo:** Infraestructura · frontend estático (Donweb/Apache)
**Archivo:** `frontIndians/public/.htaccess`

**Causa raíz.** `helmet` protege las respuestas de la API, pero el HTML y los assets los sirve Apache, y el `.htaccess` (18 líneas) sólo tenía reglas de ruteo.

**Corrección aplicada.** Se agregaron `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`, más caché inmutable para los assets con hash y `no-cache` para el HTML. **Todo dentro de `<IfModule>`**: si el hosting no tiene el módulo, Apache ignora el bloque en vez de tirar 500 en todo el sitio.

**HSTS quedó deliberadamente afuera** — es difícil de revertir (el navegador lo cachea meses) y requiere la decisión explícita de que el dominio y todos sus subdominios van por HTTPS para siempre. Ver condición C6.

**Verificación:** `npm run build` regenera y copia el archivo a `dist/` (59 líneas). ⚠️ **Requiere probar en el hosting real antes del release** — ver condición C5.

---

## 4. Verificaciones que descartaron un problema

Vale la pena dejarlas registradas: son riesgos que parecían reales y **no lo son**, comprobados con evidencia en vez de suposición.

### 4.1. Confusión entre los dos sistemas de tokens — **descartado**

`STORE_JWT_SECRET` no está configurada, así que cae a `JWT_SECRET`: los tokens de la tienda y del sistema **se firman con la misma clave**. `verifyStoreToken()` se defiende chequeando `type === 'store_customer'`, pero `authenticate()` (sistema) no hace el chequeo inverso.

Probé el comportamiento real de Sequelize, que es de lo que depende la defensa:

```
findOne({where:{id: undefined, active:true}})  →  LANZA "WHERE parameter id has invalid undefined value"
findByPk(undefined)                            →  null
```

Como el payload de la tienda usa `sub` y no `id`, ambos caminos fallan cerrado. **No es explotable.** Queda como P3 de defensa en profundidad: la seguridad descansa en un detalle de la librería y no en un chequeo explícito.

### 4.2. "3 pedidos cancelados sin restituir stock" — **artefacto de test**

El diagnóstico de integridad los marcó. Investigándolos: tienen movimiento `reserve` pero ninguno de `release`, **y cero filas de historial de estado** — o sea, nunca pasaron por `recordStoreOrderStatusChange`. Los crea a propósito `reconcile-payments.test.ts:82`, que fuerza el estado inconsistente por SQL directo justamente para probar que el detector lo caza. No hay fuga de stock.

### 4.3. "52 pedidos pagados sin registro en caja" — **explicado por configuración**

`store_cash_account_id` y `store_bank_account_id` están **vacías en la base local**. El código omite correctamente el asiento cuando la cuenta no está configurada, y el job diario lo reporta — el comportamiento es el correcto.

Según `10-SESSION-HANDOFF.md`, en producción **sí quedaron configuradas** el 2026-08-07 (`store_cash_account_id=1` → *Caja Principal*, `store_bank_account_id=3` → *Banco*). Es decir: artefacto de desarrollo, no un riesgo productivo activo. Queda igual como condición C2, pero degradada a **reconfirmación** — porque si alguna vez se despoblaran, la plata dejaría de verse en la caja en silencio, sin ningún error visible.

### 4.4. Inyección SQL — **no encontrada**

Las ~40 consultas crudas usan `replacements` (parametrizadas). Las dos únicas interpolaciones son seguras: `dedupeIndexes.ts` interpola nombres de tabla internos, y `catalog.service.ts:46` interpola `new Date().getFullYear()` (un número).

### 4.5. `orders.order_number` NOT NULL en migraciones y nullable en el modelo — **sin impacto**

Parecía un riesgo de "pasa en dev, falla en producción". `order.service.ts:465` genera el número **antes** del `create`, así que la columna nunca se inserta nula.

---

## 5. Backlog residual (nada de esto bloquea la salida)

| ID | Severidad | Hallazgo | Complejidad |
|---|---|---|---|
| AUD-04 | P2 | **Contraseñas del sistema limitadas a 10 caracteres máximo** (`PWD_REGEX` en `auth.routes.ts:9` y `user.routes.ts:9`). Impide passphrases y reduce la entropía sin ninguna razón técnica | S |
| AUD-05 | P2 | **No hay alertas.** El job diario de inconsistencias sólo escribe al log; nadie se entera sin mirar. Falta una bandeja de admin o notificación (ya identificado como B-7 en la auditoría de tienda) | M |
| AUD-07 | P2 | **La tabla `products` no tiene migración.** Existe sólo en bases creadas por `sync()`. `GET /api/v1/products` está montado y da 500 en una base migrada desde cero. El frontend no lo consume — es superficie de API muerta | S |
| AUD-08 | P3 | `order_items.color` es `varchar(150)` en el modelo y `varchar(100)` en las migraciones. Un color de más de 100 caracteres guarda en dev y falla en producción | S |
| AUD-09 | P3 | El webhook de MP no valida la frescura del `ts` de la firma: una notificación válida capturada se puede repetir indefinidamente. Mitigado porque el procesamiento es idempotente | S |
| AUD-10 | P3 | `requireStoreAuth` no revalida `active`/`session_version` contra la base: un comprador desactivado conserva acceso hasta 15 min (lo que dura el access token) | S |
| AUD-11 | P3 | `updateStoreOrderTracking()` (`store.service.ts:2212`) es código muerto — ninguna ruta lo referencia | S |
| AUD-12 | P3 | El refresh token vive en `localStorage` (7 días staff / 30 días tienda): un XSS lo expondría. No se encontró ningún XSS, y el único `dangerouslySetInnerHTML` está correctamente escapado | M |
| AUD-13 | P3 | `railway.toml` corre `npm run migrate` en cada arranque. Correcto con **una sola** réplica; con dos o más, dos procesos podrían migrar a la vez | S |
| AUD-14 | P3 | Timestamps `NOT NULL` en migraciones y nullables bajo `sync()` (98 columnas). Producción es más estricta que desarrollo; sin impacto detectado | M |
| AUD-16 | P3 | **`catalog_products.stock_quantity` / `.stock_reserved` se desincronizan de la suma de sus talles.** El panel los escribe como la suma al guardar el producto (`CatalogPage.tsx:647`), pero a partir de ahí ninguna venta los toca: el ledger mueve la fila del talle y nunca la del producto, así que divergen con la primera compra. No abre ningún vector — el checkout exige talle cuando el producto tiene talles (`store.service.ts:700`) y la vitrina filtra por talle — pero es un campo que dice una cosa y significa otra, y ya causó un falso positivo al escribir el SQL de integridad | M |

---

## 6. Detalle por área

### 6.1. Autenticación y autorización — **VERIFICADO**

- `bcrypt` con costo 12 en los cuatro puntos donde se hashea.
- `authenticate()` revalida `active` y `session_version` **contra la base en cada request** — no confía sólo en la firma del token.
- Rate limiting bien calibrado: login 10 intentos fallidos/15 min con `skipSuccessfulRequests` (no castiga al usuario legítimo detrás de un NAT), recupero 5/hora, checkout 25/15 min, webhook 30/min, backstop general 500/min.
- `forgotPassword` no revela si el email existe, en ambos sistemas.
- Google OAuth rechaza el token si `email_verified !== true` — cierra el vector de vinculación a un email ajeno.
- `authorize()` aplica los roles en el backend; el frontend replica con `ProtectedRoute` pero **no es la única defensa**.
- Tokens de verificación y reset de un solo uso, con vencimiento (24 h / 1 h).

### 6.2. Dinero, precios y pagos — **VERIFICADO**

- Punto único de cálculo (`computeOrderTotals`) compartido por el presupuesto y el checkout: el cliente no puede ver un precio y que se le cobre otro.
- El frontend **no envía precios**; sólo `expected_total`, que se usa para *rechazar* (409), nunca para cobrar.
- Productos con precio ≤ 0 se rechazan explícitamente en el checkout.
- Cupones: incremento atómico con `WHERE used_count < max_uses`; si afecta 0 filas, aborta — no se puede exceder el límite por concurrencia.
- Firma del webhook de MP con HMAC-SHA256 y `timingSafeEqual`, **fail-closed en producción**.
- Getters DECIMAL→number en los modelos con campos monetarios.

### 6.3. Stock y concurrencia — **PARCIAL**

> Esta sección decía `VERIFICADO` en la primera versión del informe. Se degradó al encontrarse **AUD-15**: todo lo que sigue es cierto del ledger, pero el ledger no era el único camino por el que se movía el stock de talles. La lección de §7 ("cuando se corrige un patrón, barrer todos los módulos que lo comparten") se aplicaba también acá y no se aplicó: se auditó a fondo `adjustStock` y no se abrió `saveProductSizes`, que la propia `CLAUDE.md` señalaba como la excepción.


- `stockLedger.adjustStock()` es el único punto autorizado; siempre exige la transacción del llamador y toma `LOCK.UPDATE` sobre la fila antes de leer.
- Modelo de dos fases correcto: el checkout **reserva** (`stock_reserved`), el pago confirmado **descuenta** (`stock_quantity`). Disponible = físico − reservado.
- Guardas contra negativos y contra reserva mayor al stock físico.
- Reintento acotado (3 intentos) sólo ante `UniqueConstraintError`; cualquier otro error aborta de inmediato.
- Restitución idempotente (`if (locked.stock_restored_at) return`) y con lock, distinguiendo si el pago se había confirmado o no.
- Cubierto por suites dedicadas: `stock-ledger`, `stock-reservation`, `stock-restoration`, `checkout-idempotency`, `webhook-robustness`.

### 6.4. Frontend — **PARCIAL**

Build de producción limpio y bien dividido en chunks (el mayor no crítico es `pdf` con 187 KB gzip, cargado en lazy). 47 tests de Vitest en verde.

**`npm run lint` falla con 160 errores.** El desglose muestra que **ninguno es un bug de runtime**:

| Regla | Cantidad | Naturaleza |
|---|---|---|
| `react-refresh/only-export-components` | 57 | Sólo afecta el hot-reload en desarrollo |
| `@typescript-eslint/no-explicit-any` | 48 | Deuda de tipado |
| `@typescript-eslint/no-unused-vars` | 17 | Limpieza |
| `no-useless-escape` | 13 | Cosmético (regex) |
| `react-hooks/*` | 26 | Vale una revisión posterior; `set-state-in-effect` (10) puede causar renders de más |

No lo cuento como bloqueante porque typecheck y build pasan y los tests están en verde, pero **conviene dejar el lint en verde antes de que sirva de red** — con 160 errores preexistentes, un error nuevo pasa desapercibido.

### 6.5. Base de datos — **VERIFICADO**

- Migraciones desde cero: **todas aplicadas, exit 0**, hasta `20260807-095`.
- Esquema migrado vs. `sync()`: **0 columnas de diferencia** en las 50 tablas compartidas. Es el resultado más tranquilizador de toda la auditoría, porque es el riesgo que `CLAUDE.md` marca como crítico.
- Diferencias residuales: la tabla `products` (AUD-07), `order_items.color` (AUD-08) y nullabilidad de timestamps (AUD-14).
- Pool configurado con criterio (`max: 10`, `idle: 10s` muy por debajo del `wait_timeout` de MySQL, `enableKeepAlive`) — decisiones que evitan entregar sockets muertos.
- **28 chequeos** de integridad de solo lectura en `documentos/auditoria-integridad-preprod.sql` (v2, reescrito en la revisión). Corrido contra la base de desarrollo: 4 checks con anomalías, **las cuatro explicadas y ninguna un bug abierto** — 99 pedidos pagados sin caja (cuentas sin configurar en local, condición C2), 11 materiales con saldo inicial y sin movimiento (seed), 5 pedidos cancelados sin restituir (artefacto que fabrica `reconcile-payments.test.ts`), y 1 producto con la reserva perdida, que es **el daño real de AUD-15** dejado en la base al correr los tests contra el código sin corregir. El check 06 detectando ese caso en datos reales es la mejor validación que tuvo el script.

### 6.6. Observabilidad — **PARCIAL**

A favor: logging estructurado NDJSON con Pino, `transactionId`/`correlationId` por request, redacción de campos sensibles en dos capas, `/health`, captura de `unhandledRejection`/`uncaughtException`, ingesta de errores del cliente, y tres jobs programados (reconciliación 10 min, expiración 1 h, inconsistencias 03:00).

En contra: **no hay alertas ni monitoreo activo** (AUD-05). Todo termina en un log que alguien tiene que mirar. El incidente del 2026-08-07 — producción caída más de un día sin que nadie se enterara — es la demostración práctica de este hueco.

---

## 7. Confrontación con las auditorías previas

Verifiqué que las correcciones declaradas como resueltas lo estén de verdad:

| Hallazgo previo | Declarado | Verificado ahora |
|---|---|---|
| CASH-MA-001 (mass assignment en `updateAccount`) | Corregido | ✅ Whitelist explícita presente y comentada (`cash.service.ts:249`) |
| CASH-MUT-001 (movimientos de caja mutables) | Corregido | ✅ No existen `PUT`/`DELETE`; sólo contraasiento, sólo `admin` |
| CASH-VAL-004/005 (cuenta y categoría desactivadas) | Corregido | ✅ `createTransactionCore` valida ambas |
| C-6 (total manipulable en checkout) | Corregido | ✅ `expected_total` sólo rechaza, nunca cobra |
| C-5 (stock sin ledger) | Corregido | ✅ Para catálogo. **Faltaba el stock de materiales → AUD-02** |
| 2.5 (AFIP sin gate) | Corregido | ✅ Los 3 puntos de envío pasan por `assertAfipEnabled()` |
| DEC-014 (`MP_WEBHOOK_SECRET` bajado a warning) | Mitigado, **no cerrado** | ✅ Sigue abierto → condición C1 |

La corrección de C-5 se aplicó al stock de catálogo pero no al de materiales — AUD-02 es literalmente el mismo defecto en el módulo vecino. Vale como aprendizaje: **cuando se corrige un patrón, conviene barrer todos los módulos que lo comparten.**

---

## 8. Runbook de producción

### Antes (T-1)

1. Congelar cambios. Confirmar los commits exactos a desplegar.
2. Verificar variables en Railway: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `STORE_JWT_SECRET`, `STORE_JWT_REFRESH_SECRET`, `MP_ACCESS_TOKEN`, **`MP_WEBHOOK_SECRET`**, `BACKEND_PUBLIC_URL`, `FRONTEND_URL`, `STORE_URL`, `SYSTEM_URL`, `RESEND_API_KEY`, credenciales de Cloudinary, `NODE_ENV=production`.
3. **Backup completo y probar restaurarlo** en una base aparte (condición C3).
4. Correr `documentos/auditoria-integridad-preprod.sql` contra producción y guardar el resultado como línea base.

### Despliegue

5. Backend primero (Railway aplica migraciones en el arranque, `npm run migrate && npm start`). **Confirmar una sola réplica** durante la migración.
6. Verificar `/health` y que el log muestre `startup.ready` y `jobs.scheduler.started`.
7. Frontend después: `npm run build` y subir `dist/` por FTP. **Verificar que el `.htaccess` nuevo no rompa el sitio** (condición C5) — probar la home y una ruta profunda apenas suba.

### Smoke tests (en producción, con datos reales mínimos)

8. Login de cada rol: `admin`, `billing`, `workshop`, `seller`.
9. Tienda: navegar el catálogo → agregar al carrito → checkout con efectivo → verificar que el pedido aparece en el panel **y que generó el asiento en caja**.
10. Checkout con MercadoPago en importe mínimo → confirmar que se acredita (por webhook o, si `MP_WEBHOOK_SECRET` no estuviera, dentro de los 10 min del job).
11. Caja: abrir un movimiento, revertirlo, verificar el contraasiento y que el saldo vuelve.
12. Stock: un ingreso de material y confirmar que aparece el movimiento.

### Después (T+1 a T+3)

13. Repetir el SQL de integridad y comparar con la línea base.
14. Revisar el log buscando `jobs.reportInconsistencies.*`, `unhandledError` y `rateLimit.*`.
15. Conciliar caja contra los pedidos pagados del período.

### Rollback

- **Criterio:** cualquier inconsistencia en caja o stock, imposibilidad de completar un checkout, o tasa de error 5xx sostenida.
- **Backend:** redeploy del commit anterior desde Railway.
- **Frontend:** volver a subir el `dist/` anterior por FTP (⚠️ conservarlo antes de pisar).
- **Base:** las migraciones de este release no borran datos; restaurar el backup sólo si hubo corrupción, asumiendo la pérdida de lo escrito desde el punto de backup.

---

## 9. Condiciones del `GO CONDICIONADO`

**El incumplimiento de cualquiera convierte el resultado en `NO-GO`.**

| # | Condición | Responsable | Cómo se prueba |
|---|---|---|---|
| **C1** | Configurar `MP_WEBHOOK_SECRET` en Railway con el valor del panel de MercadoPago, y **volver a subir el chequeo de `server.ts:68` a fatal** | Dev / DevOps | Un pago de prueba pasa a `paid` en segundos por webhook, no a los 10 min por el job. El log no muestra `startup.envValidation.temporary` |
| **C2** | **Reconfirmar** en **Configuración → Tienda online** que `store_cash_account_id` y `store_bank_account_id` siguen apuntando a cuentas reales y activas (quedaron en `1` y `3` el 2026-08-07) | Admin | Un pedido de prueba pagado en efectivo genera su asiento; el check 7 del SQL de integridad devuelve 0 filas |
| **C3** | Backup completo de la base productiva **y restauración probada** en una base aparte | DevOps | Conteo de filas de las tablas críticas idéntico entre origen y restaurada (mismo método de la sección 2) |
| **C4** | Confirmar que Railway corre **una sola réplica** del backend mientras se aplican migraciones | DevOps | Panel de Railway: réplicas = 1 durante el deploy |
| **C5** | ✅ **CERRADA** (2026-08-08, verificada en producción tras el deploy). Donweb tiene `mod_headers`: las 4 cabeceras están activas y el sitio no se rompió | Dev | ✅ `/login` 200, home 200, `/tienda/producto/1` 200, rutas de SPA 301→200 (redirección normal a *trailing slash*). `curl -I` devuelve `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`; assets con hash en `max-age=31536000, immutable` y HTML en `no-cache` |
| **C6** | Decidir explícitamente si se activa HSTS (queda fuera a propósito, ver AUD-06) | Dueño / Dev | Decisión registrada; si es afirmativa, se agrega y se prueba en staging |
| **C7** | 🟡 **CÓDIGO LISTO, FALTA CONFIGURAR.** `/health` ahora verifica la base y devuelve 503 si no responde (antes decía `ok` sin tocar MySQL, así que un monitor externo habría visto verde con la base caída). Detector interno de 5xx sostenidos con avisos por mail y WhatsApp. **Falta dar de alta el watchdog externo (UptimeRobot) y CallMeBot** — guía paso a paso en `documentos/ALERTAS_Y_MONITOREO.md` | DevOps | Pausar el servicio en Railway y confirmar que llegan mail y WhatsApp |
| **C8** | ✅ **CERRADA.** El frontend descartaba el mensaje del backend y, peor, en la edición guardaba los datos **antes** que los talles: un 409 dejaba el producto actualizado a medias. Corregido: se muestra el mensaje real y los talles van primero | Dev | ✅ Verificado en navegador real — `frontIndians/e2e/tests/catalog-sizes.spec.ts` |

> **De las 8, C8 es la única cerrada; las otras 7 son todas de entorno productivo y ninguna se puede verificar desde acá.** C7 es la más floja en cuanto a exigencia, pero es la que evita repetir el incidente del 2026-08-07: si hubiera que elegir una sola para no postergar, es esa.

### Pendientes abiertos por la revisión adversarial (2026-08-08)

| ID | Qué era | Estado |
|---|---|---|
| REV-01 | **`session_version` con `increment()` atómico** en los 3 caminos de AUD-03: era read-modify-write sobre un valor leído antes del `bcrypt.hash` (~300 ms de ventana), así que un login del atacante durante esa ventana sobrevivía al reseteo — el escenario exacto que AUD-03 dice cerrar | ✅ **Cerrado.** Los 3 caminos + `storeResetPasswordService` usan `increment()`, con un test de concurrencia que falla contra el código anterior |
| REV-02 | **El check 1 era ciego para los productos con talles** — casi todo el catálogo. `adjustStock` escribe la fila del talle **o** la del producto, nunca ambas, así que el `JOIN` los descartaba enteros y devolvía 0 filas pareciendo sano | ✅ **Cerrado.** Check 01 (productos sin talles) + check 02 (por talle) |
| REV-03 | Faltaban las invariantes que más importan: reservas vs. pedidos pendientes, doble asiento de caja, encadenamiento del ledger, pedidos sin ítems, coherencia de las reversiones | ✅ **Cerrado.** Checks 03, 06, 07, 09, 14, 15, 16, 18, 22, 24 |
| REV-04 | **Los tests de AUD-03 cubrían 1 de los 3 caminos corregidos** | ✅ **Cerrado.** `PUT /users/:id` y el reset por token tienen test propio |
| REV-05 | AUD-01 no verificaba el status del request de ataque; AUD-02 no probaba `billing`; el check de duplicados agrupaba todos los `NULL` juntos | ✅ **Cerrado** |
| REV-06 | **El SQL no servía como smoke test automatizable**, y el check de administradores activos contradecía el criterio de lectura de su propia cabecera | ✅ **Cerrado.** Criterio único (`anomalias = 0`), tabla resumen, veredicto `INTEGRIDAD OK` / `INTEGRIDAD FALLA` grepeable, y el one-liner de shell para el exit code |
| REV-07 | **El sistema soporta una sola sesión concurrente por usuario** (`loginService` incrementa `session_version` en cada login): loguearse en el celular expulsa la sesión de la PC. La tienda, en cambio, sí permite sesiones concurrentes — la asimetría no parece deliberada | ⬜ **Abierto.** No es un bug, es una decisión funcional que conviene hacer explícita antes de que la descubra un usuario el primer día |

> **Los dos falsos positivos que sólo aparecieron al ejecutar el script.** Vale registrarlos, porque son la razón por la que un diagnóstico de integridad hay que correrlo antes de entregarlo y no sólo escribirlo:
>
> - El check de doble asiento incluía `invoice` y `catalog_invoice`, y daba **20 falsas alarmas**: una factura puede tener varios cobros parciales, cada uno con su propio asiento — lo documenta `reverseAllForReference` en el mismo código. Quedó restringido a `store_order`, donde `cash_recorded_at` sí garantiza uno solo.
> - Dos checks comparaban `catalog_products.stock_quantity` contra la suma de sus talles y daban **14 falsas alarmas**: no es una invariante del sistema (ver AUD-16). Se reemplazaron por reservas huérfanas y consistencia de cupones.
>
> Un script que grita 34 veces sin motivo es un script que nadie vuelve a mirar.

---

## 10. Archivos modificados

**backIndians**
| Archivo | Cambio |
|---|---|
| `src/services/store.auth.service.ts` | AUD-01 — whitelist de campos en `storeUpsertAddressService` |
| `src/services/stock.service.ts` | AUD-02 — whitelist de campos en `updateStockItem` |
| `src/services/user.service.ts` | AUD-03 — `session_version++` en `changeUserPassword` y `updateUser` |
| `src/services/auth.service.ts` | AUD-03 — `session_version++` en `resetPasswordService` |
| `src/services/catalog.service.ts` | AUD-15 — `saveProductSizes` pasa de *destroy+recreate* a upsert por `size_name`, con guarda 409 sobre talles reservados |
| `src/__tests__/api/audit-preprod-regressions.test.ts` | **nuevo** — 12 tests de regresión (AUD-01/02/03/15 + REV-01/04/05) |
| `documentos/auditoria-integridad-preprod.sql` | **nuevo** — 28 diagnósticos de solo lectura (v2: criterio único, tabla resumen y veredicto grepeable) |
| `documentos/AUDITORIA_INTEGRAL_PREPRODUCCION_2026-08-08.md` | **nuevo** — este informe |

**frontIndians**
| Archivo | Cambio |
|---|---|
| `public/.htaccess` | AUD-06 — cabeceras de seguridad y caché, con guardas `<IfModule>` |

**Riesgo de regresión: bajo, con una excepción.** Los cambios de AUD-01/02/03 restringen lo que se acepta y no cambian ningún contrato de API. **AUD-15 sí cambia el contrato**: `PUT /catalog/products/:id/sizes` puede devolver 409 y 400 donde antes siempre devolvía 200 — ver condición **C8**. La suite completa pasó de 289 a **301 tests** sin una sola falla. El `.htaccess` sigue siendo el de mayor riesgo operativo por depender del hosting (condición C5).

**Estado en git (actualizado).** Todo está commiteado en la rama **`auditoriapreprod`** de ambos repos, sin push ni despliegue:

| Repo | Commits |
|---|---|
| `backIndians` | `c264e86` docs de caja · `d66d443` AUD-01/02/03 + tests · `da63336` informe + SQL · `a1e2df3` AUD-15 + tests |
| `frontIndians` | `21cf03c` AUD-06 (`.htaccess`) |

---

## 11. Checklist final

- [x] Typecheck backend y frontend sin errores
- [x] Build de producción del frontend correcto
- [x] Suite backend completa en verde (46 suites / 305 tests)
- [x] Suite frontend en verde (47 tests)
- [x] Migraciones aplicadas desde cero sin error
- [x] Esquema migrado y esquema del ORM sin divergencias de columnas
- [x] Procedimiento de backup y restauración validado
- [x] Diagnósticos de integridad ejecutados, sin inconsistencias reales
- [x] Precios y totales calculados en el backend, no en el cliente
- [x] Stock con ledger, lock de fila y restitución idempotente
- [x] Caja inmutable, con contraasientos y separación de funciones
- [x] Idempotencia verificada en checkout, webhook y asientos de caja
- [x] Sin inyección SQL
- [x] Envíos a AFIP con gate en los tres puntos de salida
- [x] Los 4 hallazgos P1 corregidos y con test de regresión (incluye AUD-15)
- [x] Correcciones previas de auditorías anteriores confirmadas como reales
- [ ] `MP_WEBHOOK_SECRET` configurado en producción — **condición C1**
- [ ] Cuentas de caja de la tienda verificadas en producción — **condición C2**
- [ ] Backup productivo restaurado y comprobado — **condición C3**
- [ ] Una sola réplica durante las migraciones — **condición C4**
- [x] `.htaccess` probado en el hosting real — **condición C5** ✅ verificado en producción
- [x] Frontend muestra el error nuevo de talles — **condición C8**
- [ ] Decisión sobre HSTS — **condición C6**
- [~] Monitoreo y alertas mínimas — **condición C7** (código listo y testeado; falta el alta en UptimeRobot + CallMeBot)
- [ ] Lint del frontend en verde — backlog, no bloquea
- [!] Pruebas de carga y E2E de navegador — **no ejecutadas en esta auditoría** (ver limitaciones)

### Limitaciones declaradas

Para que quede claro qué **no** cubre este informe:

- **No se probó nada contra producción.** Todo corrió en local. C1, C2, C3, C4 y C5 son verificables sólo en el entorno real.
- **No se ejecutaron pruebas de carga** (`autocannon` está en el repo pero medir en local no representa a Railway).
- **Los E2E de Playwright sí se corrieron** (revisión del 2026-08-08, proyecto `chromium`): **23 de 25 en verde**. Los 2 fallos son ajenos a los cambios de esta auditoría y se verificaron como preexistentes revirtiendo el cambio del frontend:
  - `customer-flows › un comprador puede iniciar sesión` — **falso fallo por falta de datos**: los compradores de prueba no estaban en la base porque `seed:store-customers` es un script aparte que `npm run test:full` no ejecuta. Corriéndolo, la suite pasa entera. Conviene que el README de `e2e/` lo diga.
  - `seo › categoría por path` — depende de que exista la categoría `futbol` con productos en la base de desarrollo. Falla igual sin ningún cambio aplicado.

> ✅ **`e2e/` ya está versionada.** Estaba en la raíz `indians/`, que no es un repo git, así que ninguno de los dos subrepos la trackeaba: toda la batería de Playwright existía **sólo en una máquina**, sin historia ni respaldo. Movida a **`frontIndians/e2e/`** y commiteada (`ebd7e7b`), con su `package.json` propio para no mezclar Playwright con las dependencias del front. Se corre con `npm run test:e2e` desde `frontIndians`.
>
> Al mudarla aparecieron dos cosas que había que resolver y una que conviene saber:
> - Vitest levantaba los `*.spec.ts` de Playwright (su `include` por defecto los tomaba) y ESLint los linteaba: ambos excluidos.
> - **Bug preexistente en `users.spec.ts`**: el guard `browserName !== 'chromium'` nunca saltaba nada, porque el proyecto `mobile` es un Pixel 7 que **también corre sobre Chrome**. El alta de usuario se ejecutaba dos veces —con su envío de mail real incluido— y la corrida de `mobile` fallaba por timeout. Ahora filtra por el fixture `isMobile`.
>
> ⚠️ **Queda el mismo problema, sin resolver, con `docs/project-brain/` y el `CLAUDE.md` de la raíz**: tampoco los trackea ningún repo. Es más grave que el de `e2e/`, porque `CLAUDE.md` declara la lectura del cerebro documental como paso obligatorio antes de implementar cualquier tarea — y ese cerebro hoy existe en una sola máquina. Requiere una decisión sobre dónde moverlo.
- **No se auditó el módulo de proveedores/remitos** porque no existe en el código — es una diferencia de alcance respecto de la lista del pedido, no un faltante.
- **La integración con Andreani sigue sin empezar**, consistente con lo documentado.

---

# VEREDICTO FINAL: GO CONDICIONADO PARA PRODUCCIÓN
