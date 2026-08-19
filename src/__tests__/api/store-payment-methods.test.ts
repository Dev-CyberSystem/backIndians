import { api, API, loginAs, auth } from './helpers';

/*
 * Contrato de medios de pago del checkout de tienda (R-02 de la auditoría del
 * 2026-08-19).
 *
 * El commit que desactivó el pago en efectivo cambió el validador de
 * `payment_method` sin dejar ningún test que fijara el nuevo contrato: los 17
 * archivos que usaban 'cash' pasaron a fallar y nada verificaba lo que sí
 * tenía que pasar. Este archivo es esa red — si mañana alguien reactiva
 * 'cash' en `store.routes.ts`, tiene que romper acá y no en producción.
 */

describe('Medios de pago aceptados por POST /store/checkout', () => {
  let admin: string;
  let productId: number;

  function checkoutBody(paymentMethod: string) {
    return {
      accept_terms: true,
      customerName: 'Robot QA Medios de Pago',
      customerEmail: `qa-medios+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: paymentMethod,
    };
  }

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Medios de Pago QA ${Date.now()}-${Math.random()}`,
      price: 5000,
      stock_quantity: 50,
      show_in_store: true,
      active: true,
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  it("rechaza payment_method: 'cash' con 422 — el pago en efectivo está desactivado", async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('cash'));
    expect(res.status).toBe(422);
  });

  it('rechaza un medio de pago inventado con 422', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('bitcoin'));
    expect(res.status).toBe(422);
  });

  it("acepta 'bank_transfer' (con datos bancarios configurados)", async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('bank_transfer'));
    expect(res.status).toBe(201);
  });

  it('un checkout rechazado no deja stock reservado', async () => {
    const before = await api().get(`${API}/store/products/${productId}`);
    const reservedBefore = Number(before.body.data?.stock_reserved ?? 0);

    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('cash'));
    expect(res.status).toBe(422);

    const after = await api().get(`${API}/store/products/${productId}`);
    expect(Number(after.body.data?.stock_reserved ?? 0)).toBe(reservedBefore);
  });
});
