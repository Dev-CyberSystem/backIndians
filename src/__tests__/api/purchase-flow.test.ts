import { api, API, findPurchasable } from './helpers';

/*
 * Flujo de compra de punta a punta por API (pago en efectivo, no toca MercadoPago):
 *   encontrar un producto con stock → checkout → consultar estado.
 * Crea un pedido REAL marcado "Robot QA". Si no hay productos con stock, el test
 * se omite con un aviso (no falla).
 */

describe('Flujo de compra — API (efectivo)', () => {
  it('crea un pedido en efectivo y consulta su estado', async () => {
    const target = await findPurchasable();
    if (!target) {
      console.warn('[purchase-flow] Sin productos con stock — test omitido. Corré "npm run seed".');
      return;
    }

    const checkout = await api()
      .post(`${API}/store/checkout`)
      .send({
        customerName: 'Robot QA',
        customerEmail: `qa+${Date.now()}@test.local`,
        customerPhone: '1100000000',
        items: [{ catalog_product_id: target.id, size_name: target.size, quantity: 1 }],
        shipping_type: 'pickup',
        payment_method: 'cash',
      });

    expect(checkout.status).toBe(201);
    const order = checkout.body.data;
    const orderNumber = order.order_number ?? order.order?.order_number ?? order.orderNumber;
    expect(orderNumber).toBeTruthy();

    const status = await api().get(`${API}/store/orders/${orderNumber}/status`);
    expect(status.status).toBe(200);
    expect(status.body.data?.status).toBeTruthy();
  });
});
