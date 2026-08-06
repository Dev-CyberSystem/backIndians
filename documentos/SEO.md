# SEO técnico — Tienda online Indians

Fecha: 2026-07-02 · Alcance: **SEO técnico + on-page + indexación de la tienda
pública** (`indians.com.ar/tienda`). No se tocó el sistema de gestión ni el
checkout/pagos. Stack: **SPA Vite + React 19 + React Router**, hosteada estática
en Donweb, backend en Railway.

---

## A. Resumen ejecutivo

### Problema #1 (crítico) — el sitio estaba bloqueado para Google
`public/robots.txt` contenía `User-agent: * / Disallow: /`, es decir **prohibía
indexar TODO el sitio**. Ningún otro esfuerzo de SEO sirve con esto puesto. Es la
causa raíz de la nula visibilidad orgánica. **Corregido.**

### Problema #2 — SPA sin metadata por página
Era una SPA sin `<title>`/`description`/canonical/Open Graph por ruta: todas las
páginas compartían el `<title>Indians Textil</title>` estático. Sin datos
estructurados, sin sitemap real (`Disallow` lo hacía irrelevante), `lang="en"`.

### Qué se hizo (aprovechando React 19)
React 19 **hoista de forma nativa** `<title>`, `<meta>`, `<link>` y JSON-LD al
`<head>`, así que se implementó SEO por página **sin agregar dependencias**
(nada de react-helmet):

| Cambio | Impacto esperado |
| --- | --- |
| `robots.txt` correcto (allow + sitemap + bloqueo de privadas/tracking) | **Desbloquea la indexación** (el cambio de mayor impacto) |
| `<Seo>` por página: title/description/canonical/robots/OG/Twitter únicos | Snippets relevantes, sin duplicados, mejor CTR |
| JSON-LD `Organization` + `WebSite` (SearchAction) en la home | Rich results, sitelinks searchbox, entidad de marca |
| JSON-LD `Product` (precio/stock/marca reales) en cada producto | Rich results de producto (precio, disponibilidad) |
| JSON-LD `BreadcrumbList` en listado y producto | Migas en los resultados de Google |
| `noindex` en carrito/checkout/favoritos/búsqueda interna | Evita indexar páginas sin valor / duplicados |
| Canonicals por faceta (categoría/género/tag/club indexables; combinaciones y búsqueda → canónica al listado) | Evita contenido duplicado por parámetros |
| `sitemap.xml` dinámico generado en el build desde la API real | Descubrimiento de productos y categorías |
| `index.html`: `lang="es-AR"`, theme-color, metadata delegada a React | Localización correcta, sin tags duplicados |
| Variables de entorno SEO (`VITE_STORE_URL`, títulos, OG, GSC) | Configurable por entorno, sin hardcodear |

> **No se inventaron datos**: el schema `Product` sólo emite precio/disponibilidad/
> marca que existen en la base. No hay ratings ni reviews (no hay datos reales).

---

## B. Archivos modificados / creados

**Nuevos**
- `frontIndians/src/utils/seo.ts` — constantes (SITE_URL, marca, defaults),
  `slugify`, `absoluteUrl`, `pageTitle`, `clampDescription`.
- `frontIndians/src/components/seo/Seo.tsx` — componente de metadata por página
  (title, description, canonical, robots, Open Graph, Twitter) vía React 19.
- `frontIndians/src/components/seo/JsonLd.tsx` — `OrganizationJsonLd`,
  `ProductJsonLd`, `BreadcrumbJsonLd`.
- `frontIndians/scripts/generate-sitemap.mjs` — genera `dist/sitemap.xml` en el
  build consultando la API pública (productos + categorías + géneros). Falla de
  forma segura (sitemap mínimo si la API no responde).
- `e2e/tests/seo.spec.ts` — robot que valida metadata, JSON-LD, canonical,
  noindex y robots.txt.

**Modificados**
- `frontIndians/public/robots.txt` — **fix crítico**: de `Disallow: /` a un
  robots real (allow público, bloqueo de privadas + tracking, `Sitemap:`).
- `frontIndians/index.html` — `lang="es-AR"`, `theme-color`, `<title>` fallback;
  la metadata SEO pasa a gestionarse por React (evita duplicados).
- `frontIndians/package.json` — el `build` genera el sitemap al final.
- `frontIndians/.env.example` — variables SEO (`VITE_STORE_URL`, `VITE_SITE_NAME`,
  `VITE_DEFAULT_SEO_TITLE/DESCRIPTION`, `VITE_DEFAULT_OG_IMAGE`,
  `VITE_GOOGLE_SITE_VERIFICATION`).
- `frontIndians/src/pages/store/StoreLandingPage.tsx` — `<Seo>` + Organization/
  WebSite JSON-LD; garantiza un `<h1>` (fallback sr-only si el hero no tiene título).
- `frontIndians/src/pages/store/StoreProductsPage.tsx` — `<Seo>` dinámico por
  faceta + canonical + noindex de búsquedas/combinaciones + Breadcrumb.
- `frontIndians/src/pages/store/StoreProductDetailPage.tsx` — `<Seo type=product>`
  + `ProductJsonLd` + `BreadcrumbJsonLd`; noindex en "no encontrado".
- `frontIndians/src/pages/store/StoreHelpPage.tsx` — `<Seo>` (indexable).
- `frontIndians/src/pages/store/StoreCartPage.tsx`,
  `StoreCheckoutPage.tsx`, `StoreFavoritesPage.tsx` — `<Seo noindex>`.

Logo de marca subido a Cloudinary (`indians/branding/logo-mail`) y reutilizado
como OG por defecto (tarjeta 1200x630 vía transformaciones).

---

## C. Checklist

- [x] Metadata dinámica por página (home, listado, categoría/facetas, producto, ayuda)
- [x] Canonicals (home → /tienda; producto → /tienda/productos/:id; facetas → self; búsqueda/combos → listado)
- [x] robots.txt (allow público + bloqueo privadas/tracking + Sitemap)
- [x] sitemap.xml (dinámico en build desde la API; excluye privadas y params)
- [x] Schema Product (precio/stock/marca reales; sin ratings falsos)
- [x] Schema Organization / WebSite (+ SearchAction)
- [x] BreadcrumbList (listado + producto)
- [x] Imágenes con alt (ya existían en ProductCard/PDP) + lazy loading
- [x] Páginas noindex (carrito, checkout, favoritos, búsqueda interna, 404 de producto)
- [x] Mobile-first (el diseño ya era responsive; no se alteró)
- [x] Footer/enlazado interno rastreable (`<Link>`/`<a>` ya presentes)
- [x] Variables de entorno SEO
- [x] `lang="es-AR"`
- [~] URLs SEO-friendly — **parcial**: se mantienen `/tienda/productos/:id` (por ID)
      para no romper links/rutas. Ver "tareas pendientes" para migrar a slug.
- [x] **Prerender de páginas públicas** — snapshot estático de home, listado,
      ayuda, **cada categoría** y cada producto en el build (ver sección Prerender).
- [x] **Categorías con URL por path** — `/tienda/categoria/:slug` (prerenderizable);
      la versión vieja por query (`?category=`) canonicaliza hacia la nueva.

---

## D. Tareas manuales pendientes (fuera del código)

1. **Google Search Console**: verificar la propiedad `indians.com.ar`. El meta
   de verificación se puede exponer con `VITE_GOOGLE_SITE_VERIFICATION` (habría
   que agregar `<meta name="google-site-verification">` en `Seo.tsx` o un `<Seo>`
   global — hoy la variable está declarada en `.env.example` pero **no** inyectada;
   se decidió no inyectarla hasta tener el token real). Alternativa recomendada:
   verificar por DNS TXT en Donweb (no requiere tocar código).
2. **Enviar el sitemap** en GSC: `https://indians.com.ar/sitemap.xml`.
3. **Rich Results Test** (search.google.com/test/rich-results) sobre un producto
   real y la home, tras cargar productos en producción.
4. **PageSpeed Insights** sobre home y una PDP; priorizar LCP de la imagen del hero.
5. **Cargar productos reales** en producción: hoy la API de producción devuelve 0
   productos, por eso el sitemap sólo trae las 3 rutas estáticas. Con productos
   cargados, el sitemap los incluirá automáticamente en el próximo `npm run deploy`.
6. **Textos de categorías**: completar descripciones únicas por categoría (100–300
   palabras) — hoy la description de categoría se genera por plantilla; para
   máximo valor conviene texto editorial propio (requiere una key en settings o
   un CMS liviano; ver punto de mejora futura).
7. **Reseñas reales**: si la tienda las incorpora, recién ahí agregar
   `aggregateRating`/`review` al `ProductJsonLd` (hoy omitidos a propósito).

---

## Prerender de páginas públicas (SSG por snapshot)

**Qué:** en el deploy se generan snapshots HTML estáticos de las páginas públicas
con la metadata + contenido ya renderizados, para que Google y los **scrapers
sociales** (que no ejecutan JS) reciban todo sin depender del cliente.

**Cómo (bajo riesgo, sin tocar el código de la app):**
- `frontIndians/scripts/prerender.mjs` levanta un server estático del `dist/`,
  abre la app en **Chromium headless** (Playwright — reutiliza el navegador ya
  instalado para los e2e), navega cada ruta, espera a que React monte e inyecte
  la metadata, y guarda el DOM como **`dist/<ruta>/index.html`** (carpeta +
  index, NO `.html` plano — ver "Fix 403" abajo).
- Rutas: `/tienda`, `/tienda/productos`, `/tienda/ayuda`, **cada categoría**
  (`/tienda/categoria/<slug>`) y **cada producto** (`/tienda/productos/<id>`),
  enumerados desde la API pública.

> **Fix 403 (jul 2026):** el primer enfoque escribía archivos planos
> (`dist/tienda.html`), pero el prerender también crea la carpeta `dist/tienda/`
> (por productos/categorías). Al pedir `indians.com.ar/tienda/` (con barra final)
> Apache servía esa carpeta sin `index.html` → **403 Forbidden**. Solución:
> carpeta + `index.html` por ruta + `.htaccess` que sirve `<ruta>/index.html`
> sin redirect, con fallback SPA a prueba de carpetas (rule 3 sin condiciones →
> nunca 403). Si `%{DOCUMENT_ROOT}` no está disponible en el host, degrada al
> SPA (el sitio funciona igual, sólo sin snapshot).
- Detalles: bloquea `/store/track` y `/logs/client` (no ensucia analytics), corre
  con `--disable-web-security` (el navegador está en 127.0.0.1, origen fuera del
  CORS de la API; al ser build-time es seguro), y deja un único `<title>` por
  página (quita el fallback del `index.html`).
- **Entrega:** `public/.htaccess` sirve `<ruta>.html` en la URL limpia **sin
  redirect** si el archivo existe; si no, cae al fallback SPA (comportamiento
  original intacto → cambio aditivo y seguro).
- **Pipeline:** `npm run deploy` = `build` → `prerender` → FTP. El `build` normal
  (dev/CI) NO corre prerender (queda rápido). Dependencia nueva: `playwright`
  (devDependency de `frontIndians`).

**Fallo seguro:** si falta el navegador o la API no responde, el prerender avisa y
se omite (la SPA sigue funcionando).

## E. Limitaciones y decisiones técnicas (sin TODOs genéricos)

- **Es una SPA (client-side rendering)** con **prerender** de las páginas públicas
  (ver sección "Prerender" abajo). El snapshot estático resuelve el punto débil
  del CSR: ahora los scrapers sociales (WhatsApp/Facebook/Twitter) y Google
  reciben el HTML ya renderizado con el OG/metadata/JSON-LD por página, sin
  ejecutar JS. Quedan dos límites menores:
  - Las **categorías** ya usan URL por path (`/tienda/categoria/:slug`) y **sí se
    prerenderizan**. Las facetas de **género/tag/club** siguen por query param
    (`?gender=`, `?tag=`) y NO se prerenderizan como archivo (Apache ignora el
    query string); reciben el snapshot del listado y Google las indexa vía JS +
    sitemap. Migrar género a path sería el siguiente paso si se quisiera.
  - **Paginación del listado no está en la URL** (es estado de React): Google no
    puede llegar a la "página 2". El sitemap mitiga esto listando cada producto
    directamente. Para mejorar, migrar la paginación a `?page=` con canonical/rel
    y sumarla al crawl. Archivo: `StoreProductsPage.tsx`.
- **URLs de producto por ID** (`/tienda/productos/123`). Migrar a
  `/tienda/productos/123/slug` es de bajo riesgo (el ID sigue siendo la clave):
  agregar el segmento opcional en `router/index.tsx`, generar el link con
  `slugify(product.title)` en `ProductCard`/PDP, canonical con slug, y redirect
  301 del formato viejo. `slugify` ya está listo en `utils/seo.ts`. No se hizo
  ahora para no tocar todos los links en un mismo cambio.
- **El dominio raíz `/` redirige a `/tienda` por JS.** Lo ideal para SEO es servir
  la tienda directamente en `/`. Hoy el canonical de la home apunta a `/tienda`.
  Mejora futura: servir la landing en `/` (cambio en `router/index.tsx`).
- **robots.txt es único para ambos hosts** (tienda y `sistema.`), porque comparten
  el deploy estático. Incluye `Disallow` de las rutas del sistema, así que aunque
  se sirva en el subdominio, el panel no se rastrea.

---

## Verificación realizada

- `tsc --noEmit` (frontend): sin errores.
- `npm run build`: compila y genera `dist/sitemap.xml`, `dist/robots.txt`,
  `dist/index.html` correctos.
- E2E Playwright (`e2e/tests/seo.spec.ts`): **5/5** — title/description/canonical/
  robots por página, JSON-LD Organization+WebSite+Breadcrumb, noindex en carrito
  y búsqueda, robots.txt válido.
- E2E Playwright (`e2e/tests/store.spec.ts`): **5/5** — sin regresiones en la tienda.

Correr:
```bash
cd frontIndians && npm run build          # build + sitemap
cd e2e && npx playwright test seo.spec.ts store.spec.ts --project=chromium
```
