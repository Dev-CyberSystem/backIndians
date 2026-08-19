// Qué versión está realmente corriendo en producción, comparada con lo local.
//
// Por qué: sin esto, "qué hay en producción" se responde de memoria. Después de
// un deploy a medias (backend pusheado, frontend no) los dos lados quedan en
// versiones distintas y nadie se entera hasta que algo falla raro.
//
// Uso: npm run release:status
//       npm run prod            (alias corto para uso diario)
//
// Configurá en `backIndians/.env.release`:
//   RELEASE_API_URL    https://<backend>/health          (o BACKEND_PUBLIC_URL)
//   RELEASE_STORE_URL  https://indians.com.ar
//   RELEASE_SYSTEM_URL https://sistema.indians.com.ar

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BACKUP_DIR,
  BACK_DIR,
  FRONT_DIR,
  FRONT_SNAPSHOT_DIR,
  REPOS,
  abort,
  c,
  currentBranch,
  currentVersion,
  getPackageVersion,
  isClean,
  listVersionTags,
  loadReleaseEnv,
  log,
  parseVersion,
  shortSha,
} from './lib.mjs';

const TIMEOUT_MS = 10_000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* respuesta no-JSON: se reporta el status igual */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, error: err.name === 'AbortError' ? `sin respuesta en ${TIMEOUT_MS / 1000}s` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHealthUrl(raw) {
  if (!raw) return null;
  const base = raw.replace(/\/+$/, '');
  return base.endsWith('/health') ? base : `${base}/health`;
}

async function checkBackend() {
  const url = normalizeHealthUrl(process.env.RELEASE_API_URL || process.env.BACKEND_PUBLIC_URL);
  log.step('Backend en producción');

  if (!url) {
    log.warn('No hay RELEASE_API_URL configurada — no se puede consultar.');
    log.info('Agregá RELEASE_API_URL=https://<tu-backend>/health a backIndians/.env.release');
    return null;
  }

  log.info(url);
  const res = await fetchJson(url);

  if (!res.ok) {
    log.fail(res.status ? `HTTP ${res.status}` : `no responde (${res.error})`);
    if (res.status === 503) log.fail('503 = el proceso vive pero la BASE no responde. Mirá Railway y MySQL.');
    return null;
  }

  const data = res.body?.data ?? {};
  log.ok(`status ${data.status ?? 'ok'} · base ${data.database ?? '?'} · uptime ${data.uptime_seconds ?? '?'}s`);
  if (data.version) {
    log.ok(`versión desplegada: ${c.bold('v' + String(data.version).replace(/^v/, ''))}${data.commit ? c.dim(` (${data.commit})`) : ''}`);
  } else {
    log.warn('El backend no reporta versión — está corriendo un build anterior a este sistema de releases.');
  }

  // Estado del secreto del webhook de MercadoPago (nunca el valor). Sin él, MP
  // no acredita pagos por webhook y todo cae en el job de conciliación, con
  // hasta ~10 min de demora y sin ningún aviso. Es el dato que hacía falta
  // mirar en los logs de Railway y que ahora se ve acá.
  if (data.webhook_secret === true) {
    log.ok('MP_WEBHOOK_SECRET cargado en el proceso.');
  } else if (data.webhook_secret === false) {
    log.fail('MP_WEBHOOK_SECRET NO está cargado — los webhooks de MercadoPago se rechazan.');
    log.info('Los pagos sólo se acreditan por el job de conciliación (hasta ~10 min).');
  } else {
    log.warn('El backend no reporta webhook_secret — build anterior a esta verificación.');
  }
  return data.version
    ? { version: `v${String(data.version).replace(/^v/, '')}`, commit: data.commit ? String(data.commit) : null }
    : null;
}

async function checkFrontend() {
  const sites = [
    ['sistema', process.env.RELEASE_SYSTEM_URL],
    ['tienda', process.env.RELEASE_STORE_URL],
  ].filter(([, url]) => url);

  log.step('Frontend en producción');
  if (!sites.length) {
    log.warn('No hay RELEASE_SYSTEM_URL / RELEASE_STORE_URL configuradas.');
    return { configured: 0, versions: [] };
  }

  const versions = [];
  for (const [label, base] of sites) {
    const url = `${base.replace(/\/+$/, '')}/version.json`;
    const res = await fetchJson(url);

    if (res.ok && res.body?.version) {
      const deployed = `v${String(res.body.version).replace(/^v/, '')}`;
      versions.push({ label, version: deployed, commit: res.body.commit ? String(res.body.commit) : null });
      log.ok(`${label}: ${c.bold(deployed)}${res.body.commit ? c.dim(` (${res.body.commit})`) : ''}`);
    } else if (res.status === 404 || (res.ok && !res.body)) {
      // El .htaccess manda todo lo que no existe al index.html de la SPA, así
      // que un version.json ausente llega como 200 con HTML, no como 404. Los
      // dos casos significan lo mismo: ese build es anterior a este sistema.
      log.warn(`${label}: sin version.json — build anterior a este sistema de releases`);
    } else if (res.ok) {
      log.warn(`${label}: version.json sin campo "version" — build incompleto`);
    } else {
      log.fail(`${label}: ${res.status ? `HTTP ${res.status}` : res.error}`);
    }
  }
  return { configured: sites.length, versions };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Devuelve la release común más nueva que sea anterior a TODO lo desplegado.
 * Si hubo un deploy a medias, esto evita sugerir como rollback una versión que
 * todavía está corriendo en uno de los componentes.
 */
export function findRollbackTarget(productionVersions, backTags, frontTags) {
  if (!productionVersions.length || productionVersions.some((version) => !parseVersion(version))) return null;

  const frontSet = new Set(frontTags);
  return backTags
    .filter((tag) => frontSet.has(tag))
    .filter((tag) => productionVersions.every((deployed) => compareVersions(tag, deployed) < 0))
    .at(-1) ?? null;
}

function hasFrontendSnapshot(version) {
  return existsSync(path.join(FRONT_SNAPSHOT_DIR, version, 'index.html'));
}

function hasPreReleaseBackup(version) {
  if (!version || !existsSync(BACKUP_DIR)) return false;
  return readdirSync(BACKUP_DIR).some((name) => name.startsWith(`${version}-`) && name.endsWith('.sql.gz'));
}

function expectedFrontendCommit(version) {
  const versionFile = path.join(FRONT_SNAPSHOT_DIR, version, 'version.json');
  if (!existsSync(versionFile)) return null;
  try {
    return JSON.parse(readFileSync(versionFile, 'utf8')).commit ?? null;
  } catch {
    return null;
  }
}

/**
 * La versión semántica sola no alcanza: un push posterior al tag conserva
 * package.json y puede seguir declarando v1.0.0 aunque ejecute otro código.
 */
function checkCommitDrift(backend, frontend) {
  let drift = false;

  if (backend?.commit && listVersionTags(BACK_DIR).includes(backend.version)) {
    const expected = shortSha(BACK_DIR, `${backend.version}^{}`);
    if (backend.commit !== expected) {
      drift = true;
      log.fail(`Backend declara ${backend.version}, pero corre ${backend.commit}; el tag apunta a ${expected}.`);
      log.info('Hay código desplegado fuera del release versionado. Prepará una release nueva para volver a alinear.');
    } else {
      log.ok(`Backend: commit ${backend.commit} corresponde al tag ${backend.version}.`);
    }
  } else if (backend && !backend.commit) {
    log.warn('Backend: informa versión pero no commit; no se puede verificar el código exacto.');
  }

  for (const site of frontend.versions) {
    const expected = expectedFrontendCommit(site.version);
    if (site.commit && expected && site.commit !== expected) {
      drift = true;
      log.fail(`Frontend ${site.label} declara ${site.version}, pero corre ${site.commit}; el snapshot validado es ${expected}.`);
    } else if (site.commit && expected) {
      log.ok(`Frontend ${site.label}: commit ${site.commit} corresponde al snapshot ${site.version}.`);
    } else if (!site.commit) {
      log.warn(`Frontend ${site.label}: informa versión pero no commit; no se puede verificar el build exacto.`);
    } else {
      log.warn(`Frontend ${site.label}: no hay snapshot local para contrastar el commit ${site.commit}.`);
    }
  }

  return drift;
}

function printRollback(backend, frontend) {
  log.step('Rollback');

  const frontVersions = frontend.versions.map(({ version }) => version);
  const hasFullVisibility = Boolean(backend?.version)
    && frontend.configured > 0
    && frontend.versions.length === frontend.configured;

  if (!hasFullVisibility) {
    log.warn('No se puede calcular un rollback seguro: falta la versión de algún componente de producción.');
    log.info('Corregí la conectividad/configuración indicada arriba y volvé a ejecutar `npm run prod`.');
    return;
  }

  const productionVersions = [backend.version, ...frontVersions];
  const target = findRollbackTarget(
    productionVersions,
    listVersionTags(BACK_DIR),
    listVersionTags(FRONT_DIR)
  );

  if (!target) {
    log.warn('No hay una release anterior común y versionada a la cual volver.');
    log.info('La versión productiva es la primera release registrada; un rollback requeriría intervención manual.');
    return;
  }

  log.ok(`objetivo seguro común: ${c.bold(target)}`);
  if (hasFrontendSnapshot(target)) {
    log.ok(`frontend: snapshot local ${target} disponible`);
  } else {
    log.warn(`frontend: no hay snapshot local ${target}; requiere rebuild desde el tag`);
  }
  log.ok('backend: el tag existe en ambos repos; Railway puede redeployar el deployment anterior');

  const uniqueProductionVersions = [...new Set(productionVersions)];
  if (uniqueProductionVersions.length === 1 && hasPreReleaseBackup(uniqueProductionVersions[0])) {
    log.ok(`base: existe backup previo al release ${uniqueProductionVersions[0]} (sólo usar ante daño de datos)`);
  } else if (uniqueProductionVersions.length === 1) {
    log.warn(`base: no se encontró backup previo al release ${uniqueProductionVersions[0]} en esta máquina`);
  } else {
    log.warn('base: producción está desalineada; revisar migraciones antes de considerar un restore');
  }

  log.plain(`\n  ${c.bold(`Comando: npm run rollback -- ${target} --from=${backend.version}`)}`);
  log.info('Ese comando confirma el frontend y guía backend/base; no restaura datos automáticamente.');
}

function checkLocal() {
  log.step('Estado local');
  for (const repo of REPOS) {
    const dirty = isClean(repo.dir) ? '' : c.yellow(' · con cambios sin commitear');
    log.plain(
      `  ${c.bold(repo.name.padEnd(14))} ${currentBranch(repo.dir).padEnd(24)} ${shortSha(repo.dir)}  pkg ${getPackageVersion(repo.dir)}${dirty}`
    );
  }

  const tags = listVersionTags(BACK_DIR);
  const last = currentVersion();
  log.info(`último tag: ${last ?? '(ninguno)'} · ${tags.length} release(s) en la historia`);

  // Un tag que existe en un repo y no en el otro es un release a medio terminar.
  const backTags = new Set(listVersionTags(BACK_DIR));
  const frontTags = new Set(listVersionTags(FRONT_DIR));
  const desync = [...new Set([...backTags, ...frontTags])].filter((t) => !backTags.has(t) || !frontTags.has(t));
  if (desync.length) {
    log.warn(`Tags presentes en un solo repo: ${desync.join(', ')} — release incompleto.`);
  }
  return last;
}

async function main() {
  loadReleaseEnv();
  log.plain(c.bold('\n=== Estado de producción ==='));

  const local = checkLocal();
  const backend = await checkBackend();
  const frontend = await checkFrontend();
  const frontVersions = frontend.versions.map(({ version }) => version);
  const uniqueFrontVersions = [...new Set(frontVersions)];

  log.step('Resumen');
  if (uniqueFrontVersions.length > 1) {
    log.fail(`Los frontends están en versiones DISTINTAS: ${frontend.versions.map(({ label, version }) => `${label}=${version}`).join(', ')}.`);
  }

  if (backend && uniqueFrontVersions.length === 1 && backend.version !== uniqueFrontVersions[0]) {
    log.fail(`Backend (${backend.version}) y frontend (${uniqueFrontVersions[0]}) están en versiones DISTINTAS.`);
    log.info('Suele ser un deploy a medias: se pusheó uno y no se subió el otro.');
  } else if (backend && uniqueFrontVersions.length === 1) {
    log.ok(`Producción declara ${c.bold(backend.version)} en backend y frontend.`);
  }

  const hasCommitDrift = checkCommitDrift(backend, frontend);

  if (local && backend && local !== backend.version) {
    log.warn(`El último tag local es ${local} pero producción declara ${backend.version} — hay un release sin deployar.`);
  } else if (local && backend && local === backend.version && !hasCommitDrift) {
    log.ok('La release tageada localmente es exactamente la que está en producción.');
  }

  printRollback(backend, frontend);
}

// Sólo corre contra producción cuando se invoca directo. Importar el módulo
// (por ejemplo para probar findRollbackTarget de forma aislada) no debe pegarle
// a la red — ver la misma guarda en release.mjs y db-backup.mjs.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((err) => abort(err.message));
}
