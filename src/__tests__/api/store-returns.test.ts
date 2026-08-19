import { api, API, loginAs, auth } from './helpers';
import { CatalogStockMovement } from '../../models/CatalogStockMovement';
import { CatalogProduct } from '../../models/CatalogProduct';
import { StoreOrder } from '../../models/StoreOrder';

/*
 * Circuito de devoluciones con revisión (2.4 — decisión de negocio #4:
 * "requiere revisión, nunca automático"). Solo el admin inicia devoluciones
 * (decisión confirmada); la revisión es por ítem (resellable/not_resellable).
 * Usa un producto propio para tener stock determinístico.
 */

describe('Devoluciones con revisión — 2.4', () => {
  let admin: string;
  let clientId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  async function createDeliveredOrder(stock: number, quantity: number): Promise<{ orderId: number; productId: number; orderItemId: number }> {
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Devolucion QA ${Date.now()}-${Math.random()}`,
      price: 5000,
      stock_quantity: stock,
      show_in_store: true,
      active: true,
    });
    const productId = product.body.data.id;

    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Devolucion',
      customerEmail: `qa-devolucion+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    const orderId = checkout.body.data.order.id;

    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'paid' });
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'processing' });
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({
      status: 'shipped', tracking_number: 'QA123', courier_name: 'Correo QA',
    });
    await api().patch(`${API}/store/admin/orders/${orderId}/status`).set(...auth(admin)).send({ status: 'delivered' });

    const detail = await api().get(`${API}/store/admin/orders/${orderId}`).set(...auth(admin));
    const orderItemId = detail.body.data.items[0].id;

    return { orderId, productId, orderItemId };
  }

  it('el admin registra una devolución: el pedido pasa a "returned" y no toca stock todavía', async () => {
    const { orderId, orderItemId } = await createDeliveredOrder(10, 3);

    const res = await api()
      .post(`${API}/store/admin/orders/${orderId}/returns`)
      .set(...auth(admin))
      .send({ reason: 'Talle incorrecto', items: [{ store_order_item_id: orderItemId, quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending_review');
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(2);
    expect(res.body.data.items[0].condition).toBeNull();

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.status).toBe('returned');
  });

  it('aprobar con ítem resellable restituye stock real (movimiento return); rechazar no toca nada', async () => {
    const { orderId, productId, orderItemId } = await createDeliveredOrder(10, 3);

    const created = await api()
      .post(`${API}/store/admin/orders/${orderId}/returns`)
      .set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 2 }] });
    const returnId = created.body.data.id;
    const returnItemId = created.body.data.items[0].id;

    const productBefore = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));

    const review = await api()
      .patch(`${API}/store/admin/returns/${returnId}/review`)
      .set(...auth(admin))
      .send({ status: 'approved', items: [{ id: returnItemId, condition: 'resellable' }] });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('approved');

    const productAfter = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfter.body.data.stock_quantity)).toBe(Number(productBefore.body.data.stock_quantity) + 2);

    const movement = await CatalogStockMovement.findOne({
      where: { catalog_product_id: productId, type: 'return' },
      order: [['id', 'DESC']],
    });
    expect(movement).not.toBeNull();
    expect(movement!.quantity).toBe(2);
    expect(movement!.source).toBe('store');
  });

  it('aprobar con ítem NOT resellable no restituye stock', async () => {
    const { orderId, productId, orderItemId } = await createDeliveredOrder(10, 3);
    const created = await api()
      .post(`${API}/store/admin/orders/${orderId}/returns`)
      .set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    const returnId = created.body.data.id;
    const returnItemId = created.body.data.items[0].id;

    const productBefore = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    const stockBefore = Number(productBefore.body.data.stock_quantity);

    const review = await api()
      .patch(`${API}/store/admin/returns/${returnId}/review`)
      .set(...auth(admin))
      .send({ status: 'approved', items: [{ id: returnItemId, condition: 'not_resellable' }] });
    expect(review.status).toBe(200);

    const productAfter = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfter.body.data.stock_quantity)).toBe(stockBefore); // sin cambios
  });

  it('rechazar una devolución no toca stock y queda con status rejected', async () => {
    const { orderId, productId, orderItemId } = await createDeliveredOrder(10, 2);
    const created = await api()
      .post(`${API}/store/admin/orders/${orderId}/returns`)
      .set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    const returnId = created.body.data.id;

    const productBefore = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    const stockBefore = Number(productBefore.body.data.stock_quantity);

    const review = await api()
      .patch(`${API}/store/admin/returns/${returnId}/review`)
      .set(...auth(admin))
      .send({ status: 'rejected', review_notes: 'Fuera del plazo de cambio' });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('rejected');

    const productAfter = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfter.body.data.stock_quantity)).toBe(stockBefore);
  });

  it('no se puede registrar una devolución sobre un pedido que no está entregado', async () => {
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId, title: `Producto QA ${Date.now()}`, price: 3000, stock_quantity: 5, show_in_store: true, active: true,
    });
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA No Entregado', customerEmail: `qa-noentregado+${Date.now()}@test.local`,
      customerPhone: '1100000000', items: [{ catalog_product_id: product.body.data.id, size_name: null, quantity: 1 }],
      shipping_type: 'pickup', payment_method: 'cash',
    });
    const orderId = checkout.body.data.order.id;
    const detail = await api().get(`${API}/store/admin/orders/${orderId}`).set(...auth(admin));
    const orderItemId = detail.body.data.items[0].id;

    const res = await api()
      .post(`${API}/store/admin/orders/${orderId}/returns`)
      .set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    expect(res.status).toBe(409);
  });

  it('el endpoint genérico de cambio de estado ya no permite pasar directo a "returned"', async () => {
    const { orderId } = await createDeliveredOrder(5, 1);
    const res = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'returned' });
    expect(res.status).toBe(409); // reemplazado por POST /returns (2.4)
  });

  it('el reintegro es solo informativo — actualizar refund_status no dispara nada externo, solo se guarda', async () => {
    const { orderId, orderItemId } = await createDeliveredOrder(5, 1);
    const created = await api()
      .post(`${API}/store/admin/orders/${orderId}/returns`)
      .set(...auth(admin))
      .send({ items: [{ store_order_item_id: orderItemId, quantity: 1 }] });
    const returnId = created.body.data.id;

    const res = await api()
      .patch(`${API}/store/admin/returns/${returnId}/refund`)
      .set(...auth(admin))
      .send({ refund_status: 'refunded', refunded_amount: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.data.refund_status).toBe('refunded');
    expect(Number(res.body.data.refunded_amount)).toBe(5000);
    expect(res.body.data.refunded_at).not.toBeNull();
  });
});
