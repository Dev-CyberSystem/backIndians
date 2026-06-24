import { api, API, findPurchasable } from './helpers';

/*
 * Integración con MercadoPago (API). Verifica que el checkout con
 * payment_method=mercadopago crea una preference y devuelve un init_point válido.
 *
 * NO completa el pago: crear la preference no genera ningún cobro, solo el link.
 * Requiere MP_ACCESS_TOKEN configurado en el backend. Crea un pedido real
 * (pending_payment) marcado "Robot QA MP".
 */

describe('MercadoPago — API', () => {
  it('checkout con MercadoPago devuelve una preference con init_point', async () => {
    const target = await findPurchasable();
    if (!target) {
      console.warn('[mp] Sin productos con stock — test omitido. Corré "npm run seed".');
      return;
    }

    const res = await api()
      .post(`${API}/store/checkout`)
      .send({
        customerName: 'Robot QA MP',
        customerEmail: `qa-mp+${Date.now()}@test.local`,
        customerPhone: '1100000000',
        items: [{ catalog_product_id: target.id, size_name: target.size, quantity: 1 }],
        shipping_type: 'pickup',
        payment_method: 'mercadopago',
      });

    expect(res.status).toBe(201);
    expect(res.body.data?.payment_method).toBe('mercadopago');
    // init_point es la URL de pago de MercadoPago
    expect(res.body.data?.mp_init_point).toMatch(/mercadopago|mercadolibre/i);
    // y el pedido quedó registrado
    expect(res.body.data?.order?.order_number).toBeTruthy();
  });
});
