// Utilidades compartidas por los scripts de release, rollback y backup.
//
// Por qué vive en backIndians: la raíz `indians/` no es un repo git, así que
// nada versionable puede quedar ahí. Estos scripts coordinan LOS DOS repos
// (backIndians y frontIndians), pero tienen que vivir en uno; se eligió el
// backend por consistencia con el cerebro documental.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raíz de backIndians (scripts/release/ -> ../..) */
export const BACK_DIR = path.resolve(__dirname, '..', '..');
/** Raíz de frontIndians, hermana de backIndians dentro de `indians/` */
export const FRONT_DIR = path.resolve(BACK_DIR, '..', 'frontIndians');
/** Carpeta de backups de base. Fuera de git: contiene datos reales de producción. */
export const BACKUP_DIR = path.join(BACK_DIR, '.releases', 'db');
/** Snapshots del `dist/` del frontend por versión, para rollback sin rebuild. */
export const FRONT_SNAPSHOT_DIR = path.join(FRONT_DIR, '.releases');

// ─────────────────────────────── salida por consola ───────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  blue: (s) => paint('36', s),
};

export const log = {
  step: (msg) => console.log(`\n${c.blue('>')} ${c.bold(msg)}`),
  ok: (msg) => console.log(`  ${c.green('OK')} ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow('!!')} ${msg}`),
  fail: (msg) => console.log(`  ${c.red('XX')} ${msg}`),
  info: (msg) => console.log(`  ${c.dim(msg)}`),
  plain: (msg = '') => console.log(msg),
};

/** Corta la ejecución con un mensaje de error legible (sin stack trace ruidoso). */
export function abort(msg, hint) {
  console.error(`\n${c.red('XX ' + msg)}`);
  if (hint) console.error(`  ${c.dim(hint)}`);
  process.exit(1);
}

// ─────────────────────────────── ejecución de comandos ────────────────────────

/**
 * Corre un comando y devuelve su salida. Lanza si falla, salvo `allowFail`.
 *
 * `shell:true` en Windows hace falta para `npm`, que resuelve a `npm.cmd`
 * (spawnSync no puede ejecutar un .cmd directamente). Pero pasar por cmd.exe
 * tiene un costo: cmd.exe trata `()^&|<>%` como metacaracteres incluso dentro
 * de argumentos ya citados, así que un mensaje de commit con paréntesis —como
 * "chore(release): v1.0.0"— se parte en dos argumentos y rompe el comando.
 * `git.exe` es un ejecutable real (no un .cmd), así que no necesita shell y
 * `git()` fuerza `shell:false` explícitamente para esquivar ese problema.
 */
export function run(cmd, args, { cwd, allowFail = false, silent = true, env, shell } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: shell ?? process.platform === 'win32',
    stdio: silent ? 'pipe' : 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  });
  const stdout = (res.stdout || '').trim();
  const stderr = (res.stderr || '').trim();
  if (res.status !== 0 && !allowFail) {
    const detail = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`Falló ${cmd} ${args.join(' ')} (código ${res.status})\n${detail}`);
  }
  return { code: res.status ?? 1, stdout, stderr };
}

/** Corre un comando mostrando su salida en vivo. Devuelve true si salió 0. */
export function runLive(cmd, args, { cwd, env, shell } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    shell: shell ?? process.platform === 'win32',
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  });
  return res.status === 0;
}

/** Atajo para comandos git sobre un repo concreto. Sin shell: ver nota de arriba. */
export const git = (cwd, ...args) => run('git', args, { cwd, shell: false }).stdout;

// ─────────────────────────────── estado de los repos ──────────────────────────

export const REPOS = [
  { name: 'backIndians', dir: BACK_DIR },
  { name: 'frontIndians', dir: FRONT_DIR },
];

export function assertReposExist() {
  for (const repo of REPOS) {
    if (!existsSync(path.join(repo.dir, '.git'))) {
      abort(
        `No encuentro el repo ${repo.name} en ${repo.dir}`,
        'Los scripts de release asumen que backIndians/ y frontIndians/ son hermanos dentro de indians/.'
      );
    }
  }
}

/** true si el working tree no tiene cambios (ni staged, ni sin trackear). */
export function isClean(dir) {
  return git(dir, 'status', '--porcelain') === '';
}

export function currentBranch(dir) {
  return git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
}

export function shortSha(dir, ref = 'HEAD') {
  return git(dir, 'rev-parse', '--short', ref);
}

// ─────────────────────────────── versiones y tags ─────────────────────────────

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(tag) {
  const m = VERSION_RE.exec(tag);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

export const formatVersion = (v) => `v${v.major}.${v.minor}.${v.patch}`;

/** Ordena tags de versión de más viejo a más nuevo. */
export function sortVersions(tags) {
  return tags
    .map((t) => ({ tag: t, v: parseVersion(t) }))
    .filter((x) => x.v)
    .sort((a, b) => a.v.major - b.v.major || a.v.minor - b.v.minor || a.v.patch - b.v.patch)
    .map((x) => x.tag);
}

export function listVersionTags(dir) {
  return sortVersions(git(dir, 'tag', '--list', 'v*').split('\n').filter(Boolean));
}

/**
 * Última versión publicada. Al versionar coordinado, la "actual" es la más alta
 * que exista en CUALQUIERA de los dos repos: si un release quedó a medias con el
 * tag puesto sólo en el backend, la siguiente versión igual tiene que superarlo
 * para no reusar un número.
 */
export function currentVersion() {
  const all = REPOS.flatMap((r) => listVersionTags(r.dir));
  const sorted = sortVersions(all);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

export function bump(version, kind) {
  const v = parseVersion(version) ?? { major: 0, minor: 0, patch: 0 };
  if (kind === 'major') return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
  if (kind === 'minor') return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0 });
  return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1 });
}

/**
 * Primer release. No es v0.0.1: el sistema ya está en producción con usuarios
 * reales, así que arrancar por debajo de 1.0.0 sugeriría lo contrario.
 */
export const FIRST_VERSION = 'v1.0.0';

/** Acepta "patch"/"minor"/"major" o una versión explícita ("v1.4.0" / "1.4.0"). */
export function resolveTargetVersion(arg, current) {
  if (!arg || ['patch', 'minor', 'major'].includes(arg)) {
    if (!current) return FIRST_VERSION;
    return bump(current, arg || 'patch');
  }
  const normalized = arg.startsWith('v') ? arg : `v${arg}`;
  if (!parseVersion(normalized)) {
    abort(`Versión inválida: "${arg}"`, 'Usá patch | minor | major, o un semver explícito como 1.4.0');
  }
  return normalized;
}

// ─────────────────────────────── package.json ─────────────────────────────────

/** Escribe `version` en un package.json preservando el formato (2 espacios + salto final). */
export function setPackageVersion(dir, version) {
  const file = path.join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = version.replace(/^v/, '');
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

export function getPackageVersion(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
}

// ─────────────────────────────── entorno de release ───────────────────────────

/**
 * Carga `.env.release` (credenciales de producción para backup/restore) sin
 * pisar variables ya presentes en el entorno. No se commitea: ver .gitignore.
 */
export function loadReleaseEnv() {
  const file = path.join(BACK_DIR, '.env.release');
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return true;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────── interacción ──────────────────────────────────

/**
 * Pregunta por consola. En modo no interactivo (CI, pipe) NO asume que sí:
 * un release o un restore que se auto-confirma es exactamente el accidente que
 * estos scripts existen para evitar.
 */
export async function confirm(question, { expect } = {}) {
  if (!process.stdin.isTTY) {
    abort(
      'Se necesita confirmación pero la consola no es interactiva.',
      'Corré el comando en una terminal normal (no por pipe ni en background).'
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = expect ? ` (escribí ${c.bold(expect)} para confirmar) ` : ' [s/N] ';
  const answer = await new Promise((resolve) => rl.question(`\n${question}${suffix}`, resolve));
  rl.close();
  const trimmed = answer.trim();
  if (expect) return trimmed === expect;
  return /^(s|si|sí|y|yes)$/i.test(trimmed);
}

/** Parseo mínimo de flags: --flag y --clave=valor. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/** Timestamp local legible y ordenable, apto para nombres de archivo. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
