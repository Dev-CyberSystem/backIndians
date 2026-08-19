# 09 — Estado actual del proyecto

> Fotografía al **2026-08-05**. Basado en `git log`/`git status` reales de ambos repos y en `backIndians/documentos/AUDITORIA_TIENDA_ONLINE_AVANCE.md`.

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

- **Integración con Andreani** (courier): sin empezar, requiere research spike de su API antes de poder desglosarse en tareas. Es el único ítem grande pendiente de la auditoría de tienda.
- **Habilitar AFIP en producción**: requiere acción externa al código (tramitar/cargar certificado real ante ARCA, configurar `afip_enabled=true` y datos fiscales de la empresa).
- **Configurar `store_cash_account_id`**: acción de configuración de negocio, no de código.
- **Rotar credenciales** mencionadas en `documentos/Users.txt` y en el comentario de `seeders/reset-admin-prod.ts` — señalado como riesgo en la auditoría de base de datos de esta sesión, pendiente de confirmación del usuario.
- **CI/CD**: no existe ningún pipeline en servidor. Desde el 2026-08-19 sí hay un **sistema de releases versionados**
  (`npm run release` en backIndians) que corre las validaciones, saca backup de producción y tagea ambos repos;
  las validaciones siguen ejecutándose en la máquina de quien releasea. Ver [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md).

## Deuda técnica anotada explícitamente (por el propio equipo, en `AUDITORIA_TIENDA_ONLINE_AVANCE.md`)

1. **`STORE_ORDER_TRANSITIONS` duplicado** entre `backIndians/src/config/storeOrderFlow.ts` y `frontIndians/src/api/store.ts` — fuente de desincronización futura si se edita solo un lado.
2. **162 errores / 11 warnings de ESLint preexistentes** en `frontIndians`, no corregidos, quedaron para una "Fase 4" no confirmada como iniciada.
3. UI de stock disponible (ver tabla de arriba).

## Deuda técnica detectada en esta auditoría (no necesariamente conocida por el equipo)

- `products`/`product_categories`: modelo y (parcialmente) migración sin uso funcional en el código actual — candidatos a limpieza o a confirmar si hay planes de reactivarlos.
- Numeración de migración duplicada (dos migraciones con el número `018`) — no rompe nada, pero indica falta de coordinación de numeración entre branches en algún momento.
- Posibles índices redundantes en `orders`/`invoices` (índice simple + índice compuesto con la misma columna líder).
- Lógica de esquema duplicada entre 5 migraciones puntuales y `ensureSchema.ts` — mantenimiento doble si se edita solo un lado.
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

- **Backend**: 37 archivos de test (Jest+Supertest), suites de integración contra MySQL real. Según el cierre de la auditoría de avance: **199/199 tests en verde** al cerrar Fase 2 (cifra reportada por el propio equipo, no re-ejecutada en esta auditoría documental).
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
