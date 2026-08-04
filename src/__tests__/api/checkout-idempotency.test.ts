import { randomUUID } from 'crypto';
import { api, API, loginAs, auth } from './helpers';
import { CatalogProduct } from '../../models/CatalogProduct';

/*
 * Idempotencia del checkout (1.4 / A-1): dos POST /store/checkout con el
 * mismo header Idempotency-Key deben resolver al MISMO pedido y reservar
 * stock una sola vez, tanto en secuencia (retry después de que el primero ya
 * terminó) como en paralelo (doble clic real). Sin header, el comportamiento
 * no cambia (dos pedidos). Usa un producto propio con stock conocido.
 *
 * Actualizado por 2.1 (reserva de stock con vencimiento): el checkout ya no
 * descuenta stock_quantity real — reserva (stock_reserved). Las aserciones
 * de acá se movieron a ese campo; lo que se prueba (un solo efecto, no dos)
 * es lo mismo.
 */

describe('Idempotencia del checkout — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  async function createTestProduct(stock: number): Promise<number> {
    const res = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Idempotencia QA ${Date.now()}-${Math.random()}`,
      price: 3000,
      stock_quantity: stock,
      show_in_store: true,
      active: true,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  it('dos POST secuenciales con la misma Idempotency-Key devuelven el mismo pedido y descuentan stock una sola vez', async () => {
    productId = await createTestProduct(10);
    const key = randomUUID();
    const body = {
      customerName: 'Robot QA Idem Secuencial',
      customerEmail: `qa-idem-seq+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 3 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    };

    const first = await api().post(`${API}/store/checkout`).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    const firstOrderId = first.body.data?.order?.id;
    expect(firstOrderId).toBeTruthy();

    const second = await api().post(`${API}/store/checkout`).set('Idempotency-Key', key).send(body);
    expect(second.status).toBe(201);
    const secondOrderId = second.body.data?.order?.id;

    expect(secondOrderId).toBe(firstOrderId); // mismo pedido, no uno nuevo

    const product = await CatalogProduct.findByPk(productId);
    expect(product!.stock_reserved).toBe(3); // una sola reserva de 3
  });

  it('dos POST concurrentes con la misma Idempotency-Key crean un solo pedido y un solo descuento', async () => {
    productId = await createTestProduct(10);
    const key = randomUUID();
    const body = {
      customerName: 'Robot QA Idem Concurrente',
      customerEmail: `qa-idem-conc+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 4 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    };

    const [r1, r2] = await Promise.all([
      api().post(`${API}/store/checkout`).set('Idempotency-Key', key).send(body),
      api().post(`${API}/store/checkout`).set('Idempotency-Key', key).send(body),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const id1 = r1.body.data?.order?.id;
    const id2 = r2.body.data?.order?.id;
    expect(id1).toBeTruthy();
    expect(id1).toBe(id2); // ambos requests resuelven al mismo pedido

    const product = await CatalogProduct.findByPk(productId);
    expect(product!.stock_reserved).toBe(4); // una sola reserva de 4 (no 8)
  });

  it('sin Idempotency-Key, dos POST idénticos crean dos pedidos distintos (comportamiento sin cambios)', async () => {
    productId = await createTestProduct(10);
    const body = {
      customerName: 'Robot QA Sin Idem',
      customerEmail: `qa-no-idem+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    };

    const first = await api().post(`${API}/store/checkout`).send(body);
    const second = await api().post(`${API}/store/checkout`).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data?.order?.id).not.toBe(second.body.data?.order?.id);

    const product = await CatalogProduct.findByPk(productId);
    expect(product!.stock_reserved).toBe(4); // 2 + 2, dos reservas distintas
  });
});
