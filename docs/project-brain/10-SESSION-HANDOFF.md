# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-08-19 — Sistema de releases implementado y v1.0.0 en producción

### Objetivo de la sesión

Poder subir a producción de forma controlada y poder volver atrás si algo falla. Hasta ahora el deploy era pushear a `master` (Railway deploya solo) y correr `npm run deploy` en el frontend: sin versiones, sin tags en la historia de ninguno de los dos repos, y sin ninguna red bajo la base de datos. Sesión larga, en dos tramos: primero se construyó el sistema, después se usó de verdad para hacer el primer release.

### Qué se hizo

**Scripts nuevos (`backIndians/scripts/release/`)**: `release.mjs`, `db-backup.mjs`/`db-restore.mjs`, `rollback.mjs`, `status.mjs`. Procedimiento completo en [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md) — no repetir acá.

**Cambios en la aplicación**: `src/config/version.ts` + `/health` reporta `version`/`commit`; frontend genera `dist/version.json` en cada build y `deploy-ftp.mjs` sabe republicar un snapshot (`--from=` o una versión suelta); scripts nuevos en ambos `package.json`.

**Cambio de comportamiento a tener en cuenta**: `npm run migrate:undo` ya no es `db:migrate:undo:all` (todas las migraciones) — ahora revierte sólo la última. El viejo comportamiento quedó en `migrate:undo:all`.

**El primer release (v1.0.0) se hizo de verdad y está en producción.** Antes de eso se resolvió el pendiente heredado: `feature/textos-legales` ya estaba mergeada y pusheada a `master` en los dos repos (se había hecho en otra sesión no documentada acá — el handoff anterior tenía ese dato desactualizado). El trabajo de esta sesión se hizo en `feature/release-system`, se mergeó a `master` y se releaseó desde ahí.

### Bugs reales encontrados usando el sistema por primera vez (los cuatro ya corregidos y en `master`)

1. La guarda de "ejecutable directo" (`import.meta.url === ...`) no funcionaba en Windows con rutas `file://` de tres barras — el script no hacía nada al invocarlo directo.
2. `db-backup.mjs`: un rechazo de promesa no manejado durante el pipeline mataba el proceso antes del `finally`, dejando el `.sql.gz` truncado y **el archivo con la contraseña de producción en `%TEMP%`**. Un dump vacío también se conservaba como si fuera válido.
3. **`git` bajo `cmd.exe` en Windows partía el mensaje de commit por los paréntesis** (`chore(release): v1.0.0` → git recibía `v1.0.0` como pathspec extra y fallaba). `git.exe` es un ejecutable real, no necesita `shell:true` como `npm.cmd`; ahora `git()` fuerza `shell:false`.
4. Cuando el paso de tag fallaba a mitad de camino, la reversión sólo restauraba la versión de `package.json` pero dejaba `CHANGELOG.md` a medio escribir y stageado — el reintento habría duplicado la entrada. Ahora la reversión deshace todo (versión + changelog + staging).
5. `core.autocrlf=true` en la máquina de desarrollo hacía que `git status --porcelain` marcara `package.json` como modificado por pura renormalización de fin de línea, sin ninguna diferencia de contenido — bloqueaba el release por las dudas. Ahora se compara con `git diff --name-only` (ya normalizado).

Ninguno de estos bugs tocó producción: todos aparecieron en los guardrails (el release se frenó solo, tres veces, antes de tocar nada) o en pruebas deliberadas contra escenarios de fallo.

### Validación

- Backend: 48 suites / 325 tests en verde, dos veces (una manual sobre `master`, otra dentro del propio `release.mjs`). `tsc --noEmit` limpio.
- Frontend: Vitest en verde, `npm run build` OK.
- Backup real contra la base de producción de Railway: verificado dos veces (51 tablas, gzip íntegro).
- `release:status` verificado de punta a punta contra la producción real después del deploy: backend y frontend reportando `v1.0.0`, coincidiendo con el tag local.
- Humo en producción: `sistema.indians.com.ar/login` → 200, `indians.com.ar` → 200.

### Riesgos y pendientes

1. **Un backup que nunca se restauró es una hipótesis.** El backup se probó (dos veces, contra producción), pero el restore sólo se probó en el camino de error, nunca restaurando de verdad. Probar `npm run db:restore -- <archivo>` contra la base local en algún momento.
2. **El rollback de frontend depende del snapshot local** (`frontIndians/.releases/v1.0.0/`): vive sólo en esta máquina. Desde otra, `npm run rollback` va a indicar el camino alternativo (checkout del tag + `npm ci` + `npm run deploy`).
3. `backIndians/.env.release` ya existe en esta máquina con `MYSQL_PUBLIC_URL` real de Railway — no está commiteado (gitignored), así que **no viaja con el repo**. Cualquiera que releasee desde otra máquina necesita crear el suyo.

### Pendiente heredado de la sesión de textos legales (sigue vigente, ya en producción)

Como `feature/textos-legales` terminó mergeada y ahora forma parte de `v1.0.0` en producción, sus pendientes de negocio (no de código) siguen abiertos:

1. Cargar en Settings razón social, CUIT, domicilio, condición IVA y email reales, y la URL del QR de Data Fiscal de ARCA — sin eso los textos legales muestran "—" en producción ahora mismo.
2. Revisión legal de los textos e inscripción de la base ante la AAIP (a definir con un profesional).
3. **L-01 abierto**: la política de privacidad promete el derecho de supresión pero no existe `DELETE /me` ni purga de `store_events`.
4. De los bloqueantes de la auditoría del 2026-08-18, sólo está cerrado B-03. B-01 (productos de prueba) y B-02 (transferencia sin CBU) siguen abiertos.

### Cómo retomar

1. El sistema de releases ya está probado en producción — para el próximo release, `npm run release -- patch` (o `minor`/`major`) directamente, sin dry-run necesario salvo que se quiera revisar antes.
2. Los pendientes de negocio de textos legales (arriba) son la prioridad más visible: están en producción mostrando "—" donde deberían ir los datos fiscales reales.

---

## Actualizar este documento cuando…

Termine cualquier sesión de trabajo no trivial. Reemplazar completamente la sección "Última actualización" por la de la sesión nueva (no acumular secciones viejas — para historial, usar git log y 08-DECISIONS.md).
