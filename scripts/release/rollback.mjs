// Guía y ejecuta la vuelta atrás de un release.
//
// Un rollback tiene tres planos independientes, y confundirlos es la forma
// habitual de empeorar una caída:
//
//   1. FRONTEND  — reversible en segundos: se resube el snapshot de la versión
//                  anterior. Sin riesgo de pérdida de datos.
//   2. BACKEND   — reversible en minutos desde Railway (redeploy del deployment
//                  anterior) o por git. El código vuelve; la BASE no.
//   3. BASE      — NO se revierte sola. Si el release corrió migraciones
//                  destructivas, la única vuelta atrás es el backup.
//
// Por eso este script ejecuta sólo el plano 1 (seguro y reversible) y para los
// otros dos imprime el procedimiento exacto: son decisiones que necesitan un
// humano mirando qué se rompió.
//
// Uso:
//   npm run rollback              # muestra a qué versiones se puede volver
//   npm run rollback -- v1.3.0 --from=v1.4.0
//                                  # vuelve a v1.3.0 desde lo desplegado (v1.4.0)

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  BACKUP_DIR,
  BACK_DIR,
  FRONT_DIR,
  FRONT_SNAPSHOT_DIR,
  REPOS,
  abort,
  c,
  confirm,
  currentVersion,
  git,
  listVersionTags,
  loadReleaseEnv,
  log,
  parseArgs,
  runLive,
} from './lib.mjs';

const { flags, positional } = parseArgs(process.argv.slice(2));

function availableSnapshots() {
  if (!existsSync(FRONT_SNAPSHOT_DIR)) return [];
  return readdirSync(FRONT_SNAPSHOT_DIR).filter((d) => /^v\d+\.\d+\.\d+$/.test(d));
}

function backupsFor(version) {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql.gz'))
    .map((f) => ({ name: f, ...statSync(path.join(BACKUP_DIR, f)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function printOptions() {
  const tags = listVersionTags(BACK_DIR);
  const snapshots = availableSnapshots();
  const current = currentVersion();

  log.step('Versiones disponibles para rollback');
  if (!tags.length) {
    log.warn('Todavía no hay ningún release tageado.');
    log.info('El primer release se crea con: npm run release');
    return;
  }

  for (const tag of [...tags].reverse()) {
    const marks = [];
    if (tag === current) marks.push(c.green('actual'));
    if (snapshots.includes(tag)) marks.push(c.dim('snapshot de frontend'));
    else marks.push(c.yellow('sin snapshot (requiere rebuild)'));
    log.plain(`  ${c.bold(tag.padEnd(10))} ${marks.join('  ')}`);
  }

  const backups = backupsFor();
  log.step(`Backups de base (${backups.length})`);
  backups.slice(0, 5).forEach((b) =>
    log.plain(`  ${(b.size / 1024 / 1024).toFixed(2).padStart(8)} MB  ${b.mtime.toLocaleString('es-AR')}  ${b.name}`)
  );
  if (!backups.length) log.warn('No hay backups guardados — el rollback de datos no sería posible.');

  log.plain(`\n${c.dim('Volver a una versión: npm run rollback -- <destino> --from=<versión-productiva>')}`);
}

/** Plano 1: resubir por FTP el build de la versión anterior. */
async function rollbackFrontend(version) {
  const snapshot = path.join(FRONT_SNAPSHOT_DIR, version);

  log.step('Plano 1 — Frontend');
  if (!existsSync(path.join(snapshot, 'index.html'))) {
    log.warn(`No hay snapshot de ${version} en frontIndians/.releases/`);
    log.plain('  Rollback manual del frontend (rebuild desde el tag):');
    log.plain(`    cd frontIndians`);
    log.plain(`    git checkout ${version}`);
    log.plain(`    npm ci && npm run deploy`);
    log.plain(`    ${c.dim('al terminar: git checkout master')}`);
    return;
  }

  log.info(`snapshot encontrado: .releases/${version}/`);
  const ok = await confirm(`¿Resubir el frontend ${c.bold(version)} por FTP ahora?`);
  if (!ok) {
    log.info('Salteado. Comando manual:');
    log.plain(`    cd frontIndians && npm run deploy:release -- ${version}`);
    return;
  }

  const done = runLive('node', ['scripts/deploy-ftp.mjs', `--from=.releases/${version}`], { cwd: FRONT_DIR });
  if (!done) abort('Falló la subida por FTP', 'Revisá las credenciales en frontIndians/.env.deploy.');
  log.ok(`Frontend revertido a ${version}`);
}

/** Plano 2: instrucciones para volver el backend (no se ejecuta solo). */
function rollbackBackend(version) {
  log.step('Plano 2 — Backend (Railway)');
  log.plain(`  ${c.bold('Opción A — desde el panel de Railway (más rápida, recomendada)')}`);
  log.plain('    Deployments -> buscar el deploy anterior -> "Redeploy"');
  log.plain(`    ${c.dim('Vuelve el código en ~1 minuto sin tocar git. NO revierte migraciones.')}`);

  log.plain(`\n  ${c.bold('Opción B — por git (deja la historia consistente)')}`);
  log.plain(`    cd backIndians`);
  log.plain(`    git revert --no-edit <sha-del-cambio-que-rompio>`);
  log.plain(`    git push origin master`);
  log.plain(`    ${c.dim('Railway redeploya solo. Preferible si el rollback va a durar.')}`);

  log.plain(`\n  ${c.bold('Opción C — forzar master al tag anterior (último recurso)')}`);
  log.plain(`    git push origin ${version}^{}:master --force`);
  log.plain(`    ${c.red('Reescribe master. Sólo si A y B no sirven y sabés qué estás descartando.')}`);
}

/** Plano 3: la base. Lo que no vuelve solo. */
function rollbackDatabase(version, sourceVersion) {
  log.step('Plano 3 — Base de datos');

  const backups = backupsFor();
  // El backup v1.4.0 se toma ANTES de desplegar v1.4.0. Por eso, al volver a
  // v1.3.0, el dump correcto se busca por la versión de origen (v1.4.0), no
  // por el destino. Confundir esas dos versiones puede restaurar datos viejos.
  const match = sourceVersion
    ? backups.find((b) => b.name.startsWith(`${sourceVersion}-`))
    : null;

  log.plain(`  ${c.bold('Primero preguntate: ¿el release corrió migraciones?')}`);
  log.plain('    cd backIndians');
  log.plain('    npx sequelize-cli db:migrate:status --env production');
  log.plain(`    ${c.dim('Si las migraciones nuevas son sólo aditivas (columnas/tablas nuevas), el')}`);
  log.plain(`    ${c.dim('código viejo convive con ellas y NO hace falta tocar la base. Ese es el')}`);
  log.plain(`    ${c.dim('caso normal y el más seguro: no restaures si no es necesario.')}`);

  log.plain(`\n  ${c.bold('Si hay que revertir una migración concreta:')}`);
  log.plain('    npm run migrate:undo -- --env production   # revierte SOLO la última');
  log.plain(`    ${c.red('Verificá antes que esa migración tenga un `down` real y probado.')}`);

  log.plain(`\n  ${c.bold('Si hubo pérdida o corrupción de datos (restore completo):')}`);
  if (match) {
    log.plain(`    npm run db:restore -- ${match.name} --target=prod`);
    log.plain(`    ${c.dim(`backup previo al release ${sourceVersion}, tomado el ${match.mtime.toLocaleString('es-AR')}`)}`);
  } else if (sourceVersion && backups.length) {
    log.plain(`    ${c.red(`No hay backup etiquetado ${sourceVersion}, que es la versión de origen indicada.`)}`);
    log.plain('    npm run db:restore   # listar y revisar fechas; no elegir uno a ciegas');
  } else if (backups.length) {
    log.plain('    npm run db:restore   # listar backups y ubicar el tomado justo antes del deploy fallido');
    log.plain(`    ${c.yellow('Falta --from=<versión-productiva>; no se sugiere un dump automáticamente.')}`);
  } else {
    log.plain(`    ${c.red('NO HAY BACKUPS. No se puede revertir la base a un estado anterior.')}`);
  }
  log.plain(`\n    ${c.yellow('Ojo: restaurar pisa TODO lo que pasó desde que se tomó el backup')}`);
  log.plain(`    ${c.yellow('(pedidos, pagos y cobros reales incluidos). Es el último recurso.')}`);
}

async function main() {
  loadReleaseEnv();

  if (!positional.length) {
    printOptions();
    return;
  }

  const version = positional[0].startsWith('v') ? positional[0] : `v${positional[0]}`;
  const sourceVersion = flags.from
    ? (String(flags.from).startsWith('v') ? String(flags.from) : `v${flags.from}`)
    : null;
  if (sourceVersion && !/^v\d+\.\d+\.\d+$/.test(sourceVersion)) {
    abort(`Versión de origen inválida: "${flags.from}"`, 'Usá --from=vX.Y.Z con la versión que informa `npm run prod`.');
  }
  const known = REPOS.some((r) => listVersionTags(r.dir).includes(version));
  if (!known && !flags.force) {
    abort(`No existe el tag ${version} en ninguno de los dos repos`, 'Corré `npm run rollback` para ver las versiones disponibles.');
  }

  log.plain(c.bold(`\n=== Rollback a ${version} ===`));
  log.plain(c.dim('Se ejecuta sólo el frontend; backend y base se guían paso a paso.'));

  await rollbackFrontend(version);
  rollbackBackend(version);
  rollbackDatabase(version, sourceVersion);

  log.plain(`\n${c.bold('Después del rollback:')}`);
  log.plain('  1. Verificá el sistema: npm run release:status');
  log.plain('  2. Anotá qué pasó en docs/project-brain/10-SESSION-HANDOFF.md');
  log.plain('  3. El tag del release fallido NO se borra: es el registro de qué se intentó.');
}

main().catch((err) => abort(err.message));
