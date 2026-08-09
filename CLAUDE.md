# CLAUDE.md — Indians

## Resumen

Sistema de gestión textil (fábrica de indumentaria deportiva a pedido) + tienda online B2C. Dos repos git independientes: `backIndians/` (API) y `frontIndians/` (SPA), dentro de una carpeta raíz que **no es un repo git** — por eso todo lo que se quiera versionar tiene que vivir dentro de uno de los dos (este archivo y el cerebro documental viven en `backIndians/`; los E2E de Playwright, en `frontIndians/e2e/`). Roles internos: `admin`, `billing`, `workshop`, `seller`. La tienda online tiene sus propios usuarios (`StoreCustomer`), sin roles.

## Stack

Backend: Node 20 + TypeScript + Express + Sequelize + MySQL. Frontend: React 19 + TypeScript + Vite + React Router + React Query + Zustand + Tailwind. Integraciones: MercadoPago (pagos), Resend/SMTP (email), Cloudinary (imágenes), AFIP/ARCA (facturación electrónica, código listo pero deshabilitado en producción), Google OAuth, Cloudflare Turnstile. Sin CI/CD.

## Arquitectura general

REST JSON bajo `/api/v1`. Dos JWT completamente independientes (staff vs. comprador de tienda), no intercambiables. Un solo build de frontend sirve dos experiencias distintas según hostname (`sistema.*` = panel de gestión, dominio raíz = tienda). Desarrollo usa `sequelize.sync()` + parches idempotentes (`ensureSchema.ts`) + deduplicación de índices (`dedupeIndexes.ts`); producción usa migraciones formales (`sequelize-cli`). Detalle completo en `backIndians/docs/project-brain/04-ARCHITECTURE.md` y `05-DATABASE.md`.

## Reglas críticas que nunca deben romperse

- **No mezclar los dos sistemas de auth**: nunca hacer que un JWT de `User` (staff) autentique como `StoreCustomer` o viceversa. El campo `type` en el payload de tienda es la defensa contra esto — no quitarlo.
- **Todo envío a AFIP debe pasar por `assertAfipEnabled()`** — nunca agregar un camino que llame a WSAA/WSFEv1 sin ese gate.
- **Cualquier cambio de esquema que `ensureSchema.ts` replique** (columnas de `garment_types`, ENUM de `store_orders.status`, `tracking_token`) debe actualizarse en **ambos lados** (migración + `ensureSchema.ts`), o desarrollo y producción divergen en silencio.
- **No definir el mismo índice único en un modelo Y en su migración** — genera duplicados bajo `sync()` (ver caso ya existente de `OrderChecklistCheck`, no repetir el patrón).
- **Todo movimiento de stock de catálogo debe pasar por el ledger** (`CatalogStockMovement` / `stockLedger.service.ts`), salvo la excepción ya documentada y consciente de `saveProductSizes`.
- **Nunca leer ni volcar a documentación/commits** el contenido de `.env`, `.env.bak`, `.env.deploy`, `.env.production`, ni `backIndians/documentos/Users.txt` — contienen secretos reales.
- **`STORE_ORDER_TRANSITIONS` está duplicado** entre `backIndians/src/config/storeOrderFlow.ts` y `frontIndians/src/api/store.ts` — si se toca uno, hay que tocar el otro (deuda técnica conocida, no una decisión a repetir en código nuevo).

## Convenciones de desarrollo

Comentarios/documentación en español, identificadores de código en inglés. Lógica de negocio en `services/`, no en `controllers/`. Getters DECIMAL→number en todo modelo con campos monetarios. `createdAt`/`updatedAt` camelCase (no repetir la excepción de `store_wishlist`). Detalle completo en `backIndians/docs/project-brain/07-DEVELOPMENT-GUIDE.md`.

## Comandos principales

```bash
# Backend
cd backIndians && npm run dev              # dev server
npm run test:full                          # seed + tests (Jest, requiere MySQL real)
npm run typecheck                          # tsc --noEmit
npm run migrate                            # aplicar migraciones

# Frontend
cd frontIndians && npm run dev             # dev server
npm test                                   # Vitest
npm run lint                               # eslint
npm run build                              # build de producción
```

Detalle completo (seeds, e2e, deploy) en `backIndians/docs/project-brain/07-DEVELOPMENT-GUIDE.md`.

## Archivos/carpetas que no deben modificarse sin autorización explícita

- `backIndians/migrations/*` ya aplicadas — no editar una migración existente, crear una nueva.
- `backIndians/documentos/Users.txt`, `.env*`, `.env.bak` — nunca tocar ni commitear.
- `backIndians/documentos/AUDITORIA_TIENDA_ONLINE_*.md` — son el registro histórico de una auditoría real, no reescribir su contenido (sí se puede agregar seguimiento nuevo).
- Cualquier campo `afip_*` o lógica de `afip.service.ts` — cambios ahí tienen impacto fiscal real, requieren confirmación explícita del usuario.

## Proceso obligatorio antes de implementar una tarea

1. Leer `backIndians/docs/project-brain/00-INDEX.md` y **solo** los documentos relacionados con la tarea (no todo el cerebro).
2. Verificar el estado real del código relevante (grep/read) antes de asumir que algo descrito en el cerebro sigue vigente — es una fotografía al 2026-08-05.
3. No duplicar servicios, componentes, endpoints o reglas de negocio ya existentes — buscar primero si ya hay algo que resuelva lo mismo.
4. Si la tarea implica cambiar una regla de negocio existente (ver `backIndians/docs/project-brain/03-BUSINESS-RULES.md`), o un contrato de API/esquema de base de datos, **avisar explícitamente y pedir confirmación** antes de hacerlo.
5. No eliminar código o datos existentes sin autorización explícita del usuario.

## Proceso obligatorio de validación

Antes de afirmar que una tarea está terminada: typecheck limpio, tests relevantes corridos (backend: `npm run test:full`; frontend: probar manualmente en navegador si es UI, Vitest no cubre componentes), y — si se tocó esquema de DB — migración y `ensureSchema.ts` coherentes entre sí. Ver checklist completo en `backIndians/docs/project-brain/07-DEVELOPMENT-GUIDE.md`.

## Mantenimiento del cerebro documental

- Si una tarea cambia una funcionalidad, arquitectura, regla de negocio o decisión ya documentada en `backIndians/docs/project-brain/`, actualizar el documento correspondiente como parte de la misma tarea (no dejarlo para después).
- Antes de terminar una sesión de trabajo no trivial, actualizar `backIndians/docs/project-brain/10-SESSION-HANDOFF.md` con qué se hizo, qué falta y cómo retomar.
- El índice completo de qué documento consultar según el tipo de tarea está en `backIndians/docs/project-brain/00-INDEX.md`.
