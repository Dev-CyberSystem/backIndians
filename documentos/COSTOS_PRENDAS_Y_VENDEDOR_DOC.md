# Costos de prendas, tipos de prenda por cliente y carga de pedidos del vendedor

Documento técnico de las features desarrolladas. Cubre modelo de datos, endpoints,
UI, permisos, puesta en marcha y pruebas.

> Stack: backend Node + Express + Sequelize (MySQL), frontend React 19 + Vite +
> TanStack Query + Tailwind. Roles: `admin`, `billing` (facturación), `workshop`
> (taller), `seller` (vendedor).

---

## 1. Carga de pedidos del vendedor desde el catálogo

**Objetivo:** el vendedor carga pedidos **solo desde el catálogo** (botón "Pedido"
en cada producto) con una ficha técnica **reducida**.

### Comportamiento
- En `CatalogPage`, el botón **"Pedido"** de cada producto ahora también aparece
  para el vendedor (`canCreateOrder = isAdmin || isSeller`) y precarga el pedido
  con: cliente, **tipo de prenda** y **precio del producto** (oculto).
- Se quitó el botón **"Nuevo pedido"** de la lista de Pedidos para el vendedor
  (queda solo para admin/facturación).
- La ficha técnica (`OrderItemForm`) tiene un **modo restringido** (`restricted`,
  activado por `role === 'seller'`). En ese modo el vendedor ve **solo**:
  - Card **Datos Generales** (cliente, fecha de entrega, notas).
  - En Ítems: **tipo de prenda**, **talles con cantidades** y **personalización**
    (incluye datos por jugador).
  - Se ocultan: telas, precio/notas del ítem, diseño y colores, materiales,
    detalle de tela, sponsors, bordado, accesorios, subida de tabla de talles,
    agregar/quitar ítem y la card **Imágenes de referencia**.

### Reglas de negocio
- **Precio:** el ítem toma automáticamente `product.price` (viaja en el estado de
  precarga, oculto al vendedor) para que la factura automática salga con el total
  correcto.
- **Color:** el vendedor no lo carga. Backend relajado: `items.*.color` pasó de
  obligatorio a opcional (`order.routes.ts`) y `buildItemsPayload` usa
  `item.color || ''` (la columna sigue NOT NULL, sin migración). Billing/admin
  completan color y el resto de la ficha en la revisión (`pending → under_review`).

### Archivos
- Frontend: `OrderItemForm.tsx` (prop `restricted`), `NewOrderPage.tsx`,
  `CatalogPage.tsx` (botón Pedido para vendedor), `OrdersPage.tsx` (quita botón).
- Backend: `order.routes.ts`, `order.service.ts`.

---

## 2. Tipos de prenda por cliente

**Objetivo:** cada tipo de prenda pertenece a un cliente, para poder calcular
después **costos vs ventas → utilidad por cliente**.

### Modelo (migración 063)
- `garment_types.client_id` (nullable, FK `clients` ON DELETE CASCADE).
- **`client_id` = un cliente** → prenda de ese cliente.
- **`client_id` = NULL** → tipo global/legado (compartido, usado por pedidos y
  productos viejos). No aparece en los flujos nuevos.

### Filtrado por cliente
- `GET /master/garment-types?client_id=X` devuelve **solo** las prendas del
  cliente (los globales quedan fuera).
- Frontend: `masterApi.garmentTypes.list(clientId?)` +
  `useGarmentTypes(clientId?, { strict })` (con `strict` no consulta hasta que
  haya cliente).
- Filtran por cliente:
  - **Tipos de prenda** (`ProductsPage`): ahora con **ClientSearch**; el alta
    manda `client_id`. Crear/editar prenda → **solo admin**; asignar categoría de
    costo → admin + facturación.
  - **Catálogo** (`CatalogPage`): dropdown "Tipo de prenda" del modal de producto
    + chips de filtro.
  - **Costos** (`CostsPage`): al elegir un cliente salen solo sus prendas.
  - **Pedidos de producción** (`OrderItemForm`): el selector de prenda muestra las
    del **cliente del pedido** (con aviso si falta elegir cliente o si el cliente
    no tiene prendas).

### Archivos
- Backend: migración `063`, `GarmentType` (+`client_id`), `models/index.ts`
  (asociación `GarmentType ↔ Client`), `master.service/controller/routes`.
- Frontend: `types`, `api/master.ts`, `useMasterData.ts`, `ProductsPage.tsx`,
  `CatalogPage.tsx`, `CostsPage.tsx`, `OrderItemForm.tsx`, `NewOrderPage.tsx`.

---

## 3. Costos de prendas (por cliente) con historial y detalle congelado

**Objetivo:** cargar el costo de los materiales/ítems de cada prenda de cada
cliente, calcular el **costo final**, versionar los cambios y **congelar** el
detalle de costos en cada pedido.

### Modelo (migraciones 059–062)
- **`garment_types.cost_category`** ENUM(`jersey`,`shorts`) — define qué lista de
  ítems de costo aplica. Se asigna en **Tipos de prenda**.
  - `jersey` → Camisetas / Remeras / Rompevientos / Camperas.
  - `shorts` → Shorts / Bermudas / Pantalones.
- **`garment_cost_items`** — maestro **configurable** de ítems por categoría
  (sembrado con las dos listas). `group_key` agrupa ítems excluyentes/condicionales
  (tipos de cuello, telas de "doble tela") **solo como ayuda de UI**: ningún ítem
  es obligatorio y los no cargados suman 0.
- **`garment_costs`** — hoja de costos por **(cliente + tipo de prenda)** (única).
  Cachea `total_cost` + `current_version_id` + `updated_by`.
- **`garment_cost_versions`** + **`garment_cost_version_items`** — **historial
  inmutable**. El **costo actual = la última versión**: cada guardado/edición crea
  una versión nueva (nunca pisa), con los ítems denormalizados
  (`item_key`/`item_label`/`amount`) para que el historial se lea igual aunque el
  maestro cambie.
- **`order_cost_details`** — detalle **congelado** del pedido: una fila por ítem
  con el `unit_cost` (costo final vigente) + la `garment_cost_version_id` usada. Se
  genera dentro de la transacción de `createOrder` (y se regenera en `updateOrder`
  al reemplazar ítems). Como las versiones son inmutables, **un cambio de costos
  futuro no altera pedidos ya cargados**.

**Dinero:** `DECIMAL(12,2)` en toda la cadena (nunca float), con getters
`parseFloat`, `round2` en las sumas del service y `formatCurrency` en la UI.

### Lógica (backend `cost.service.ts`)
- `getCostSheet(client, garment)` — hoja actual (ítems del maestro + montos
  vigentes + total). Si la prenda no tiene `cost_category`, devuelve `category:null`
  para que la UI pida asignarla.
- `saveCostSheet(...)` — normaliza contra el maestro, calcula el total, crea una
  **versión nueva** y actualiza la hoja.
- `getCostHistory(...)` — versiones (fecha, usuario, total, ítems).
- `listClientCostSheets(client)` — prendas del cliente con costo cargado.
- `previewOrderCosts(client, líneas)` — preview en vivo del costo de un pedido.
- `buildOrderCostSnapshot(...)` — congela el detalle del pedido (hook en
  `order.service`).
- `getOrderCostDetails(order)` — detalle congelado del pedido.

### UI (frontend)
- Página **`/costs`** (`CostsPage`): ClientSearch → lista de prendas del cliente →
  editor + historial.
- `GarmentCostEditor` — carga ítem por ítem con secciones (grupos excluyentes como
  ayuda), **total recalculándose en vivo**; **confirmación** al guardar y al editar
  (recién ahí se versiona).
- `CostHistoryModal` — versiones con variación (▲/▼) y detalle expandible.
- **Detalle de costos en el pedido:** `NewOrderPage` muestra el preview en vivo por
  prenda + total (solo admin/facturación); `OrderDetailPage` muestra el detalle
  **congelado**.

### Endpoints (`/costs`, todos `authorize('admin','billing')`)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/costs/items?category=jersey\|shorts` | Maestro de ítems |
| GET | `/costs/clients/:clientId` | Prendas con costo del cliente |
| GET | `/costs/clients/:clientId/garments/:garmentTypeId` | Hoja de costos vigente |
| PUT | `/costs/clients/:clientId/garments/:garmentTypeId` | Guardar (crea versión) |
| GET | `/costs/clients/:clientId/garments/:garmentTypeId/history` | Historial |
| POST | `/costs/preview` | Preview de costos de un pedido |
| GET | `/costs/orders/:orderId` | Detalle congelado del pedido |

Asignación de categoría de costo (admin + facturación):
`PUT /master/garment-types/:id/cost-category`.

### Archivos
- Backend: migraciones `059`–`062`, modelos `GarmentCostItem`, `GarmentCost`,
  `GarmentCostVersion`, `GarmentCostVersionItem`, `OrderCostDetail`,
  `cost.service.ts`, `cost.controller.ts`, `cost.routes.ts`, `order.service.ts`,
  `master.*`.
- Frontend: `api/costs.ts`, `hooks/useCosts.ts`, `pages/costs/CostsPage.tsx`,
  `components/costs/{GarmentCostEditor,CostHistoryModal,OrderCostCard,OrderCostPreview}.tsx`.

---

## 4. Precios por % de ganancia en el alta de producto

**Objetivo:** al dar de alta un producto en el catálogo, mostrar el **costo** de la
prenda y calcular **precio mayorista** y **precio de tienda** con un **% de
ganancia**.

- El modal reordenado: Título → Descripción → **Tipo de prenda** → **Precio
  mayorista** (+ % ganancia) → bloque Tienda pública con **Precio público** (+ %
  ganancia).
- Al elegir el tipo de prenda se trae el **costo final** cargado en Costos para
  ese *(cliente + prenda)* y se muestra bajo cada precio.
- Cada input de `% ganancia` calcula `precio = costo × (1 + %/100)` y setea el
  campo (editable a mano igualmente). Uno para mayorista, otro para tienda.
- Si la prenda no tiene costos → input deshabilitado con aviso. Si no se eligió
  prenda → aviso para elegirla. Solo admin/facturación (el modal ya es admin-only).

### Archivos
- Frontend: `CatalogPage.tsx` (componente `CostMargin`, fetch con `useCostSheet`).

---

## 5. Permisos

- **Costos** (ver y cargar): **solo admin y facturación** — autorización real en
  backend (`authorize('admin','billing')` en `/costs`) y en la UI (menú + acciones).
  Vendedor y taller **no** ven costos.
- **Tipos de prenda:** ver y asignar categoría de costo → admin + facturación;
  crear/editar la prenda → **solo admin**.
- **Pedidos del vendedor:** puede crear desde catálogo y ver/editar solo los suyos
  (en `pending`/`observed`), como ya estaba.

---

## 6. Puesta en marcha

### Producción
Correr migraciones (crean columnas/tablas y siembran el maestro de ítems):
```
npm run migrate
```

### Desarrollo
La DB de desarrollo se crea con `sequelize.sync()` (sin `alter`): crea tablas
nuevas pero **no** agrega columnas a tablas existentes. Por eso, al arrancar el
backend corren dos rutinas **idempotentes** (no-op en prod ya migrada):
- `ensureSchema()` (`config/ensureSchema.ts`) — agrega `garment_types.cost_category`
  y `garment_types.client_id` si faltan.
- `ensureGarmentCostItems()` (`cost.service.ts`) — siembra el maestro de ítems.

Es decir: **reiniciar el backend** deja el esquema y los datos base listos en dev.

### Migrar los tipos de prenda globales a por-cliente (opcional, one-off)
Los tipos globales previos (`client_id NULL`) siguen sirviendo a lo viejo pero no
aparecen en los flujos nuevos. Para asignarlos a los clientes que los usan:
```
# Simulación (no toca nada, reporta qué haría):
npm run seed:garment-clients
# Aplicar (en transacción):
npm run seed:garment-clients -- --apply
```
Por cada tipo global detecta los clientes que lo usan (productos de catálogo +
ítems de pedidos + hojas de costo) y: 1 cliente → le asigna el `client_id`;
N clientes → conserva la fila para el 1º y crea una copia por cliente repuntando
sus referencias; si un cliente ya tiene un tipo con el mismo nombre, repunta a ese.
El detalle de costos congelado de pedidos (`order_cost_details`) no se toca.

---

## 7. Migraciones agregadas

| # | Archivo | Qué hace |
|---|---|---|
| 059 | `alter-garment-types-cost-category` | `garment_types.cost_category` |
| 060 | `create-garment-cost-items` | Maestro de ítems + seed |
| 061 | `create-garment-costs` | `garment_costs` + versiones + ítems de versión |
| 062 | `create-order-cost-details` | Detalle congelado del pedido |
| 063 | `alter-garment-types-client` | `garment_types.client_id` |

---

## 8. Pruebas

### Cómo correr
```
# Backend (necesita MySQL migrado + seeders):
cd backIndians
npm run seed          # crea usuarios de los 4 roles, clientes y datos maestros
npm test              # Jest (supertest contra la app)

# Frontend:
cd frontIndians
npm test              # Vitest
```

### Cobertura agregada
- `src/__tests__/api/factory-costs.test.ts`: asignación de categoría, carga y
  edición con versionado, historial, **congelado del pedido** (un cambio de costos
  posterior no altera el pedido) y **autorización por rol** (vendedor → 403). El
  `beforeAll` crea un tipo de prenda **fresco** para que el versionado sea
  idempotente.
- `factory-orders.test.ts`: el vendedor crea un pedido desde el catálogo **sin
  tela ni color** (201, `pending`, `seller_id` seteado).

### Resultado de la última corrida
- Backend: **116/116** tests OK (19 suites).
- Frontend: **44/44** tests OK.

> Nota: si el usuario de test `vendedor@textil.com` no puede loguear
> (`npm run seed` usa `findOrCreate` y no actualiza contraseñas existentes),
> resetearlo con:
> `npm run reset-password -- --email vendedor@textil.com --password "Vendedor123!" --force`

---

## 9. Notas y limitaciones

- Los **productos de catálogo existentes** que apuntan a un tipo de prenda
  global/legado no matchean con la lista nueva del cliente hasta correr el seeder
  de migración (sección 6). Los que se creen de ahora en más quedan consistentes.
- El detalle de costos congelado guarda el **nombre de la prenda denormalizado**,
  así los pedidos históricos se leen bien aunque el tipo se renombre o reasigne.
- Los grupos excluyentes de ítems (cuellos, doble tela) son **ayuda visual**: no se
  fuerza la exclusividad; el costo simplemente suma lo cargado.
