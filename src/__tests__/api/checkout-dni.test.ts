import jwt from 'jsonwebtoken';
import { api, API, loginAs, auth } from './helpers';
import { StoreCustomer } from '../../models';

/*
 * DNI obligatorio en el checkout de la tienda (feature/checkout-dni-obligatorio).
 *
 * El comprador tiene que informar su DNI para poder despachar el envío. Se
 * valida en `checkoutValidators` (`src/routes/store.routes.ts`): se limpian
 * puntos/espacios y se exige entre 7 y 9 dígitos. El valor normalizado queda en
 * `store_orders.customer_dni` y se replica al perfil del comprador logueado
 * (`store_customers.dni`) si todavía no tenía uno.
 */

describe('DNI obligatorio en POST /store/checkout', () => {
  let admin: string;
  let productId: number;

  function checkoutBody(overrides: Record<string, unknown> = {}) {
    return {
      accept_terms: true,
      customerName: 'Robot QA DNI',
      customerEmail: `qa-dni+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      customerDni: '30123456',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'mercadopago',
      ...overrides,
    };
  }

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto DNI QA ${Date.now()}-${Math.random()}`,
      price: 5000,
      stock_quantity: 50,
      show_in_store: true,
      active: true,
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  it('rechaza el checkout sin DNI con 422', async () => {
    const body = checkoutBody();
    delete (body as Record<string, unknown>).customerDni;
    const res = await api().post(`${API}/store/checkout`).send(body);
    expect(res.status).toBe(422);
  });

  it('rechaza un DNI con menos de 7 dígitos con 422', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody({ customerDni: '12345' }));
    expect(res.status).toBe(422);
  });

  it('rechaza un DNI no numérico con 422', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody({ customerDni: 'ABC12345' }));
    expect(res.status).toBe(422);
  });

  it('acepta un DNI con puntos y lo guarda normalizado (solo dígitos)', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody({ customerDni: '30.123.456' }));
    expect(res.status).toBe(201);
    expect(res.body.data.order.customer_dni).toBe('30123456');
  });

  it('replica el DNI al perfil del comprador logueado que no tenía uno', async () => {
    const customer = await StoreCustomer.create({
      name: 'Robot QA DNI Logueado',
      email: `qa-dni-log+${Date.now()}@test.local`,
      password_hash: 'x',
      email_verified: true,
    });
    const secret = process.env.STORE_JWT_SECRET || process.env.JWT_SECRET!;
    const token = jwt.sign(
      { sub: customer.id, email: customer.email, type: 'store_customer', session_version: 1 },
      secret,
      { expiresIn: '15m' }
    );

    const res = await api()
      .post(`${API}/store/checkout`)
      .set('Authorization', `Bearer ${token}`)
      .send(checkoutBody({ customerName: customer.name, customerEmail: customer.email, customerDni: '27888999' }));
    expect(res.status).toBe(201);

    await customer.reload();
    expect(customer.dni).toBe('27888999');
  });
});
