# 11 — Release y rollback

> Creado el **2026-08-19**. Describe el sistema de releases versionados implementado en `backIndians/scripts/release/`.
> **v1.0.0 se releaseó de verdad ese mismo día** (no sólo se probó en dry-run): tests reales, backup real contra la base de producción de Railway, push, deploy de los dos lados y verificación con `release:status` contra la producción real. Los procedimientos de este documento están probados de punta a punta, no sólo diseñados.

## Por qué existe

Antes de esto, "subir a producción" era: pushear a `master` (Railway deploya solo) y correr `npm run deploy` en el frontend. Eso funciona hasta el día que algo sale mal, y entonces no hay:

- **una versión** que nombrar ("volvamos a lo de antes" no es una instrucción ejecutable),
- **un punto al que volver** (ningún tag en la historia de ninguno de los dos repos),
- **una red bajo la base de datos** (Railway corre `npm run migrate` en cada deploy; para cuando se detecta el problema, las migraciones ya se aplicaron).

El sistema de releases resuelve las tres cosas.

## Regla permanente: todo cambio en `src/` sale por `npm run release`

**`git push origin master` queda reservado para documentación.** No es una recomendación de estilo.

El 2026-08-19 a la mañana se terminó de construir este sistema; el primer cambio de la tarde (`4714458`) lo esquivó por completo — sin tag, sin bump, sin backup y sin pasar por la validación. Ese commit cambiaba un contrato de API, rompía 59 tests y modificaba el comportamiento de cobro de la tienda, y llegó a producción sin que nadie lo notara. `npm run release` corre la suite antes de tagear: habría frenado el push.

Las consecuencias no fueron sólo los tests rojos:

- **El número de versión dejó de identificar código.** Los tres componentes declaraban `v1.0.0` y ninguno era el commit del tag.
- **El rollback dejó de servir.** El snapshot de frontend guardado para `v1.0.0` era el commit `36dc6fc` mientras producción corría `9f91f57`: un `npm run rollback -- v1.0.0` habría republicado un frontend que todavía ofrecía el pago en efectivo — reintroduciendo en silencio un cambio de negocio.

"Es un cambio chico" es exactamente el caso que nadie mira. Ver [DEC-018](08-DECISIONS.md).

## Modelo mental: el rollback tiene tres planos

Confundirlos es la forma habitual de empeorar una caída. De más fácil a más difícil de revertir:

| Plano | Cómo se revierte | Tiempo | Riesgo |
|---|---|---|---|
| **Frontend** (estático en Ferozo) | Se resube el snapshot de la versión anterior | segundos | ninguno |
| **Backend** (Railway) | Redeploy del deployment anterior, o `git revert` + push | ~1-3 min | ninguno para los datos |
| **Base de datos** | Sólo con el backup, o revirtiendo migraciones una a una | minutos a horas | **pérdida de datos reales** |

La regla que sigue de esto: **casi nunca hay que tocar la base**. Si el release sólo agregó columnas o tablas (el caso normal), el código viejo convive perfectamente con el esquema nuevo. Restaurar un backup pisa todo lo que pasó desde que se tomó — pedidos, pagos y cobros reales incluidos — así que es el último recurso, no el primero.

## Versionado

Una sola versión `vX.Y.Z` para **ambos** repos, aunque en un release uno de los dos no haya cambiado. Así "producción está en v1.4.0" es una frase completa y verificable, en vez de dos números y una tabla de compatibilidad mental.

- La fuente de verdad son los **tags git**, presentes en los dos repos.
- `package.json` de cada repo se mantiene sincronizado con el tag (lo hace el script).
- El backend expone su versión en `/health`; el frontend, en `/version.json`. Eso permite verificar qué está corriendo de verdad en lugar de confiar en la memoria.
- El primer release es `v1.0.0`, no `v0.0.1`: el sistema ya está en producción con usuarios reales.

Criterio de numeración: `major` cambio que rompe algo o migración destructiva; `minor` funcionalidad nueva; `patch` correcciones.

## Configuración previa (una sola vez por máquina)

```bash
cd backIndians
cp .env.release.example .env.release
```

Completar `.env.release` con:

- `MYSQL_PUBLIC_URL` — de las variables del proyecto en Railway (la **pública**; la interna sólo resuelve dentro de Railway). Sin esto no hay backup ni restore.
- `RELEASE_API_URL`, `RELEASE_SYSTEM_URL`, `RELEASE_STORE_URL` — para que `release:status` pueda verificar qué hay desplegado.

`.env.release` **no se commitea** (está en `.gitignore`). También hace falta `mysqldump`: el script busca solo en las rutas habituales de Windows; si no lo encuentra, se le indica con `MYSQLDUMP_PATH`.

## Preparar un release

```bash
cd backIndians
npm run release              # patch: v1.2.3 -> v1.2.4
npm run release -- minor     # v1.2.3 -> v1.3.0
npm run release -- 2.0.0     # versión explícita
npm run release -- --dry-run # simula todo sin escribir nada
```

Qué hace, en orden:

1. **Verifica los dos repos**: rama `master`, sin cambios sin commitear, sin quedar detrás de `origin`. Cualquiera de esas cosas frena el release.
2. **Corre las validaciones**: typecheck + `test:full` del backend; tests + build + prerender del frontend. El lint queda afuera a propósito — hay 162 errores preexistentes (ver [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md)) y bloquear por eso haría el release imposible sin arreglar deuda ajena al cambio.
3. **Saca el backup de producción** a `.releases/db/vX.Y.Z-<fecha>.sql.gz`.
4. **Sincroniza `package.json`**, actualiza `CHANGELOG.md` y crea el tag `vX.Y.Z` en ambos repos.
5. **Guarda el build del frontend** en `frontIndians/.releases/vX.Y.Z/` — el mismo que se acaba de validar.

**No deploya.** El deploy es el momento de mayor riesgo y no debe ocurrir por inercia; al terminar, el script imprime los comandos exactos.

Flags: `--dry-run`, `--skip-tests`, `--skip-backup`, `--allow-dirty`, `--branch=<rama>`. Los últimos cuatro son escapes para situaciones excepcionales; usarlos deja una versión tageada que nadie verificó o sin red de seguridad.

## Deployar

```bash
# 1. Backend — Railway deploya solo al recibir el push
cd backIndians
git push origin master && git push origin vX.Y.Z

# 2. Verificar que levantó (health debe reportar la versión nueva)
npm run release:status

# 3. Frontend — sube el build exacto que se validó
cd ../frontIndians
git push origin master && git push origin vX.Y.Z
npm run deploy:release -- vX.Y.Z

# 4. Humo en producción
#    - https://sistema.indians.com.ar/login  (entrar con un usuario real)
#    - https://indians.com.ar               (la tienda lista productos)
#    - un pedido end-to-end si el release toca checkout
```

`deploy:release` sube el snapshot guardado en lugar de rebuildear: publica exactamente lo que se validó, sin depender de que el árbol de dependencias de hoy produzca el mismo resultado que hace un rato.

## Verificar qué hay en producción

```bash
cd backIndians && npm run release:status
# Alias corto para la consulta cotidiana:
cd backIndians && npm run prod
```

Compara el tag local con lo que reportan el `/health` del backend y el `/version.json` de los dos hostnames del frontend. Detecta los dos problemas silenciosos: **deploy a medias** (backend, sistema y tienda en versiones distintas) y **release sin deployar** (tag creado pero producción todavía en la versión anterior).

El mismo reporte valida los **commits exactos**: detecta si un componente conserva el número `vX.Y.Z` en `package.json` pero fue desplegado desde un commit distinto al tag/snapshot de esa release. Además calcula el **objetivo de rollback seguro común**: la release anterior que tiene tag tanto en back como en front y que es menor a todo lo que está desplegado. También informa si existe el snapshot local del frontend y el backup previo al release productivo. Si falta visibilidad de algún componente, o todavía no existe una release anterior (por ejemplo mientras `v1.0.0` siga siendo la primera y única), no inventa un destino: lo marca como intervención manual.

## Rollback

```bash
cd backIndians
npm run rollback              # lista las versiones disponibles
npm run rollback -- v1.3.0 --from=v1.4.0
                              # guía la vuelta de v1.4.0 a v1.3.0
```

El script **ejecuta** el plano 1 (resubir el frontend anterior, con confirmación) y **guía** los planos 2 y 3, que necesitan a alguien mirando qué se rompió.

### Backend

- **Opción A (recomendada)**: en Railway, Deployments → el deploy anterior → *Redeploy*. Un minuto, sin tocar git.
- **Opción B**: `git revert --no-edit <sha>` + push. Preferible si el rollback va a durar, porque deja la historia consistente.
- **Opción C (último recurso)**: `git push origin vX.Y.Z^{}:master --force`. Reescribe `master`.

### Base de datos

Primero, la pregunta que evita la mayoría de los desastres:

```bash
npm run migrate:status -- --env production
```

Si las migraciones nuevas son **aditivas** (columnas o tablas nuevas), el código viejo funciona con ellas: **no hay que tocar la base**. Ese es el caso normal.

Si hay que revertir una migración concreta:

```bash
npm run migrate:undo -- --env production   # revierte SOLO la última
```

Verificar antes que esa migración tenga un `down` real. Varias migraciones del proyecto no lo tienen.

Si hubo pérdida o corrupción de datos:

```bash
npm run db:restore                                  # lista los backups
npm run db:restore -- <archivo> --target=prod       # restaura (pide confirmación fuerte)
```

El restore a producción saca automáticamente un backup del estado actual antes de pisarlo, por si el restore resulta ser el error.

El valor de `--from` es importante: el backup `v1.4.0-<fecha>.sql.gz` se tomó **antes de desplegar v1.4.0**. Por lo tanto, para volver de `v1.4.0` a `v1.3.0`, ese es el backup asociado; no el que empieza con `v1.3.0`. `npm run prod` imprime el comando completo con origen y destino para no depender de la memoria durante un incidente.

> **Ojo**: `migrate:undo` cambió de comportamiento. Antes era `db:migrate:undo:all` (revertía **todas** las migraciones, o sea el esquema entero). Ahora revierte sólo la última, que es lo que el nombre sugiere. El comportamiento viejo quedó en `migrate:undo:all`.

## Probar un backup sin arriesgar producción

`db:restore` apunta a la base **local** por defecto, justamente para esto:

```bash
npm run db:restore -- <archivo>    # restaura sobre la base de desarrollo
```

Un backup que nunca se restauró es una hipótesis, no un respaldo. Conviene hacerlo cada tanto.

## Verificación automática del backup (desde 2026-08-19)

`db:backup` ya no se conforma con que el archivo exista y pese algo. Después de escribirlo, `scripts/release/verify-dump.cjs` comprueba tres cosas y, si alguna falla, **borra el archivo y aborta**:

1. el **gzip descomprime entero** (un dump cortado lanza `Z_BUF_ERROR`);
2. el SQL termina con el **trailer `-- Dump completed on`**, que `mysqldump` escribe recién al final;
3. la **cantidad de tablas** llega al piso esperado (`BACKUP_MIN_TABLES`, default 40).

Además avisa —sin abortar— si el backup nuevo trae menos tablas que el anterior sano.

**Por qué**: el 2026-08-19 el backup tomado específicamente para poder deshacer el `TRUNCATE` de ~40 tablas productivas quedó **truncado** —descomprimía 142 KB, cortaba a mitad de un `INSERT` de `store_events` y le faltaban 9 tablas, entre ellas `store_orders` y `users`— y el script lo dio por bueno. Los tres controles que tenía no alcanzaban: cuando `mysqldump` muere, su stdout se cierra y el `pipeline` resuelve **limpio**; el proceso no devolvió un código distinto de cero; y el archivo superó el piso de tamaño. El modo de falla es el peor posible —archivo presente, con nombre correcto y tamaño plausible, inservible— porque nadie lo mira hasta que lo necesita.

Un backup roto que se conserva es peor que ninguno: `db:restore` y `rollback` lo listan como válido y alguien confía en él justo cuando más importa.

La lógica de verificación tiene tests propios (`src/__tests__/unit/verify-dump.test.ts`), que corren contra archivos truncados a propósito — sin base de datos real.

## Correr SQL contra producción: `npm run db:exec`

```bash
npm run db:exec -- ruta/al/archivo.sql          # pide confirmación si toca datos
npm run db:exec -- ruta/al/archivo.sql --yes    # no interactivo
```

Se llamaba `db:query` y su encabezado decía *"SOLO LECTURA"* sin nada que lo restringiera — fue la herramienta con la que se ejecutó el `TRUNCATE` de ~40 tablas productivas. Ahora el nombre dice la verdad y, cuando el `.sql` contiene DDL/DML, **muestra las sentencias detectadas y la base destino y exige escribir el nombre de la base** para seguir. Ver [DEC-017](08-DECISIONS.md).

La detección ignora comentarios y literales de texto a propósito: un aviso que salta en falso entrena a confirmar sin leer.

## Qué queda fuera de git a propósito

| Ruta | Por qué |
|---|---|
| `backIndians/.releases/db/` | Dumps con datos reales de producción (clientes, pagos, mails) |
| `backIndians/.env.release` | Credenciales de la base de producción |
| `frontIndians/.releases/` | Snapshots de build; son artefactos, se regeneran |

Los snapshots del frontend viven **sólo en la máquina que releaseó**. Si el rollback hay que hacerlo desde otra máquina, el script detecta que no hay snapshot e indica el camino alternativo (checkout del tag + `npm ci` + `npm run deploy`).

## Limitaciones conocidas

- **No hay CI**: las validaciones corren en la máquina de quien releasea. Si esa máquina no tiene MySQL levantado, `test:full` falla y el release se frena (correcto, pero es un acoplamiento al entorno local).
- **El backup se toma en el momento del release, no del deploy**. Si pasan horas entre uno y otro, el backup no refleja el estado real previo al deploy. Para deploys diferidos conviene correr `npm run db:backup` justo antes de pushear.
- **`test:full` resetea la base de desarrollo local** (corre los seeders). Es lo esperado, pero conviene saberlo antes de releasear con datos locales que importen.
- **El rollback de frontend depende del snapshot local** (ver arriba).
- **"Íntegro" no es "restaurable"**: la verificación comprueba que el dump descomprime completo y cierra bien, no que restaure sin errores. Para eso está `db:restore` contra la base local (arriba).
- **Los backups viven sólo en esta máquina** (`backIndians/.releases/db/`, gitignored, dentro de una carpeta de OneDrive). Un borrado sincronizado se los lleva a todos. Falta una copia fuera del equipo (hallazgo R-07).

## Gotchas de Windows ya resueltos (por si reaparecen en una máquina distinta)

Encontrados haciendo el primer release real (v1.0.0, 2026-08-19), ya corregidos en el código — se documentan acá porque son específicos del entorno, no del diseño, y podrían reaparecer en otra instalación de Windows con una config distinta:

- **`git` no corre bajo `shell:true`**. `npm` sí lo necesita en Windows (resuelve a `npm.cmd`, que `spawnSync` no puede ejecutar directo), pero `git.exe` es un ejecutable real. Pasarlo por `cmd.exe` hacía que mensajes de commit con paréntesis —como `chore(release): v1.0.0`— se partieran en dos argumentos y el commit fallara. Si algún comando git nuevo se agrega a los scripts, no asumir que necesita shell.
- **`core.autocrlf=true`** puede hacer que `git status --porcelain` marque un archivo como modificado sin que haya diferencia de contenido real (renormalización de fin de línea). El chequeo de "working tree limpio" del release usa `git diff --name-only` (post-normalización) en vez del marcador crudo de `status`, justamente por esto.
- **`mysqldump` en esta máquina** vive en `C:/Program Files/MySQL/MySQL Server 8.0/bin/`, no en el PATH. El script ya prueba esa ruta y otras habituales; si la instalación es distinta, usar `MYSQLDUMP_PATH` en `.env.release`.

## Actualizar este documento cuando…

Cambie el hosting de cualquiera de los dos lados, se agregue CI, cambie el esquema de versionado, o se descubra un modo de falla nuevo durante un rollback real.
