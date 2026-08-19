// Qué versión está realmente corriendo en producción, comparada con lo local.
//
// Por qué: sin esto, "qué hay en producción" se responde de memoria. Después de
// un deploy a medias (backend pusheado, frontend no) los dos lados quedan en
// versiones distintas y nadie se entera hasta que algo falla raro.
//
// Uso: npm run release:status
//
// Configurá en `backIndians/.env.release`:
//   RELEASE_API_URL    https://<backend>/health          (o BACKEND_PUBLIC_URL)
//   RELEASE_STORE_URL  https://indians.com.ar
//   RELEASE_SYSTEM_URL https://sistema.indians.com.ar

import {
  BACK_DIR,
  FRONT_DIR,
  REPOS,
  abort,
  c,
  currentBranch,
  currentVersion,
  getPackageVersion,
  git,
  isClean,
  listVersionTags,
  loadReleaseEnv,
  log,
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
  return data.version ? `v${String(data.version).replace(/^v/, '')}` : null;
}

async function checkFrontend() {
  const sites = [
    ['sistema', process.env.RELEASE_SYSTEM_URL],
    ['tienda', process.env.RELEASE_STORE_URL],
  ].filter(([, url]) => url);

  log.step('Frontend en producción');
  if (!sites.length) {
    log.warn('No hay RELEASE_SYSTEM_URL / RELEASE_STORE_URL configuradas.');
    return null;
  }

  let deployed = null;
  for (const [label, base] of sites) {
    const url = `${base.replace(/\/+$/, '')}/version.json`;
    const res = await fetchJson(url);

    if (res.ok && res.body?.version) {
      deployed = `v${String(res.body.version).replace(/^v/, '')}`;
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
  return deployed;
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

  log.step('Resumen');
  if (backend && frontend && backend !== frontend) {
    log.fail(`Backend (${backend}) y frontend (${frontend}) están en versiones DISTINTAS.`);
    log.info('Suele ser un deploy a medias: se pusheó uno y no se subió el otro.');
  } else if (backend && frontend) {
    log.ok(`Producción está en ${c.bold(backend)}, backend y frontend coinciden.`);
  }

  if (local && backend && local !== backend) {
    log.warn(`El último tag local es ${local} pero producción corre ${backend} — hay un release sin deployar.`);
  } else if (local && backend && local === backend) {
    log.ok('Lo tageado localmente es lo que está en producción.');
  }
}

main().catch((err) => abort(err.message));
