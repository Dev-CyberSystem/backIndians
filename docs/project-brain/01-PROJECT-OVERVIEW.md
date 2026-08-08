# 01 — Visión general del proyecto

## Nombre

**Indians** — sistema de gestión textil ("Indians Textil — Sistema de Gestión Integral", según material comercial en `backIndians/documentos/SALES_DOC.md`).

## Objetivo

Digitalizar el ciclo completo de una fábrica de indumentaria deportiva a pedido (clubes, colegios, municipalidades) — desde que se toma un pedido con ficha técnica hasta que se factura y cobra — y, además, operar una tienda online B2C para venta directa de productos de catálogo.

## Problema de negocio que resuelve

Una fábrica textil que produce indumentaria deportiva **a pedido** (no en serie continua) necesita:
- Registrar fichas técnicas muy detalladas por pedido (tela, colores, cuello/manga, sponsors, personalización por jugador, bordado, tabla de talles).
- Controlar el avance de producción por etapas de calidad (materia prima → corte → estampado → costura → calidad → empaque), con checklist obligatorio en cada control.
- Llevar stock de insumos (telas) y de productos de catálogo por separado.
- Facturar internamente y, opcionalmente, ante AFIP/ARCA.
- Llevar caja (ingresos/egresos/transferencias) conectada a facturación y a la tienda.
- Vender productos de catálogo tanto a través de vendedores (mayorista, `catalog`) como directamente a consumidores finales por una tienda online (`store`).

## Tipos de usuario / actores

### Usuarios internos (sistema de gestión, un solo JWT/rol por usuario)
| Rol | Qué hace | Evidencia |
|---|---|---|
| `admin` | Acceso total: usuarios, dashboard, configuración, todo lo demás | `User.role` ENUM, `backIndians/src/types/index.ts` |
| `billing` (facturación/administración) | Pedidos, clientes, facturas, caja, catálogo, costos, tienda (admin), settings | mismas fuentes; visible en `authorize('admin','billing')` repetido en casi todos los routers |
| `workshop` (taller) | Ve y actualiza únicamente el flujo de controles de producción de los pedidos, tilda checklist | `order.routes.ts` (`authorize('workshop','admin')` en checklist), `frontIndians/src/pages/workshop/` |
| `seller` (vendedor) | Carga pedidos con ficha reducida, ve catálogo del cliente asignado, gestiona sus propios pedidos/pedidos de catálogo | `project-seller-order-flow` (memoria previa), rutas con `authorize(...,'seller')` |

### Usuarios externos
| Actor | Qué hace | Evidencia |
|---|---|---|
| **Cliente B2B** (`Client`) | Entidad para la que se fabrican pedidos (club, colegio, municipalidad); no tiene login propio, es gestionado por usuarios internos | modelo `Client` |
| **Comprador de tienda** (`StoreCustomer`) | Se registra (email/password o Google), compra en la tienda online, hace seguimiento de sus pedidos, gestiona direcciones y favoritos | modelo `StoreCustomer`, rutas `/store/me/*` |

## Alcance actual (verificado en código)

- **Gestión de pedidos de fábrica** con ficha técnica extensa y flujo de 6 controles de calidad — implementado y verificado.
- **Stock de insumos (telas/materiales)** con movimientos in/out/ajuste — implementado y verificado.
- **Facturación interna** (borrador/emitida/pagada/cancelada) con pagos parciales — implementado y verificado.
- **Caja** (cuentas, categorías, transacciones, transferencias entre cuentas) — implementado y verificado.
- **Catálogo mayorista** (`catalog`) con pedidos por vendedor, pago con MercadoPago (Checkout Pro) — implementado y verificado.
- **Costos de prendas** por cliente, versionados, con snapshot congelado por pedido — implementado y verificado.
- **Tienda online B2C** (`store`): catálogo público, carrito, checkout (MercadoPago/efectivo/transferencia), cupones, seguimiento de pedidos con mail por estado, devoluciones con revisión, reserva de stock con vencimiento, analítica de audiencia/carritos abandonados — implementado y verificado (auditoría de 2 fases cerrada, ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md)).
- **Facturación electrónica AFIP/ARCA** — implementada en código (WSAA+WSFEv1) y commiteada, pero **deshabilitada en producción** (falta certificado real, toggle `afip_enabled=false` por defecto).
- **SEO técnico de la tienda** — implementado (metadata nativa React 19, JSON-LD, sitemap, prerender SSG puntual).

## Fuera de alcance (explícitamente, con evidencia)

- **Integración con courier Andreani** (cotización, etiqueta, tracking automático) — decisión de negocio registrada como pendiente, requiere research spike. El seguimiento de envío actual es 100% manual (el admin carga transportista + número de guía como texto libre). Fuente: `backIndians/documentos/AUDITORIA_TIENDA_ONLINE_AVANCE.md` (tarea "2.6").
- **QR de pago dinámico de MercadoPago para cobro presencial** — no implementado; el catálogo mayorista muestra un QR pero es simplemente el link de `init_point` de una preferencia Checkout Pro renderizado como imagen QR (`qrcode.react`), no la API de Point/QR de MP.
- **Cola de emails persistente (Redis/Bull)** — los emails se encolan en memoria de proceso (`setImmediate` + reintentos), no sobreviven un reinicio del servidor. Documentado así explícitamente en el propio código (`backIndians/src/utils/emailQueue.ts`).
- **Blacklist de tokens JWT / revocación real de logout del lado servidor** — el logout es un no-op declarado explícitamente en el código; la única revocación real es incrementar `session_version` (login nuevo, reset de password).
- **CI/CD** — no existe ningún pipeline (`.github/workflows` o equivalente); las validaciones se corren a mano.
- **Catálogo genérico legado** (`Product`/`ProductCategory`) — tablas y modelos existen pero no se usan desde ningún service/route de la aplicación; ver hallazgo de inconsistencia en [05-DATABASE.md](05-DATABASE.md).

## Glosario de negocio

| Término | Significado |
|---|---|
| **Pedido (Order)** | Pedido de producción a fábrica para un `Client`, con uno o más `OrderItem` (ficha técnica). |
| **Ficha técnica** | Conjunto de datos de un `OrderItem`: tela, colores, cuello/manga, marca/escudo, sponsors, personalización por jugador, bordado, puño, tabla de talles. |
| **Controles de producción** | Las 6 etapas de calidad por las que pasa un pedido: materia prima, corte, estampado, costura, calidad, empaque — cada una con checklist obligatorio. |
| **Catálogo (catalog)** | Módulo de venta **mayorista**: productos con stock propio, vendidos por un `seller` a un `Client`, con pago MercadoPago o factura. Distinto de la tienda online. |
| **Tienda / Tienda online (store)** | Módulo de venta **B2C**: `StoreCustomer` compra `CatalogProduct` marcados `show_in_store=true`, con carrito, checkout, cupones, seguimiento. Comparte el stock de `CatalogProduct` con el catálogo mayorista pero con su propio ledger de movimientos. |
| **Comprobante de compra (tienda)** | PDF generado para pedidos de tienda; se le cambió el nombre desde "factura" porque **no es un comprobante fiscal válido** (sin CAE) salvo que se envíe a AFIP manualmente. |
| **Factura (invoice / catalog invoice)** | Documento de facturación interna de fábrica o de catálogo mayorista; puede además enviarse a AFIP para obtener CAE real. |
| **CAE** | Código de Autorización Electrónico que emite AFIP al aceptar un comprobante fiscal — solo existe si `afip_enabled=true` y el envío fue exitoso. |
| **Costo de prenda (garment cost)** | Hoja de costos versionada por cliente + tipo de prenda (categoría `jersey` o `shorts`), usada para calcular precio de venta por % de ganancia. |
| **Stock reservado** | Cantidad de `CatalogProduct`/`CatalogProductSize` apartada por un pedido de tienda en curso (no confirmado aún); se libera si el pedido expira o se cancela, se confirma (resta del stock real) al acreditarse el pago. |
| **Ledger de stock de catálogo** | Registro auditable (`CatalogStockMovement`) de cada movimiento de stock de catálogo: venta, devolución, cancelación, ajuste, entrada/salida, transferencia, reserva, liberación. |
| **Tracking token** | Token opaco con vencimiento que permite a un comprador seguir su pedido de tienda sin necesidad de login. |
| **Session version** | Contador en `User`/`StoreCustomer` que, al incrementarse (login nuevo, reset de password), invalida todos los refresh tokens emitidos antes — mecanismo real de revocación de sesión. |
| **Sistema vs. Tienda (hosts)** | El frontend separa por dominio: `sistema.indians.com.ar` sirve el panel de gestión, `indians.com.ar` sirve la tienda; en `localhost` conviven ambos. |

## Actualizar este documento cuando…

Cambie el alcance del negocio, se agregue/quite un rol de usuario, o se confirme/implemente algo listado hoy como "fuera de alcance".
