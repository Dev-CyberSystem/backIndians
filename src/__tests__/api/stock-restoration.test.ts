import { api, API, loginAs, auth } from './helpers';
import { CatalogStockMovement } from '../../models/CatalogStockMovement';
import { StoreOrder } from '../../models/StoreOrder';
import { StoreCoupon } from '../../models/StoreCoupon';
import { sequelize } from '../../config/db';
import { restoreStoreOrderStock } from '../../services/store.service';

/*
 * Restitución de stock y liberación de cupón al cancelar (1.3 / C-1, A-9).
 * Usa un producto y un cupón propios (fixtures creados en beforeAll) para
 * tener valores determinísticos — no depende de datos preexistentes.
 *
 * Actualizado por 2.1 (reserva de stock con vencimiento): desde 2.1, el
 * checkout ya no descuenta stock_quantity real — solo reserva
 * (stock_reserved). El descuento definitivo ocurre al confirmarse el pago
 * (acá, marcando el pedido "paid" a mano, como haría un admin con un pedido
 * en efectivo). Este archivo prueba el camino "se confirmó el pago y después
 * se cancela" (restitución real) — el camino "se cancela antes de pagar"
 * (liberar la reserva) tiene su propio archivo, stock-reservation.test.ts.
 */

describe('Restitución de stock al cancelar — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;
  let couponCode: string;
  let couponId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Restore QA ${Date.now()}`,
      price: 5000,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
    });
    productId = product.body.data?.id;
    expect(productId).toBeTruthy();

    couponCode = `RESTOREQA${Date.now()}`;
    const coupon = await api().post(`${API}/store/admin/coupons`).set(...auth(admin)).send({
      code: couponCode,
      type: 'fixed',
      value: 500,
      max_uses: 5,
    });
    expect(coupon.status).toBe(201);
    couponId = coupon.body.data?.id;
    expect(couponId).toBeTruthy();
  });

  it('cancelar un pedido en efectivo restituye stock y libera el cupón', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Restore',
      customerEmail: `qa-restore+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 4 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
      coupon_code: couponCode,
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data?.order ?? checkout.body.data;
    const orderId = order?.id;
    expect(orderId).toBeTruthy();

    // 2.1: el checkout reserva, no descuenta stock_quantity todavía.
    const productAfterCheckout = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfterCheckout.body.data?.stock_quantity)).toBe(10); // sin cambios
    expect(Number(productAfterCheckout.body.data?.stock_reserved)).toBe(4);

    const couponAfterCheckout = await StoreCoupon.findByPk(couponId);
    expect(couponAfterCheckout!.used_count).toBe(1);

    // Confirmar el pago (admin marca "Pagado" a mano, como con efectivo) —
    // ahí recién se descuenta stock_quantity real (2.1).
    const markPaid = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'paid' });
    expect(markPaid.status).toBe(200);

    const productAfterPaid = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfterPaid.body.data?.stock_quantity)).toBe(6); // 10 - 4
    expect(Number(productAfterPaid.body.data?.stock_reserved)).toBe(0);

    const cancel = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);

    const productAfterCancel = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfterCancel.body.data?.stock_quantity)).toBe(10); // restituido

    const movement = await CatalogStockMovement.findOne({
      where: { catalog_product_id: productId, store_order_id: orderId },
      order: [['id', 'DESC']],
    });
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('cancel');
    expect(movement!.source).toBe('store');
    expect(movement!.previous_quantity).toBe(6);
    expect(movement!.new_quantity).toBe(10);

    const orderRow = await StoreOrder.findByPk(orderId);
    expect(orderRow!.stock_restored_at).not.toBeNull();

    const couponAfterCancel = await StoreCoupon.findByPk(couponId);
    expect(couponAfterCancel!.used_count).toBe(0);
  });

  it('restoreStoreOrderStock es idempotente: llamarla dos veces no duplica la restitución', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Restore Idempotencia',
      customerEmail: `qa-restore-idem+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data?.order ?? checkout.body.data;
    const orderId = order?.id;

    const cancel = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);

    const productAfterFirstCancel = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    const stockAfterFirstCancel = Number(productAfterFirstCancel.body.data?.stock_quantity);

    // Este pedido se cancela sin haber sido pagado nunca: por cada pedido hay
    // 2 movimientos legítimos (reserve al checkout + release al cancelar,
    // 2.1) — lo que probamos acá es que una segunda llamada NO agrega un
    // tercero. Llamada directa a la función (no vía HTTP: la transición
    // cancelled->cancelled ya está bloqueada por STORE_ORDER_TRANSITIONS, así
    // que probamos la idempotencia de la función en sí, que es lo que
    // realmente la protege — no el guard de la transición).
    const movementsBeforeRetry = await CatalogStockMovement.count({
      where: { catalog_product_id: productId, store_order_id: orderId },
    });
    expect(movementsBeforeRetry).toBe(2);

    const orderRow = (await StoreOrder.findByPk(orderId))!;
    await sequelize.transaction((t) =>
      restoreStoreOrderStock(orderRow, 'Reintento QA', null, t)
    );

    const productAfterSecondCall = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfterSecondCall.body.data?.stock_quantity)).toBe(stockAfterFirstCancel); // sin cambios

    const movementsAfterRetry = await CatalogStockMovement.count({
      where: { catalog_product_id: productId, store_order_id: orderId },
    });
    expect(movementsAfterRetry).toBe(movementsBeforeRetry); // no se agregó ninguno nuevo
  });
});
