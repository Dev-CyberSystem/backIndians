import { escapeHtml } from './escapeHtml';
import { formatPriceNumber } from './money';

/**
 * Render de newsletters: bloques del editor → HTML de mail.
 *
 * Por qué bloques y no HTML libre: el HTML de mail es frágil (Gmail descarta
 * `<style>`, Outlook usa el motor de Word, los celulares achican todo). Con
 * bloques el panel no puede romper el diseño y el resultado sale siempre con la
 * marca de la tienda: tablas de 600px, estilos inline y nada de JS ni CSS
 * externo.
 *
 * Este módulo es PURO (no toca la base): recibe los productos ya resueltos y
 * los datos de marca. Eso lo hace testeable y permite la vista previa en vivo.
 *
 * Personalización: el HTML sale con dos marcadores que el envío reemplaza por
 * destinatario — `{{nombre}}` (también válido en el asunto) y
 * `{{unsubscribe_url}}`. Ver `personalizeNewsletter`.
 */

// ─── Tipos de bloque ─────────────────────────────────────────────────────────

export type BlockAlign = 'left' | 'center';

export type NewsletterBlock =
  | { type: 'heading'; text: string; align?: BlockAlign }
  | { type: 'text'; text: string; align?: BlockAlign }
  | { type: 'image'; url: string; alt?: string; link?: string }
  | { type: 'button'; label: string; url: string; align?: BlockAlign }
  | { type: 'products'; product_ids: number[]; title?: string }
  | { type: 'coupon'; code: string; text?: string }
  | { type: 'divider' }
  | { type: 'spacer'; size?: 'sm' | 'md' | 'lg' };

export const NEWSLETTER_BLOCK_TYPES = [
  'heading', 'text', 'image', 'button', 'products', 'coupon', 'divider', 'spacer',
] as const;

export interface NewsletterProductCard {
  id: number;
  title: string;
  /** Precio final (con descuento aplicado). */
  price: number;
  /** Precio de lista, solo si hay descuento. */
  original_price: number | null;
  image: string | null;
}

export interface NewsletterBrand {
  storeName: string;
  logoUrl: string | null;
  /** URL base de la tienda (ej. https://indians.com.ar/tienda). */
  storeUrl: string;
  /** Dirección postal del remitente (identifica a quien envía). */
  address?: string | null;
  instagram?: string | null;
  facebook?: string | null;
}

export interface RenderInput {
  subject: string;
  preheader?: string | null;
  blocks: NewsletterBlock[];
  products: Map<number, NewsletterProductCard>;
  brand: NewsletterBrand;
  /** Para las UTM de los links a la tienda. */
  campaignSlug?: string;
}

export const NAME_PLACEHOLDER = '{{nombre}}';
export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}';

// ─── Paleta (misma que la tienda: tailwind.config) ───────────────────────────
const C = {
  ink: '#1A1A1A',
  bone: '#FAF9F7',
  sand100: '#F3F0EB',
  sand200: '#E7E2D9',
  sand500: '#857C6F',
  clay: '#C17A5A',
  clay50: '#FBF3EE',
};
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Solo http(s) y mailto: nada de `javascript:` ni `data:` en un link de mail. */
export function safeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (/^mailto:[^\s]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Agrega UTM a los links que van a la tienda, para medir en analytics cuánto
 * tráfico/ventas trae cada campaña. Links a otros dominios quedan intactos.
 */
export function withUtm(url: string, storeUrl: string, campaignSlug?: string): string {
  if (!campaignSlug) return url;
  try {
    const u = new URL(url);
    const store = new URL(storeUrl);
    if (u.host !== store.host) return url;
    if (!u.searchParams.has('utm_source')) {
      u.searchParams.set('utm_source', 'newsletter');
      u.searchParams.set('utm_medium', 'email');
      u.searchParams.set('utm_campaign', campaignSlug);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function slugify(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'campana';
}

/**
 * Texto del editor → HTML seguro. Se escapa TODO primero y recién después se
 * habilita un mínimo de formato: **negrita** y [texto](https://link).
 * Párrafos separados por línea en blanco; salto simple → <br>.
 */
export function renderRichText(text: string, linkStyle: string, mapUrl: (u: string) => string): string {
  const paragraphs = String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      let html = escapeHtml(p.trim());
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
        // `href` ya viene escapado (&amp;): se des-escapa solo para validarlo.
        const url = safeUrl(href.replace(/&amp;/g, '&'));
        if (!url) return label;
        return `<a href="${escapeHtml(mapUrl(url))}" style="${linkStyle}">${label}</a>`;
      });
      html = html.replace(/\n/g, '<br />');
      return html;
    })
    .filter((p) => p.length > 0)
    .map((p) => `<p style="margin:0 0 14px;">${p}</p>`)
    .join('');
}

const fmtMoney = (n: number) => `$${formatPriceNumber(n)}`;

// ─── Bloques ─────────────────────────────────────────────────────────────────

function row(inner: string, padding = '0 32px'): string {
  return `<tr><td style="padding:${padding};">${inner}</td></tr>`;
}

function renderBlock(block: NewsletterBlock, input: RenderInput): string {
  const link = (u: string) => withUtm(u, input.brand.storeUrl, input.campaignSlug);
  const align = (b: { align?: BlockAlign }) => (b.align === 'center' ? 'center' : 'left');

  switch (block.type) {
    case 'heading':
      return row(
        `<h1 style="margin:8px 0 14px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:700;color:${C.ink};text-align:${align(block)};">${escapeHtml(block.text)}</h1>`
      );

    case 'text':
      return row(
        `<div style="font-family:${FONT};font-size:15px;line-height:1.6;color:#3a3a3a;text-align:${align(block)};">${renderRichText(
          block.text,
          `color:${C.ink};text-decoration:underline;`,
          link
        )}</div>`
      );

    case 'image': {
      const src = safeUrl(block.url);
      if (!src) return '';
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt ?? '')}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;" />`;
      const href = safeUrl(block.link);
      return row(
        `<div style="margin:6px 0 18px;">${href ? `<a href="${escapeHtml(link(href))}" target="_blank">${img}</a>` : img}</div>`
      );
    }

    case 'button': {
      const href = safeUrl(block.url);
      if (!href) return '';
      return row(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align(block)}" style="margin:8px 0 22px;"><tr><td style="background:${C.ink};">` +
          `<a href="${escapeHtml(link(href))}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(block.label)}</a>` +
          `</td></tr></table>`
      );
    }

    case 'products': {
      const cards = block.product_ids
        .map((id) => input.products.get(id))
        .filter((p): p is NewsletterProductCard => !!p);
      if (cards.length === 0) return '';
      const cell = (p: NewsletterProductCard) => {
        const href = escapeHtml(link(`${input.brand.storeUrl.replace(/\/$/, '')}/productos/${p.id}`));
        const img = p.image
          ? `<a href="${href}" target="_blank"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" width="258" style="display:block;width:100%;max-width:258px;height:auto;border:0;background:${C.sand100};" /></a>`
          : `<div style="height:200px;background:${C.sand100};"></div>`;
        const price = p.original_price && p.original_price > p.price
          ? `<span style="color:${C.sand500};text-decoration:line-through;font-size:12px;">${fmtMoney(p.original_price)}</span>&nbsp; <span style="color:${C.clay};font-weight:700;">${fmtMoney(p.price)}</span>`
          : `<span style="color:${C.ink};font-weight:700;">${fmtMoney(p.price)}</span>`;
        return `${img}<p style="margin:10px 0 2px;font-family:${FONT};font-size:14px;line-height:1.35;color:${C.ink};"><a href="${href}" target="_blank" style="color:${C.ink};text-decoration:none;">${escapeHtml(p.title)}</a></p><p style="margin:0 0 6px;font-family:${FONT};font-size:14px;">${price}</p>`;
      };
      const rows: string[] = [];
      for (let i = 0; i < cards.length; i += 2) {
        const a = cards[i];
        const b = cards[i + 1];
        rows.push(
          `<tr><td width="50%" valign="top" style="padding:0 10px 22px 0;">${cell(a)}</td><td width="50%" valign="top" style="padding:0 0 22px 10px;">${b ? cell(b) : ''}</td></tr>`
        );
      }
      const title = block.title
        ? `<p style="margin:6px 0 16px;font-family:${FONT};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.sand500};">${escapeHtml(block.title)}</p>`
        : '';
      return row(`${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`);
    }

    case 'coupon':
      return row(
        `<div style="margin:6px 0 22px;padding:22px;border:1px dashed ${C.clay};background:${C.clay50};text-align:center;font-family:${FONT};">` +
          (block.text ? `<p style="margin:0 0 8px;font-size:14px;color:#3a3a3a;">${escapeHtml(block.text)}</p>` : '') +
          `<p style="margin:0;font-size:24px;letter-spacing:4px;font-weight:700;color:${C.ink};">${escapeHtml(block.code)}</p>` +
          `</div>`
      );

    case 'divider':
      return row(`<div style="margin:10px 0 22px;border-top:1px solid ${C.sand200};font-size:0;line-height:0;">&nbsp;</div>`);

    case 'spacer': {
      const h = block.size === 'lg' ? 40 : block.size === 'sm' ? 12 : 24;
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    }

    default:
      return '';
  }
}

// ─── Documento completo ──────────────────────────────────────────────────────

export function renderNewsletterHtml(input: RenderInput): string {
  const { brand } = input;
  const storeUrl = withUtm(brand.storeUrl, brand.storeUrl, input.campaignSlug);
  const header = brand.logoUrl
    ? `<a href="${escapeHtml(storeUrl)}" target="_blank"><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.storeName)}" width="150" style="display:inline-block;width:150px;max-width:60%;height:auto;border:0;" /></a>`
    : `<a href="${escapeHtml(storeUrl)}" target="_blank" style="font-family:${FONT};font-size:24px;font-weight:800;color:${C.ink};text-decoration:none;">${escapeHtml(brand.storeName)}</a>`;

  const social = [
    brand.instagram ? `<a href="${escapeHtml(brand.instagram)}" style="color:${C.sand500};">Instagram</a>` : '',
    brand.facebook ? `<a href="${escapeHtml(brand.facebook)}" style="color:${C.sand500};">Facebook</a>` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const body = input.blocks.map((b) => renderBlock(b, input)).join('\n');

  // El preheader es el texto que el cliente de correo muestra junto al asunto
  // en la bandeja: va oculto al principio del cuerpo.
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.bone};opacity:0;">${escapeHtml(input.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.sand100};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.sand100};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
<tr><td align="center" style="padding:32px 32px 22px;border-bottom:1px solid ${C.sand200};">${header}</td></tr>
<tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
${body}
<tr><td style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:26px 32px 30px;background:${C.ink};font-family:${FONT};font-size:12px;line-height:1.6;color:#bdb6ab;">
${social ? `<p style="margin:0 0 12px;">${social}</p>` : ''}
<p style="margin:0 0 8px;">Recibís este mail porque te suscribiste a las novedades de ${escapeHtml(brand.storeName)} o porque sos cliente de nuestra tienda.</p>
<p style="margin:0 0 8px;"><a href="${UNSUBSCRIBE_PLACEHOLDER}" style="color:#ffffff;text-decoration:underline;">Darme de baja</a></p>
${brand.address ? `<p style="margin:0;color:#857c6f;">${escapeHtml(brand.storeName)} · ${escapeHtml(brand.address)}</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Personaliza el HTML (o el asunto) para un destinatario. El nombre se escapa:
 * viene del formulario público. Sin nombre, `{{nombre}}` queda vacío y se
 * limpia el espacio/coma colgante ("Hola {{nombre}}," → "Hola,").
 */
export function personalizeNewsletter(
  template: string,
  vars: { name?: string | null; unsubscribeUrl?: string },
  { html = true }: { html?: boolean } = {}
): string {
  const first = (vars.name ?? '').trim().split(/\s+/)[0] ?? '';
  const name = html ? escapeHtml(first) : first;
  let out = first
    ? template.split(NAME_PLACEHOLDER).join(name)
    : template.replace(/\s*\{\{nombre\}\}/g, '');
  if (vars.unsubscribeUrl !== undefined) {
    out = out.split(UNSUBSCRIBE_PLACEHOLDER).join(html ? escapeHtml(vars.unsubscribeUrl) : vars.unsubscribeUrl);
  }
  return out;
}
