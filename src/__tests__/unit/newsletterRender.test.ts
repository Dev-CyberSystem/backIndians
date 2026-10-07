import {
  personalizeNewsletter,
  renderNewsletterHtml,
  renderRichText,
  safeUrl,
  withUtm,
  NewsletterProductCard,
} from '../../utils/newsletterRender';

/*
 * Render de newsletters (bloques → HTML de mail). Puro: no toca la base.
 * Cubre lo que hace seguro al editor: escape de todo lo que carga el panel,
 * solo links http(s)/mailto, UTM solo hacia la tienda, y la personalización
 * por destinatario.
 */

const brand = {
  storeName: 'Indians',
  logoUrl: 'https://cdn.test/logo.png',
  storeUrl: 'https://indians.com.ar/tienda',
  address: 'San Miguel de Tucumán',
};

describe('newsletterRender', () => {
  it('safeUrl rechaza javascript:/data: y acepta http(s) y mailto', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hola')).toBeNull();
    expect(safeUrl('ftp://x.com')).toBeNull();
    expect(safeUrl('https://indians.com.ar/x')).toBe('https://indians.com.ar/x');
    expect(safeUrl('mailto:hola@indians.com.ar')).toBe('mailto:hola@indians.com.ar');
  });

  it('withUtm agrega UTM solo a links de la tienda', () => {
    const inStore = withUtm('https://indians.com.ar/tienda/productos/1', brand.storeUrl, 'promo-invierno');
    expect(inStore).toContain('utm_source=newsletter');
    expect(inStore).toContain('utm_campaign=promo-invierno');
    expect(withUtm('https://instagram.com/indians', brand.storeUrl, 'x')).toBe('https://instagram.com/indians');
  });

  it('renderRichText escapa HTML y solo habilita **negrita** y [link](https)', () => {
    const html = renderRichText('<script>x</script> **hola** [ver](https://a.com) [mal](javascript:alert(1))', '', (u) => u);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>hola</strong>');
    expect(html).toContain('href="https://a.com/"');
    expect(html).not.toContain('javascript:');
  });

  it('renderiza bloques, productos con descuento y el pie con baja', () => {
    const products = new Map<number, NewsletterProductCard>([
      [7, { id: 7, title: 'Camiseta <b>Pro</b>', price: 9000, original_price: 10000, image: 'https://cdn.test/7.jpg' }],
    ]);
    const html = renderNewsletterHtml({
      subject: 'Nueva colección',
      preheader: 'Llegó el invierno',
      blocks: [
        { type: 'heading', text: 'Hola {{nombre}}' },
        { type: 'button', label: 'Ver tienda', url: 'https://indians.com.ar/tienda' },
        { type: 'products', product_ids: [7, 99] },
        { type: 'coupon', code: 'INVIERNO10' },
        { type: 'image', url: 'javascript:alert(1)' },
      ],
      products,
      brand,
      campaignSlug: 'invierno',
    });
    expect(html).toContain('Hola {{nombre}}');
    expect(html).toContain('Llegó el invierno');
    expect(html).toContain('Camiseta &lt;b&gt;Pro&lt;/b&gt;');
    expect(html).toContain('/productos/7?utm_source=newsletter');
    expect(html).toContain('line-through');
    expect(html).toContain('INVIERNO10');
    expect(html).toContain('{{unsubscribe_url}}');
    expect(html).not.toContain('javascript:');
  });

  it('personaliza nombre (escapado) y link de baja; sin nombre limpia el marcador', () => {
    const tpl = '<p>Hola {{nombre}}, mirá</p><a href="{{unsubscribe_url}}">baja</a>';
    const out = personalizeNewsletter(tpl, { name: 'Ana <x> Pérez', unsubscribeUrl: 'https://t/baja?a=1&c=2' });
    expect(out).toContain('Hola Ana, mirá');
    expect(out).toContain('href="https://t/baja?a=1&amp;c=2"');

    const noName = personalizeNewsletter(tpl, { name: '', unsubscribeUrl: '#' });
    expect(noName).toContain('Hola, mirá');

    expect(personalizeNewsletter('Hola {{nombre}}!', { name: 'Ana' }, { html: false })).toBe('Hola Ana!');
  });
});
