import { api, API, loginAs, auth } from './helpers';

/*
 * Total correcto en el checkout (1.6 / C-6, A-3, A-4 — casos 4, 5 y 6 de la
 * auditoría). POST /store/checkout/quote calcula el desglose real en backend
 * (incluido el envío) sin crear nada; POST /store/checkout verifica que el
 * total que el cliente vio (expected_total) coincida con el recalculado.
 *
 * Los settings de envío vienen en 0 por defecto — se configuran acá y se
 * restauran al terminar para no dejar basura en la DB de dev.
 */

describe('Total correcto en el checkout (quote) — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;
  let originalShippingCost: string | undefined;
  let originalFreeShippingMin: string | undefined;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const currentSettings = await api().get(`${API}/settings`).set(...auth(admin));
    originalShippingCost = currentSettings.body.data?.shipping_cost;
    originalFreeShippingMin = currentSettings.body.data?.free_shipping_min;

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      shipping_cost: '500',
      free_shipping_min: '0',
    });

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Quote QA ${Date.now()}`,
      price: 5000,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
    });
    productId = product.body.data?.id;
    expect(productId).toBeTruthy();
  });

  afterAll(async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({
      shipping_cost: originalShippingCost ?? '0',
      free_shipping_min: originalFreeShippingMin ?? '0',
    });
  });

  it('caso 6 — el quote calcula el subtotal y total real (retiro en local, sin envío)', async () => {
    const res = await api().post(`${API}/store/checkout/quote`).send({
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'pickup',
    });
    expect(res.status).toBe(200);
    const quote = res.body.data;
    expect(quote.all_available).toBe(true);
    expect(quote.items[0].disponible).toBe(true);
    expect(quote.items[0].unit_price).toBe(5000);
    expect(quote.subtotal).toBe(10000);
    expect(quote.shipping_cost).toBe(0);
    expect(quote.total).toBe(10000);
  });

  it('caso 4/C-6 — el quote incluye el costo de envío real para delivery (no "se calcula al pagar")', async () => {
    const res = await api().post(`${API}/store/checkout/quote`).send({
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'delivery',
    });
    expect(res.status).toBe(200);
    const quote = res.body.data;
    expect(quote.shipping_cost).toBe(500);
    expect(quote.total).toBe(10500);
  });

  it('caso 5 — un ítem sin stock queda marcado no disponible con motivo, sin frenar el resto', async () => {
    const res = await api().post(`${API}/store/checkout/quote`).send({
      items: [
        { catalog_product_id: productId, size_name: null, quantity: 2 },
        { catalog_product_id: productId, size_name: null, quantity: 999 }, // sin stock
      ],
      shipping_type: 'pickup',
    });
    expect(res.status).toBe(200);
    const quote = res.body.data;
    expect(quote.all_available).toBe(false);
    // Nota: mismo catalog_product_id en ambos ítems, el motivo tiene que ser
    // específico por línea, no genérico.
    const problem = quote.items.find((i: { disponible: boolean }) => !i.disponible);
    expect(problem).toBeTruthy();
    expect(problem.motivo).toMatch(/Stock insuficiente/);
  });

  it('un producto con precio 0 queda no disponible en el quote y no se puede comprar', async () => {
    const zeroPriceProduct = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Precio Cero QA ${Date.now()}`,
      price: 0,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
    });
    const zeroPriceProductId = zeroPriceProduct.body.data?.id;
    expect(zeroPriceProductId).toBeTruthy();

    const quoteRes = await api().post(`${API}/store/checkout/quote`).send({
      items: [{ catalog_product_id: zeroPriceProductId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
    });
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.data.all_available).toBe(false);
    expect(quoteRes.body.data.items[0].disponible).toBe(false);
    expect(quoteRes.body.data.items[0].motivo).toMatch(/precio válido/);

    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Precio Cero',
      customerEmail: `qa-precio-cero+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: zeroPriceProductId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
    });
    expect(checkout.status).toBe(400);
  });

  it('un producto con precio negativo (public_price mal cargado) queda no disponible y no se puede comprar', async () => {
    // "price" no puede ser negativo (validador isFloat({min:0})), pero
    // "public_price" no tiene ese chequeo — es el vector real de un precio
    // negativo llegando al checkout (ej. error de tipeo al cargarlo).
    const negativePriceProduct = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Precio Negativo QA ${Date.now()}`,
      price: 100,
      public_price: -100,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
    });
    const negativePriceProductId = negativePriceProduct.body.data?.id;
    expect(negativePriceProductId).toBeTruthy();

    const quoteRes = await api().post(`${API}/store/checkout/quote`).send({
      items: [{ catalog_product_id: negativePriceProductId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
    });
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.data.all_available).toBe(false);
    expect(quoteRes.body.data.items[0].disponible).toBe(false);

    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Precio Negativo',
      customerEmail: `qa-precio-negativo+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: negativePriceProductId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
    });
    expect(checkout.status).toBe(400);
  });

  it('el checkout con expected_total desincronizado devuelve 409 con el desglose nuevo', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Quote',
      customerEmail: `qa-quote+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'delivery',
      shipping_address: { street: 'Calle 1', city: 'CABA' },
      payment_method: 'bank_transfer',
      expected_total: 1, // claramente desincronizado
    });
    expect(checkout.status).toBe(409);
    const quote = checkout.body.errors?.[0]?.quote;
    expect(quote).toBeTruthy();
    expect(quote.total).toBe(10500); // subtotal 10000 + envío 500
  });

  it('el checkout con expected_total correcto (igual al quote) funciona normal', async () => {
    const quoteRes = await api().post(`${API}/store/checkout/quote`).send({
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
    });
    const total = quoteRes.body.data.total;

    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Quote OK',
      customerEmail: `qa-quote-ok+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
      expected_total: total,
    });
    expect(checkout.status).toBe(201);
    expect(checkout.body.data.order.total_amount).toBe(total);
  });
});
