# 07 — Guía de desarrollo

## Requisitos previos

- Node.js **20** (`backIndians/.nvmrc`); frontend no fija versión de Node explícita pero se recomienda la misma.
- MySQL corriendo localmente (o accesible), con una base descartable para desarrollo/tests — **las suites de test corren contra una base real, no in-memory, y no son seguras de correr contra producción**.
- Cuentas/credenciales de servicios externos son **opcionales** para levantar el sistema básico: sin `RESEND_API_KEY` los emails de tienda simplemente no se envían; sin `MP_ACCESS_TOKEN` el checkout con MercadoPago falla pero el resto funciona; sin `AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` el envío a AFIP falla explícitamente (no hay modo degradado).

## Instalación

```bash
cd backIndians && npm install
cd ../frontIndians && npm install
cd ../e2e && npm install   # solo si vas a correr tests E2E con Playwright
```

## Variables de entorno

Copiar `.env.example` → `.env` en `backIndians/` y en `frontIndians/`, completar según [06-API-AND-INTEGRATIONS.md](06-API-AND-INTEGRATIONS.md) (nombres de variables, sin valores). Como mínimo para desarrollo local: `DB_HOST/PORT/NAME/USER/PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `VITE_API_URL=http://localhost:3000/api/v1`.

## Cómo ejecutar el proyecto

```bash
# Backend (puerto por defecto según PORT, típicamente 3000)
cd backIndians && npm run dev      # ts-node-dev con hot reload

# Frontend (Vite, típicamente 5173)
cd frontIndians && npm run dev
```

En `localhost`, el frontend sirve tanto el sistema de gestión como la tienda (`/tienda/*`) desde el mismo build — no hace falta simular subdominios en desarrollo (ver `frontIndians/src/utils/host.ts`).

## Cómo crear o actualizar la base de datos

- **Desarrollo**: al arrancar el backend, `connectDB()` corre `dedupeIndexes()` + `sequelize.sync()` (crea tablas faltantes) y `ensureSchema()` aplica parches de columnas/ENUMs que `sync()` no cubre. En la práctica, para desarrollo alcanza con tener el backend corriendo una vez contra una base vacía.
- **Producción / esquema explícito**: `npm run migrate` (`sequelize-cli db:migrate`) dentro de `backIndians/`. `npm run migrate:undo` revierte todas.
- **Importante**: si tu cambio de esquema es de los que `ensureSchema.ts` replica (ver [05-DATABASE.md](05-DATABASE.md)), hay que actualizar **ambos** lugares (migración + `ensureSchema.ts`) para que desarrollo sin migrar y producción migrada no diverjan.
- **Seeds** (`backIndians/`):
  ```bash
  npm run seed                  # usuarios base + clientes + maestros de ejemplo
  npm run seed:admin            # admin único vía ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME
  npm run seed:test             # seed + seed:admin (lo que piden los tests)
  npm run seed:sellers          # 5 vendedores de prueba con pedidos de ejemplo
  npm run seed:store-customers  # 5 compradores de tienda de ejemplo
  npm run seed:garment-clients  # migración de datos de garment_types (usar --apply para ejecutar de verdad)
  npm run reset-password        # utilidad CLI para resetear password de un usuario por email
  ```

## Cómo ejecutar pruebas

```bash
# Backend — Jest + Supertest contra MySQL real, requiere DB migrada/sembrada
cd backIndians
npm run test:full     # seed:test + test, todo en un paso
npm test              # solo corre jest --forceExit (falla si falta seed)

# Frontend — Vitest, solo utils puros (formatters, host, validations)
cd frontIndians
npm test               # vitest run

# E2E — Playwright, levanta backend+frontend automáticamente si no están corriendo
cd frontIndians/e2e     # (vivía en la raíz hasta el 2026-08-08; se movió para versionarla)
npm test                # headless
npm run test:headed     # con navegador visible
npm run test:ui         # modo interactivo
npm run report          # ver el último reporte HTML
```

> Los E2E de la tienda necesitan además `cd backIndians && npm run seed:store-customers`, que **no** corre con `npm run seed` ni con `test:full`. Sin él, el login de comprador falla por falta de datos, no por una regresión.

**Nota de arquitectura de tests**: `jest.config.js` fuerza `maxWorkers: 1` porque las suites comparten una única base de datos real — correrlas en paralelo pisaría datos entre sí. No uses una base con datos que te importen para correr tests.

## Cómo ejecutar lint

```bash
cd frontIndians && npm run lint     # eslint .
```

El backend no tiene script `lint` propio en `package.json` — usa `npm run typecheck` (`tsc --noEmit`) como verificación estática equivalente.

## Cómo generar una build

```bash
# Backend
cd backIndians && npm run build          # tsc → dist/
npm run build:start                       # build + start, para probar el build localmente

# Frontend
cd frontIndians && npm run build         # tsc -b && vite build + copia .htaccess + genera sitemap
npm run prerender                         # SSG puntual con Playwright (SEO)
npm run deploy                            # build + prerender + sube por FTP (Ferozo, ver 09-CURRENT-STATUS.md)
```

## Depurar problemas frecuentes

| Síntoma | Causa probable | Dónde mirar |
|---|---|---|
| Tests de backend fallan con `401 Credenciales inválidas` | falta correr los seeders antes de testear | `npm run seed:test` o `npm run test:full` |
| `Too many keys` / error de índices al arrancar en dev | `sync()` acumuló índices duplicados | revisar que `dedupeIndexes()` corrió (log de arranque); confirmar que no se está definiendo el mismo índice único en modelo Y migración a la vez |
| Una columna nueva no aparece en desarrollo tras `git pull` | `sync()` no altera columnas de tablas existentes | correr la migración a mano (`npm run migrate`) o replicar el cambio en `ensureSchema.ts` si es de los que se auto-parchean |
| Emails no se envían en desarrollo | falta `RESEND_API_KEY`/`SMTP_*` | es esperable sin esas env vars; revisar log, no es un bug |
| Checkout con MercadoPago falla en desarrollo | falta `MP_ACCESS_TOKEN`/`MP_PUBLIC_KEY` | configurar credenciales de sandbox de MP |
| Envío a AFIP falla siempre | `afip_enabled` no está en `'true'` en `settings`, o faltan `AFIP_CERT_BASE64`/`AFIP_KEY_BASE64` | esperado sin certificado real cargado — ver [BR-AFIP-001](03-BUSINESS-RULES.md) |
| Refresh de sesión falla tras editar el usuario en DB directamente | `session_version` desincronizado | volver a loguear |

## Convenciones de nombres y estructura

- **Idioma**: comentarios y documentación en español; identificadores de código (variables, funciones, tablas, columnas) en inglés.
- **Backend**: un archivo por modelo en `models/`, un router por dominio en `routes/`, lógica de negocio en `services/` (no en `controllers/`). Migraciones nombradas `YYYYMMDD-NNN-descripcion-en-kebab-case.js`, numeración secuencial de 3 dígitos (ver nota de colisiones en [05-DATABASE.md](05-DATABASE.md) antes de reusar un número).
- **Frontend**: páginas agrupadas por rol/dominio bajo `src/pages/<dominio>/`; componentes reutilizables genéricos en `src/components/ui/`; un módulo de API por dominio de backend en `src/api/`.
- **camelCase** en columnas `createdAt`/`updatedAt` (excepción documentada: `store_wishlist` usa `created_at` snake_case, ver inconsistencia en [05-DATABASE.md](05-DATABASE.md) — no repetir ese patrón en tablas nuevas).
- **DECIMAL → number**: cualquier modelo nuevo con campos monetarios/cantidades debe definir el getter que castea de string a number, siguiendo el patrón existente en el resto de los modelos.

## Criterios mínimos antes de considerar terminada una tarea

1. `npm run typecheck` (backend) y build de TypeScript sin errores.
2. Si se tocó lógica de negocio con test existente, correrlo (`npm run test:full` en backend). Si se agregó lógica de negocio nueva sin cobertura, considerar agregar un test (patrón: `backIndians/src/__tests__/api/*.test.ts`, con `helpers.ts` para login).
3. Si se tocó una página/flujo de UI, probarlo manualmente en el navegador (dev server), no solo confiar en tipos/lint — el frontend casi no tiene tests de componentes.
4. Si el cambio afecta esquema de DB: migración + (si corresponde) `ensureSchema.ts` actualizados en conjunto.
5. Si el cambio afecta una regla de negocio, un endpoint, la arquitectura o el estado de un módulo documentado en `backIndians/docs/project-brain/`: actualizar el documento correspondiente (ver `CLAUDE.md`).

## Actualizar este documento cuando…

Cambien los scripts de `package.json`, el flujo de setup, o se descubra una causa nueva y recurrente de un problema de entorno.
