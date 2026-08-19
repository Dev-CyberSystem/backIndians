// Prepara un release coordinado de backIndians + frontIndians.
//
// Qué hace: valida que ambos repos estén en condiciones, corre las validaciones
// obligatorias del proyecto, saca un backup de la base de producción, sincroniza
// el número de versión, deja un tag `vX.Y.Z` en LOS DOS repos y guarda el build
// exacto del frontend que se validó.
//
// Qué NO hace: deployar. El push a master (que dispara Railway) y la subida por
// FTP quedan en manos de quien releasea — decisión explícita: el deploy es el
// momento de mayor riesgo y no debe pasar por accidente. Al terminar imprime los
// comandos exactos a correr.
//
// Uso:
//   npm run release                 # patch (v1.2.3 -> v1.2.4)
//   npm run release -- minor        # v1.2.3 -> v1.3.0
//   npm run release -- 2.0.0        # versión explícita
//   npm run release -- --dry-run    # simula todo sin escribir ni tagear
//
// Flags: --dry-run, --skip-tests, --skip-backup, --branch=<rama>, --allow-dirty, --yes

import { cpSync, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BACK_DIR,
  FRONT_DIR,
  FRONT_SNAPSHOT_DIR,
  REPOS,
  abort,
  assertReposExist,
  c,
  confirm,
  currentBranch,
  currentVersion,
  ensureDir,
  getPackageVersion,
  git,
  listVersionTags,
  log,
  parseArgs,
  resolveTargetVersion,
  runLive,
  setPackageVersion,
  shortSha,
} from './lib.mjs';
import { backupDatabase } from './db-backup.mjs';

const { flags, positional } = parseArgs(process.argv.slice(2));
const DRY = Boolean(flags['dry-run']);
const EXPECTED_BRANCH = typeof flags.branch === 'string' ? flags.branch : 'master';

/**
 * Red de seguridad del release parcial.
 *
 * Entre el bump y el tag hay pasos que pueden cortar el proceso de golpe: el
 * backup llama a `abort` (process.exit), y `tagRepos()` puede fallar a mitad
 * de camino (pasó de verdad: un bug de escaping en Windows hizo fallar el
 * `git commit` de backIndians DESPUÉS de que `git add` ya había stageado
 * package.json y CHANGELOG.md). Sin este handler, un release fallido deja:
 * el package.json con una versión que no existe en ningún tag, archivos
 * stageados sin commitear, y un CHANGELOG.md a medio escribir que el
 * próximo intento reescribiría duplicando la entrada arriba de sí misma.
 *
 * El package.json se restaura sólo en su campo `version`, no el archivo
 * entero: con `--allow-dirty` puede haber cambios legítimos sin commitear
 * (un script nuevo, una dependencia), y un `git checkout --` se los llevaría
 * puestos.
 */
const versionsBeforeBump = new Map();
const changelogPath = path.join(BACK_DIR, 'CHANGELOG.md');
let changelogBackup = null; // { existed, content } — se completa recién antes de escribirlo
let releaseCompleted = false;

process.on('exit', () => {
  if (!versionsBeforeBump.size || releaseCompleted) return;
  try {
    for (const [dir, previousVersion] of versionsBeforeBump) {
      setPackageVersion(dir, previousVersion);
      git(dir, 'reset', '--', 'package.json'); // por si `tagRepos` alcanzó a stagearlo antes de fallar
    }
    if (changelogBackup) {
      git(BACK_DIR, 'reset', '--', 'CHANGELOG.md');
      if (changelogBackup.existed) writeFileSync(changelogPath, changelogBackup.content);
      else if (existsSync(changelogPath)) unlinkSync(changelogPath);
    }
    console.log('\n  Se revirtió el release parcial (versión, changelog y staging): el release no llegó a completarse.');
  } catch {
    console.error(
      '\n  No se pudo revertir el release parcial. Revisá `git status` y `git diff` en ambos repos antes de reintentar.'
    );
  }
});

/** Los pasos que escriben algo se saltean en dry-run, pero se anuncian igual. */
function mutate(description, fn) {
  if (DRY) {
    log.info(`(dry-run) ${description}`);
    return null;
  }
  return fn();
}

// ───────────────────────────── 1. estado de los repos ─────────────────────────

/**
 * Archivos con una diferencia de CONTENIDO real, sin commitear (staged o no).
 *
 * `git status --porcelain` no alcanza acá: en esta máquina (`core.autocrlf`)
 * marca un archivo como modificado por pura renormalización de fin de línea
 * aunque el contenido sea idéntico — pasó de verdad con el package.json del
 * frontend y bloqueó un release que no tenía nada real sin commitear. `git
 * diff --name-only` ya compara post-normalización, así que sólo lista lo que
 * cambió de verdad.
 */
export function filesWithRealChanges(dir) {
  const unstaged = git(dir, 'diff', '--name-only').split('\n').filter(Boolean);
  const staged = git(dir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
  return [...new Set([...unstaged, ...staged])];
}

function checkRepos() {
  log.step('Verificando el estado de los repos');
  assertReposExist();

  const problems = [];

  for (const repo of REPOS) {
    const branch = currentBranch(repo.dir);
    if (branch !== EXPECTED_BRANCH) {
      problems.push(`${repo.name} está en "${branch}" y no en "${EXPECTED_BRANCH}"`);
    }

    const untracked = git(repo.dir, 'status', '--porcelain')
      .split('\n')
      .filter((l) => l.startsWith('??'));
    const changed = filesWithRealChanges(repo.dir);

    if (changed.length && !flags['allow-dirty']) {
      problems.push(`${repo.name} tiene ${changed.length} cambio(s) sin commitear (${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ', ...' : ''})`);
    }
    if (untracked.length) {
      log.warn(`${repo.name}: ${untracked.length} archivo(s) sin trackear (no entran al release)`);
      untracked.slice(0, 5).forEach((l) => log.info(l.replace(/^\?\?\s*/, '  ')));
    }

    // Estar detrás de origin significa tagear una versión incompleta.
    try {
      git(repo.dir, 'fetch', 'origin', branch, '--quiet');
      const behind = git(repo.dir, 'rev-list', '--count', `HEAD..origin/${branch}`);
      const ahead = git(repo.dir, 'rev-list', '--count', `origin/${branch}..HEAD`);
      if (Number(behind) > 0) {
        problems.push(`${repo.name} está ${behind} commit(s) detrás de origin/${branch} — hacé pull antes`);
      }
      if (Number(ahead) > 0) {
        log.info(`${repo.name}: ${ahead} commit(s) locales sin pushear (se pushean en el deploy)`);
      }
    } catch {
      log.warn(`${repo.name}: no se pudo consultar origin/${branch} (¿sin conexión?) — se sigue sin ese chequeo`);
    }

    log.ok(`${repo.name} @ ${branch} (${shortSha(repo.dir)})`);
  }

  if (problems.length) {
    log.plain('');
    problems.forEach((p) => log.fail(p));
    abort(
      'Los repos no están listos para un release',
      'Resolvé lo de arriba. Si sabés lo que hacés: --allow-dirty y/o --branch=<rama>.'
    );
  }
}

// ───────────────────────────── 2. validaciones ────────────────────────────────

/**
 * Corre las validaciones obligatorias. Lanza en vez de abortar: el llamador
 * necesita poder deshacer el bump de versión antes de cortar.
 */
function runValidations() {
  if (flags['skip-tests']) {
    log.step('Validaciones OMITIDAS por --skip-tests');
    log.warn('Estás por tagear una versión que nadie verificó.');
    return;
  }

  log.step('Validando backend (typecheck + tests)');
  if (!runLive('npm', ['run', 'typecheck'], { cwd: BACK_DIR })) {
    throw new Error('El typecheck del backend falló. Arreglá los errores de tipos antes de releasear.');
  }
  log.ok('typecheck backend');

  if (!runLive('npm', ['run', 'test:full'], { cwd: BACK_DIR })) {
    throw new Error(
      'Los tests del backend fallaron. Necesitan MySQL corriendo y los seeds aplicados; si la base local no está levantada, ese es el motivo.'
    );
  }
  log.ok('tests backend');

  log.step('Validando frontend (tests + build)');
  if (!runLive('npm', ['test'], { cwd: FRONT_DIR })) {
    throw new Error('Los tests del frontend fallaron.');
  }
  log.ok('tests frontend');

  // `npm run build` incluye `tsc -b`, o sea que también hace de typecheck.
  // El lint queda fuera a propósito: hay 162 errores preexistentes conocidos
  // (ver 09-CURRENT-STATUS.md), así que bloquear por lint haría el release
  // imposible sin arreglar deuda que no es parte de este cambio.
  if (!runLive('npm', ['run', 'build'], { cwd: FRONT_DIR })) {
    throw new Error('El build del frontend falló.');
  }
  log.ok('build frontend');

  if (!runLive('npm', ['run', 'prerender'], { cwd: FRONT_DIR })) {
    throw new Error('El prerender del frontend falló.');
  }
  log.ok('prerender frontend');
}

// ───────────────────────────── 3. notas del release ───────────────────────────

/** Cuántos commits listar en el primer release, donde no hay tag previo que acote. */
const FIRST_RELEASE_LOG_LIMIT = 15;

/** Commits de un repo desde el tag anterior, ya filtrados de ruido de merge. */
function commitsSince(dir, sinceTag) {
  const hasPrevious = sinceTag && listVersionTags(dir).includes(sinceTag);
  const args = ['log', '--no-merges', '--pretty=format:%s'];
  if (hasPrevious) {
    args.splice(1, 0, `${sinceTag}..HEAD`);
  } else {
    // Sin tag anterior el rango sería la historia entera del repo; se recorta
    // para que el CHANGELOG del primer release sea legible en vez de un volcado.
    args.push(`-${FIRST_RELEASE_LOG_LIMIT}`);
  }
  const commits = git(dir, ...args).split('\n').filter(Boolean);
  if (!hasPrevious) commits.push(`_(primer release: sólo se listan los últimos ${FIRST_RELEASE_LOG_LIMIT} commits)_`);
  return commits;
}

export function buildChangelogEntry(version, previous) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`## ${version} — ${date}`, ''];

  for (const repo of REPOS) {
    const commits = commitsSince(repo.dir, previous);
    lines.push(`### ${repo.name} (${shortSha(repo.dir)})`);
    lines.push('');
    if (commits.length) {
      commits.forEach((msg) => lines.push(`- ${msg}`));
    } else {
      lines.push('- sin cambios desde el release anterior');
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function updateChangelog(entry) {
  const file = path.join(BACK_DIR, 'CHANGELOG.md');
  const header = [
    '# Changelog',
    '',
    'Releases coordinados de `backIndians` + `frontIndians`. Generado por `npm run release`.',
    'Cada versión corresponde a un tag `vX.Y.Z` presente en **ambos** repos.',
    '',
  ].join('\n');

  const existed = existsSync(file);
  const original = existed ? readFileSync(file, 'utf8') : null;
  // Se registra ANTES de escribir: es lo que el handler de 'exit' usa para
  // devolver el archivo a su estado real si el release no llega a completarse.
  if (changelogBackup === null) changelogBackup = { existed, content: original };

  const previous = existed ? original.replace(header, '').trimStart() : '';
  writeFileSync(file, `${header}\n${entry}\n${previous}`.trimEnd() + '\n');
}

// ───────────────────────────── 4. tag y snapshot ──────────────────────────────

function tagRepos(version) {
  for (const repo of REPOS) {
    mutate(`commit + tag ${version} en ${repo.name}`, () => {
      git(repo.dir, 'add', '--', 'package.json');
      if (repo.dir === BACK_DIR) git(repo.dir, 'add', '--', 'CHANGELOG.md');

      // Si no cambió nada versionado (raro pero posible con --allow-dirty),
      // `git commit` fallaría; en ese caso el tag va sobre el HEAD actual.
      const staged = git(repo.dir, 'diff', '--cached', '--name-only');
      if (staged) {
        git(repo.dir, 'commit', '-m', `chore(release): ${version}`);
      }

      git(repo.dir, 'tag', '-a', version, '-m', `Release ${version}`);
      log.ok(`${repo.name}: tag ${version} sobre ${shortSha(repo.dir)}`);
    });
  }
}

/**
 * Guarda el `dist/` recién validado para poder re-subirlo tal cual.
 *
 * Es lo que hace posible un rollback de frontend en segundos: sin snapshot hay
 * que hacer checkout del tag viejo, reinstalar dependencias y rebuildear, con el
 * sitio roto mientras tanto.
 */
function snapshotFrontend(version) {
  const dist = path.join(FRONT_DIR, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    log.warn('No hay dist/ para snapshotear (¿corriste con --skip-tests?)');
    return;
  }
  const target = path.join(FRONT_SNAPSHOT_DIR, version);
  mutate(`snapshot del frontend en .releases/${version}/`, () => {
    ensureDir(FRONT_SNAPSHOT_DIR);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    cpSync(dist, target, { recursive: true });
    log.ok(`Snapshot del frontend guardado (${version})`);
  });
}

// ───────────────────────────── 5. instrucciones finales ───────────────────────

function printDeployInstructions(version, previous) {
  const rel = (p) => path.relative(path.dirname(BACK_DIR), p).replace(/\\/g, '/');

  log.plain(`\n${c.green(c.bold(`Release ${version} preparado.`))}`);
  log.plain(`${c.dim('Nada se deployó todavía. Los pasos de abajo son los que tocan producción.')}\n`);

  log.plain(c.bold('1) Backend (Railway deploya solo al recibir el push)'));
  log.plain(`   cd ${rel(BACK_DIR)}`);
  log.plain(`   git push origin ${EXPECTED_BRANCH} && git push origin ${version}`);
  log.plain(`   ${c.dim('Seguí el deploy en Railway; corre `npm run migrate` antes de arrancar.')}`);

  log.plain(`\n${c.bold('2) Verificar que el backend levantó bien')}`);
  log.plain(`   npm run release:status`);
  log.plain(`   ${c.dim(`el health de producción debe reportar version "${version.replace(/^v/, '')}"`)}`);

  log.plain(`\n${c.bold('3) Frontend (sube el build exacto que se validó recién)')}`);
  log.plain(`   cd ${rel(FRONT_DIR)}`);
  log.plain(`   git push origin ${EXPECTED_BRANCH} && git push origin ${version}`);
  log.plain(`   npm run deploy:release -- ${version}`);

  log.plain(`\n${c.bold('4) Humo en producción')}`);
  log.plain('   - https://sistema.indians.com.ar/login  (entrar con un usuario real)');
  log.plain('   - https://indians.com.ar               (la tienda lista productos)');
  log.plain('   - un pedido de prueba end-to-end si el release toca checkout');

  log.plain(`\n${c.yellow(c.bold('Si algo sale mal:'))}`);
  log.plain(`   npm run rollback${previous ? ` -- ${previous}` : ''}`);
  log.plain(`   ${c.dim('te guía paso a paso para volver' + (previous ? ` a ${previous}` : ' a la versión anterior'))}`);
}

// ───────────────────────────── main ───────────────────────────────────────────

async function main() {
  log.plain(c.bold('\n=== Release Indians ==='));
  if (DRY) log.warn('Modo --dry-run: no se escribe nada, no se tagea, no se hace backup.');

  checkRepos();

  const previous = currentVersion();
  const version = resolveTargetVersion(positional[0], previous);

  if (REPOS.some((r) => listVersionTags(r.dir).includes(version))) {
    abort(`El tag ${version} ya existe en alguno de los repos`, 'Elegí otra versión o borrá el tag si fue un error.');
  }

  log.step('Versión');
  log.info(`anterior : ${previous ?? '(ninguna — este es el primer release)'}`);
  log.info(`nueva    : ${c.bold(version)}`);

  const entry = buildChangelogEntry(version, previous);
  log.plain('\n' + c.dim(entry.split('\n').slice(0, 40).join('\n')));

  if (!DRY) {
    // --yes es para invocación no interactiva deliberada (ej. un agente
    // corriendo esto en nombre de alguien que ya vio y aprobó el changelog de
    // arriba). Sin el flag, confirm() sigue exigiendo una terminal real: no hay
    // forma de auto-confirmar por accidente vía pipe o script.
    const ok = flags.yes ? true : await confirm(`¿Preparar el release ${c.bold(version)}?`);
    if (flags.yes) log.info('Confirmado por --yes (invocación no interactiva).');
    if (!ok) {
      log.fail('Cancelado.');
      process.exit(1);
    }
  }

  // El bump va ANTES de validar, no después: el build del frontend escribe la
  // versión del package.json dentro de `dist/version.json`. Bumpeando después,
  // el snapshot que se publica diría la versión anterior y `release:status`
  // reportaría para siempre que el deploy no llegó.
  log.step('Marcando la versión en ambos repos');
  mutate('bump de package.json en ambos repos', () => {
    for (const repo of REPOS) {
      // Se registra la versión previa antes de tocar nada: es lo que permite
      // deshacer el bump si el release se corta más adelante (handler de 'exit').
      versionsBeforeBump.set(repo.dir, getPackageVersion(repo.dir));
      setPackageVersion(repo.dir, version);
    }
  });

  try {
    runValidations();
  } catch (err) {
    abort(err.message);
  }

  if (!flags['skip-backup']) {
    log.step('Backup de la base de producción');
    if (DRY) {
      log.info('(dry-run) se saltea el backup');
    } else {
      await backupDatabase({ tag: version });
    }
  } else {
    log.step('Backup OMITIDO por --skip-backup');
    log.warn('Sin backup no hay vuelta atrás para cambios de datos o migraciones sin `down`.');
  }

  log.step('Tageando');
  mutate('actualizar CHANGELOG.md', () => updateChangelog(entry));
  tagRepos(version);
  releaseCompleted = true; // el tag ya existe: el bump quedó respaldado por un commit
  snapshotFrontend(version);

  if (DRY) {
    log.plain(`\n${c.yellow('Dry-run terminado. Nada fue modificado.')}`);
    return;
  }

  printDeployInstructions(version, previous);
}

// Sólo corre el release cuando se invoca el script directamente. Importarlo
// (para verificar sus piezas por separado) no debe disparar un release.
// `process.argv[1]` no existe en todos los contextos (REPL, `node -e`), y
// pathToFileURL(undefined) lanza: sin la guarda, importar este modulo desde
// uno de esos contextos revienta antes de exportar nada.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((err) => abort(err.message));
}
