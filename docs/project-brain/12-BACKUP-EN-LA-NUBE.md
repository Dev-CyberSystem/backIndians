# 12 — Backup de la base en la nube (copia off-site)

> Estado al 2026-09-06: **pendiente de implementar**. Este documento evalúa las opciones y deja elegida una. El backup diario local ya existe (`npm run db:backup:daily` + Programador de tareas, ver [11-RELEASE-Y-ROLLBACK.md](11-RELEASE-Y-ROLLBACK.md)); lo que falta es una copia que **no** dependa de la máquina del desarrollador ni de su OneDrive.

## Por qué no alcanza lo que hay

- `npm run db:backup` (release) y `npm run db:backup:daily` escriben a `backIndians/.releases/db/`, que está **dentro de OneDrive**. OneDrive lo replica a la nube, pero **es la misma copia**: si se borra la carpeta, o la cuenta de OneDrive se corrompe/llena/suspende, o el disco muere con la sync pausada, se van todos los backups a la vez.
- Los backups viven **sólo en la PC del desarrollador**. Si esa PC no está disponible, no hay forma de restaurar.
- Es el hallazgo **R-07** de la auditoría del 2026-08-19, todavía abierto.

Objetivo: una copia diaria en un lugar independiente de (a) la PC y (b) la cuenta de OneDrive, idealmente con retención y verificación propias.

## Opciones evaluadas

### 1. GitHub Actions programado — **recomendada**

Un workflow `.github/workflows/db-backup.yml` en el repo `backIndians`, con `on: schedule` (cron diario). El runner de GitHub (Ubuntu, ya trae `mysql-client`) hace el `mysqldump`, lo comprime y lo sube.

**Dónde queda el dump** (elegir uno):
- **Artifact del workflow** — cero infra extra. Retención configurable hasta 90 días (`retention-days`). Suficiente como red de seguridad rodante.
- **Release/tag del repo** o un repo privado `indians-backups` — retención indefinida, pero suma ruido al repo.
- **Bucket S3 / Backblaze B2 / Cloudflare R2** — lo más robusto y barato (R2/B2 tienen capa gratuita que cubre de sobra un dump de <1 MB/día). Requiere crear el bucket y unas credenciales.

**A favor**: corre aunque la PC esté apagada; independiente de Railway y de OneDrive; el histórico de corridas queda visible en la pestaña Actions; gratis dentro de los minutos incluidos (un dump chico son ~1-2 min/día).

**En contra / cuidados**:
- La `MYSQL_PUBLIC_URL` de producción va como **secret del repo** (`Settings → Secrets and actions`). Es la credencial completa de la base productiva viviendo en GitHub — aceptable si el repo es privado y el acceso está restringido, pero es una superficie nueva. Rotarla si alguna vez se filtra.
- Reusar la lógica de verificación (`verify-dump.cjs`) para no subir un dump truncado: el workflow puede hacer `node scripts/release/db-backup.mjs` directamente (ya verifica) y después subir el `.sql.gz` resultante.
- Cron de GitHub Actions puede demorarse varios minutos respecto de la hora exacta, y en repos sin actividad se **deshabilita a los 60 días** — hay que reactivarlo o hacer un commit cada tanto.

### 2. Railway — backups nativos del servicio MySQL

Si el plan de Railway lo incluye, activar los backups automáticos del plugin de MySQL (panel del servicio → Backups).

**A favor**: cero código, un clic.
**En contra**: **mismo proveedor** que la base — no protege contra un problema de cuenta/facturación de Railway, que es justamente uno de los escenarios a cubrir. Sirve como *tercera* pata, no como la copia off-site principal.

### 3. Cron en un servidor propio / NAS / Raspberry

Un `cron` que corra `mysqldump` contra `MYSQL_PUBLIC_URL` y guarde local + suba a un bucket.

**A favor**: control total.
**En contra**: hay que tener y mantener ese equipo encendido; es la opción con más superficie operativa. Sólo tiene sentido si ya existe infraestructura así.

### 4. Servicio gestionado de backups (SimpleBackups, SnapShooter, etc.)

Se conectan a la base por la URL pública y hacen el dump + subida a un bucket con retención y alertas.

**A favor**: nada que mantener, alertas de fallo incluidas.
**En contra**: costo mensual; una tercera parte más con la credencial de producción.

## Decisión

**GitHub Actions programado**, subiendo a **Cloudflare R2 o Backblaze B2** (capa gratuita), y como fallback inmediato mientras se crea el bucket, **artifact del workflow con `retention-days: 90`**.

Racional: es lo que corre sin depender de la PC, no agrega un proveedor pago, y puede reutilizar `scripts/release/db-backup.mjs` tal cual (que ya verifica el dump). El secret con la URL de producción es el único costo real y es tolerable en un repo privado con acceso acotado.

Complemento opcional: activar además los backups nativos de Railway si el plan los tiene (opción 2), como tercera copia.

## Esbozo de implementación (cuando se haga)

1. `backIndians/.github/workflows/db-backup.yml`:
   - `on: schedule: - cron: '20 6 * * *'` (06:20 UTC ≈ 03:20 AR) + `workflow_dispatch` para poder correrlo a mano.
   - Job en `ubuntu-latest`: `checkout` → `setup-node` → `npm ci` → escribir `.env.release` desde el secret → `node scripts/release/db-backup.mjs --tag=cloud` → subir `.releases/db/cloud-*.sql.gz` (a R2/B2 con `aws s3 cp` compatible, o `actions/upload-artifact`).
   - Retención: si es bucket, una regla de lifecycle (p. ej. borrar a los 60 días); si es artifact, `retention-days: 90`.
2. Secret `MYSQL_PUBLIC_URL` (y, si aplica, credenciales del bucket) en `Settings → Secrets and variables → Actions`.
3. Notificación de fallo: `if: failure()` que mande un aviso por el mismo canal que las alertas del sistema (mail/CallMeBot), para no enterarse recién cuando se necesita restaurar.
4. Probar restaurando uno de esos dumps contra la base local: `npm run db:restore -- <archivo>`.

## Actualizar este documento cuando…

Se implemente el workflow (pasar el estado a "implementado" y anotar dónde quedan los dumps y cómo restaurarlos), cambie el destino de los backups, o se sume/quite una de las patas.
