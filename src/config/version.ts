import fs from 'fs';
import path from 'path';

/**
 * Versión y commit del build que está corriendo.
 *
 * Por qué existe: sin esto no hay forma de saber qué versión está realmente en
 * producción salvo confiar en la memoria de quien deployó. Cuando un deploy sale
 * a medias (backend actualizado, frontend no) o un rollback no llega a aplicarse,
 * este dato es lo que lo delata. Lo consume `/health` y `npm run release:status`.
 *
 * La versión sale del `package.json`, que `npm run release` mantiene sincronizado
 * con el tag `vX.Y.Z` de los dos repos.
 */

function readPackageVersion(): string {
  try {
    // __dirname es `src/config` con ts-node y `dist/config` compilado: en ambos
    // casos el package.json está dos niveles más arriba.
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    // Un problema leyendo el package.json no puede tumbar el health check.
    return '0.0.0';
  }
}

export const APP_VERSION = readPackageVersion();

/** SHA corto del commit desplegado. Railway lo inyecta solo en cada deploy. */
export const APP_COMMIT =
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.APP_COMMIT?.slice(0, 7) ?? null;
