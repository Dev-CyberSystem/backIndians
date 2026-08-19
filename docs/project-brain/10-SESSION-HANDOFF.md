# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-08-19 — Sistema de releases y rollback

### Objetivo de la sesión

Poder subir a producción de forma controlada y poder volver atrás si algo falla. Hasta ahora el deploy era pushear a `master` (Railway deploya solo) y correr `npm run deploy` en el frontend: sin versiones, sin tags en la historia de ninguno de los dos repos, y sin ninguna red bajo la base de datos.

Rama: se trabajó sobre **`feature/textos-legales`** (la rama activa al empezar). **Nada commiteado todavía.**

### Qué se hizo

**Scripts nuevos (`backIndians/scripts/release/`)**

- `release.mjs` — valida ambos repos (rama, working tree, sincronía con origin), corre typecheck + tests + build, saca backup de producción, sincroniza `package.json`, actualiza `CHANGELOG.md`, tagea `vX.Y.Z` en **los dos repos** y guarda el build del frontend en `frontIndians/.releases/vX.Y.Z/`. **No deploya**: imprime los comandos exactos.
- `db-backup.mjs` / `db-restore.mjs` — dump comprimido de producción vía `mysqldump` y restore con confirmación fuerte (hay que escribir el nombre de la base). El restore a producción saca un backup del estado actual antes de pisarlo. Por defecto `db:restore` apunta a la base **local**, para poder probar un backup sin arriesgar producción.
- `rollback.mjs` — ejecuta el rollback de frontend (resube el snapshot anterior) y guía los de backend y base.
- `status.mjs` — compara el tag local contra el `/health` del backend y el `/version.json` del frontend. Detecta deploys a medias y releases sin deployar.

**Cambios en la aplicación**

- `src/config/version.ts` (nuevo) + `/health` ahora reporta `version` y `commit`, también en la respuesta 503.
- Frontend: `scripts/generate-version.mjs` genera `dist/version.json` en cada build; `deploy-ftp.mjs` acepta `--from=<carpeta>` o una versión suelta para republicar un snapshot sin rebuildear; `.htaccess` marca `version.json` como `no-store`.
- `package.json`: `release`, `release:status`, `rollback`, `db:backup`, `db:restore`, `migrate:status` (backend) y `deploy:release` (frontend).

**Cambio de comportamiento a tener en cuenta**

`npm run migrate:undo` era `db:migrate:undo:all` — revertía **todas** las migraciones, o sea el esquema entero. Ahora revierte sólo la última, que es lo que el nombre sugiere; el comportamiento viejo quedó en `migrate:undo:all`.

### Validación

- Backend: `tsc --noEmit` limpio · `store-public.test.ts` (el que cubre `/health`) 7/7 · suite completa corrida.
- Scripts: `node --check` en los 8 archivos. Probados de verdad `release --dry-run` (guardrails y flujo completo), `status` contra el backend real de producción, `rollback` sin args y con tag inexistente, `db-restore` (listado y validaciones) y `db-backup` en cuatro escenarios: credenciales inválidas, dump vacío, dump válido y binario sin soporte de `--column-statistics`.
- Frontend: `npm run build` OK, `version.json` generado correctamente.
- Se corrigieron cuatro bugs encontrados en esas pruebas: la guarda de "ejecutable directo" no funcionaba en Windows; un rechazo no manejado mataba el proceso dejando el `.sql.gz` truncado y el archivo con la clave de producción en `%TEMP%`; un dump vacío se conservaba como si fuera válido; y `status` reportaba error de red cuando el fallback SPA devuelve 200 en vez de 404.

### Riesgos y pendientes

1. **El primer release todavía no se hizo.** Requiere: mergear a `master` (el release exige estar en esa rama), crear `.env.release` con `MYSQL_PUBLIC_URL` de Railway, y correr `npm run release -- 1.0.0`.
2. **El backup nunca corrió contra la base real** — no había credenciales de producción disponibles en la sesión. El camino de error y el pipeline de compresión sí se verificaron. Conviene que el primer `npm run db:backup` se mire con atención.
3. **Un backup que nunca se restauró es una hipótesis.** Probar al menos una vez `npm run db:restore -- <archivo>` contra la base local.
4. **El rollback de frontend depende del snapshot local**: vive sólo en la máquina que releaseó. Desde otra máquina hay que hacer checkout del tag + `npm ci` + `npm run deploy`.

### Pendiente heredado de la sesión anterior (textos legales, sigue vigente)

1. **`feature/textos-legales` no está mergeada.** Es un **cambio de contrato de API**: backend y frontend tienen que desplegarse **juntos** (el frontend viejo contra el backend nuevo no puede comprar ni registrarse, da 422). El release coordinado que se implementó en esta sesión está pensado justamente para eso.
2. Cargar en Settings razón social, CUIT, domicilio, condición IVA y email reales, y la URL del QR de Data Fiscal de ARCA — sin eso los textos legales muestran "—".
3. Revisión legal de los textos e inscripción de la base ante la AAIP (a definir con un profesional).
4. **L-01 abierto**: la política de privacidad promete el derecho de supresión pero no existe `DELETE /me` ni purga de `store_events`.
5. De los bloqueantes de la auditoría del 2026-08-18, sólo está cerrado B-03. B-01 (productos de prueba) y B-02 (transferencia sin CBU) siguen abiertos.

### Cómo retomar

1. Leer [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md) — es el procedimiento completo.
2. Decidir si commitear este trabajo en `feature/textos-legales` o en una rama propia.
3. Antes del primer release: mergear a `master`, crear `.env.release`, y correr `npm run release -- 1.0.0 --dry-run` para ver el flujo sin efectos.

---

## Actualizar este documento cuando…

Termine cualquier sesión de trabajo no trivial. Reemplazar completamente la sección "Última actualización" por la de la sesión nueva (no acumular secciones viejas — para historial, usar git log y 08-DECISIONS.md).
