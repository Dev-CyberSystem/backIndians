# Revisión de feature/perfil-disenador — 2026-09-10

## Seguimiento — correcciones implementadas el 2026-09-10

Los cuatro hallazgos de la revisión inicial están corregidos. Se cerraron las rutas financieras y precios alternativos (R1), se preservan cotizaciones por ID y se sincronizan facturas borrador sin cobros ante cambios de total (R2), los adjuntos aplican el bloqueo previo al taller (R3), y existe editor de ficha con ítems y notas (R4). Ambos repos integran el master local v1.11.0. La reproducción `.cjs` ahora comprueba las correcciones.

**GO técnico para preparar release.** Backend: typecheck limpio y `npm run test:full` con 64 suites / 478 tests aprobados. Frontend: 52 tests aprobados y build de producción limpio. E2E final: 2/2 (Chromium escritorio y móvil). Reproducción aislada de los fallos originales: pasa con las correcciones. `git diff --check` limpio en ambos repos.

La prueba UI usa Playwright con API y base locales, en escritorio y móvil; se revisaron sus capturas. No hubo prueba de Cloudinary real ni despliegue productivo. Para producción siguen los pasos de release, backup, migración 107 y smoke por roles. El informe siguiente conserva el diagnóstico inicial y sus evidencias; sus HEAD y NO GO corresponden a la revisión previa a las correcciones.

## Informe inicial (histórico)

**Dictamen: NO GO para producción.** Hay permisos incompletos, pérdida de precios al editar y un flujo de corrección de ficha que no está implementado en la interfaz.

## Alcance y estado real

- Revisión de los cambios locales de ambos repos, incluyendo archivos nuevos no seguidos por git.
- Backend HEAD `f0e8082`; frontend HEAD `a4e8334`. La funcionalidad del diseñador está **sin commitear**. Pushear solamente estos HEAD no publica la feature.
- `master` y las referencias locales de `origin/master` están en v1.11.0 (`6740474` / `4e8afd3`); la rama mantiene package.json v1.10.0. No se consultó el remoto ni la versión realmente desplegada.
- Backend está dos commits detrás de master (fix del test de proveedores y release); frontend, uno (release). Integrar con master conservando su versión/historia antes de preparar el próximo release.
- No se modificó código funcional ni se desplegó. Se agregaron este informe y su reproducción aislada; se ejecutaron verificaciones locales.
- El import de instrucciones `backIndians/AGENTS.md` apunta a un archivo inexistente en este checkout. Se consultaron las reglas equivalentes de `backIndians/CLAUDE.md` y el cerebro documental.

## Hallazgos que impiden el Go

### R1 — P1: el diseñador accede a facturación y operaciones de cobro del catálogo

Fuentes: `src/routes/catalog.routes.ts:125-159,185-203,208-213,239-253`; `src/controllers/catalog.controller.ts:117-149,173-209,257-260`; `src/services/catalog.service.ts:689-765,831-837`.

El nuevo rol bloquea `/invoices`, pero las rutas paralelas `/catalog/invoices`, `/catalog/orders` y `/catalog/orders/:id/invoice` solo exigen autenticación. Sus controladores no verifican el rol y sus servicios devuelven facturas, importes y pagos sin sanitizar. También quedan accesibles generar/refrescar preferencias de pago y subir/borrar comprobantes. Ocultar `/catalog/orders` en React no protege la API.

**Reproducción aislada:** con autenticación simulada como diseñador, el router real deja llegar al controlador (200) en GET `/invoices`, GET `/orders`, GET `/orders/1/invoice`, POST `/orders/1/payment` y DELETE `/orders/1/invoice/images/1`, relativos a `/catalog`. Los controladores de esta prueba son simulados: no se generaron pagos ni se borraron archivos reales.

Además, `hidePriceForRole` (`catalog.controller.ts:11-17`) solo anula `price`: un producto `{price:5000,public_price:9000}` devuelve `{price:null,public_price:9000}`. `/products` también devuelve `base_price` a cualquier autenticado (`product.routes.ts:12`, `product.service.ts:13-24`). No se cumple «no ve precios en ningún lado» de DEC-025.

**Corrección:** permisos explícitos por endpoint de ventas/facturación/cobros/comprobantes; respuesta técnica del catálogo sin campos monetarios; revisar lecturas alternativas y respuestas de mutaciones. Añadir pruebas negativas con datos existentes de precio distinto de cero.

### R2 — P1: editar la ficha destruye precios ya cargados

Fuente: `src/services/order.service.ts:640-655`, especialmente `stripItemPricing` seguido de destroy/bulkCreate y recálculo.

El diseñador puede editar cualquier pedido pendiente/en revisión/observado. Si facturación ya cargó precios, al enviar `items` el servicio descarta el precio, destruye los ítems anteriores, los recrea con `unit_price:null` y persiste `total_amount:0`. Esto altera importes aunque la intención sea cambiar únicamente un color o un dato técnico. La factura no se sincroniza en esta operación, de modo que también puede quedar inconsistente con el pedido.

**Reproducción aislada del servicio real:** pedido de $25.000, 5 unidades; edición técnica sin precio → total persistido $0 e ítems con precio null. ORM y snapshot de costos simulados, sin modificar pedidos reales.

**Corrección:** separar actualización técnica de actualización monetaria y preservar precios por identidad estable del ítem. No intentar recuperar importes del payload del diseñador, porque su lectura está sanitizada. Definir el tratamiento de ítems nuevos y eliminados y cubrir el caso «billing cotiza → diseñador corrige → billing conserva precios y total coherente».

### R3 — P1: se pueden cambiar imágenes/tablas de talles después de mandar al taller

Fuentes: `src/routes/order.routes.ts:170-204`; `src/services/order.service.ts:681-781`; `frontIndians/src/pages/billing/OrderDetailPage.tsx:482-490`.

La guarda de estado solo está en `updateOrder`. Las cuatro rutas de imágenes/tablas de talles ahora autorizan al diseñador, pero sus servicios no aplican esa guarda; varios ni siquiera reciben al usuario. En el detalle, ImageDropzone siempre permite subir y borrar imágenes, también en estados de producción.

**Reproducción aislada:** `deleteItemSizeChart` borra la referencia de imagen de un ítem de un pedido en `workshop_review`. No consulta el estado del pedido. La carga de tabla de talles, además, devuelve el OrderItem completo sin sanitizar su `unit_price`.

**Corrección:** una misma autorización de edición para datos, imágenes y tablas; aplicarla antes de cualquier escritura o llamada a Cloudinary, incluyendo borrados. En la interfaz, mostrar los adjuntos de solo lectura fuera de los estados editables. Cubrir los cuatro endpoints y sus respuestas en tests.

### R4 — P2: falta editar una ficha existente desde la interfaz

Fuentes: `frontIndians/src/pages/billing/OrderDetailPage.tsx:75,127-139`; `frontIndians/src/pages/billing/NewOrderPage.tsx:249`; `frontIndians/src/hooks/useOrders.ts:37-40`.

Se agregó permiso de edición al backend, pero OrderDetailPage solo ofrece transiciones, impresión e imágenes. OrderItemForm solo se monta en NewOrderPage y no hay pantalla ni acción que consuma la mutación de actualización para corregir los ítems. Un pedido observado puede volver a revisión sin que el diseñador tenga forma de corregir tela, color, talles o bordados desde la aplicación. Es una funcionalidad comprometida en DEC-025 que queda incompleta.

**Corrección:** acción «Editar ficha» en pending/under_review/observed con los datos actuales, formulario completo sin precios y guardado por API. Verificar manualmente crear → observar → editar → revisar → taller.

## Verificación

- Backend `npm run typecheck`: **OK**.
- Frontend `npm test`: **4 suites / 52 tests OK**.
- Frontend `npm run build`: **OK**, sin deploy. Advertencia no bloqueante de import dinámico/estático de storeAuthStore. Build resultante todavía declara v1.10.0, propio de la rama.
- Reproducción aislada del código real: confirmados R1, R2 y R3. Archivo `2026-09-10-perfil-disenador-repro.cjs`, ejecutar desde backend con `node docs/reviews/2026-09-10-perfil-disenador-repro.cjs`. Simula persistencia, autenticación y servicios externos; no sustituye un E2E ni afirma ejecución en producción.
- Suite backend `npm run test:full`: **64 suites / 471 tests OK** (414,441 segundos de Jest, más seeders). Se verificó previamente que el destino fuera una base local disponible. Incluye los 8 tests del diseñador. El resultado verde no cubre los escenarios adversos de esta revisión.
- Migración 107: `up` y espejo en ensureSchema contienen el mismo ENUM/default; no se aplicó una migración productiva. El `down` convierte diseñadores a taller: no usarlo como rollback automático sin revisar usuarios y permisos.
- No se realizó prueba manual de navegador ni smoke de producción. Los 8 tests nuevos de API no cubren edición de pedidos cotizados, endpoints alternativos de facturación ni adjuntos después del envío al taller; el test de catálogo puede pasar con lista vacía.

## Recomendaciones y salida

1. Corregir R1–R4, añadir regresiones de los casos concretos y correr tests/build más el flujo manual por roles.
2. Tipar `CatalogProduct.price` como `number | null`; el comentario actual reconoce null pero deja un tipo incorrecto. Ocultar el carrito también en CatalogBrowserPage y el precio ficticio $0 del catálogo de Stock.
3. Integrar con master y commitear ambos repos, incluyendo migración 107. El release debe identificar estos cambios, no los HEAD previos.
4. Preparar la nueva versión por `npm run release`, con backup y aplicación de migración según el procedimiento versionado; desplegar ambos componentes y verificar `/health` y `/version.json`.

**Criterio de Go:** sin exposición financiera al diseñador, sin pérdida de importes al editar, ficha/adjuntos bloqueados según estado, corrección de observados utilizable, validaciones completas y artefactos versionados.
