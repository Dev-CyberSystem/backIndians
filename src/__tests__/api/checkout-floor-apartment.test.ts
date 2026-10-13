import { api, API, loginAs, auth } from './helpers';

/*
 * Piso y departamento OPCIONALES en la dirección de envío del checkout
 * (brief de modificaciones web 06.10.2026, pedido 06).
 *
 * Se pueden omitir sin que falle la compra; cuando se informan se guardan
 * recortados dentro de `store_orders.shipping_address` (JSON), y los vacíos no
 * se persisten. Validador: `checkoutValidators` en `src/routes/store.routes.ts`.
 */

describe('Piso y departamento opcionales en POST /store/checkout', () => {
  let productId: number;

  function checkoutBody(address: Record<string, unknown> = {}) {
    return {
      accept_terms: true,
      customerName: 'Robot QA Piso',
      customerEmail: `qa-piso+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      customerDni: '30123456',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'delivery',
      shipping_address: {
        street: 'Av. Mate de Luna 1234',
        city: 'San Miguel de Tucumán',
        state: 'Tucumán',
        zip_code: '4000',
        shipping_zone: 'tucuman_capital',
        ...address,
      },
      payment_method: 'mercadopago',
    };
  }

  beforeAll(async () => {
    const admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Piso QA ${Date.now()}-${Math.random()}`,
      price: 5000,
      stock_quantity: 50,
      show_in_store: true,
      active: true,
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  it('permite finalizar la compra sin piso ni departamento', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody());
    expect(res.status).toBe(201);
    const addr = res.body.data.order.shipping_address;
    expect(addr.street).toBe('Av. Mate de Luna 1234');
    expect(addr.floor).toBeUndefined();
    expect(addr.apartment).toBeUndefined();
  });

  it('guarda piso y departamento recortados cuando se informan', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody({ floor: ' 4 ', apartment: ' B ' }));
    expect(res.status).toBe(201);
    const addr = res.body.data.order.shipping_address;
    expect(addr.floor).toBe('4');
    expect(addr.apartment).toBe('B');
  });

  it('no persiste piso/departamento vacíos', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody({ floor: '   ', apartment: '' }));
    expect(res.status).toBe(201);
    const addr = res.body.data.order.shipping_address;
    expect(addr.floor).toBeUndefined();
    expect(addr.apartment).toBeUndefined();
  });

  it('rechaza con 422 un piso o departamento de más de 20 caracteres', async () => {
    const long = 'x'.repeat(21);
    expect((await api().post(`${API}/store/checkout`).send(checkoutBody({ floor: long }))).status).toBe(422);
    expect((await api().post(`${API}/store/checkout`).send(checkoutBody({ apartment: long }))).status).toBe(422);
  });
});
