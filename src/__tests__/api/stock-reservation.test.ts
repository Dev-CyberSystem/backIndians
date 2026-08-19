import { api, API, loginAs, auth } from './helpers';
import { CatalogStockMovement } from '../../models/CatalogStockMovement';
import { StoreOrder } from '../../models/StoreOrder';

/*
 * Reserva de stock con vencimiento (2.1 — Fase 2): el checkout reserva
 * (stock_reserved) en vez de descontar stock_quantity real; el descuento
 * definitivo ocurre recién al confirmarse el pago. Usa un producto propio
 * (fixture en beforeAll) para tener valores determinísticos.
 */

describe('Reserva de stock al hacer checkout — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Reserva QA ${Date.now()}`,
      price: 5000,
      stock_quantity: 5,
      show_in_store: true,
      active: true,
    });
    productId = product.body.data?.id;
    expect(productId).toBeTruthy();
  });

  it('el checkout reserva stock sin descontar stock_quantity real', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Reserva',
      customerEmail: `qa-reserva+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 3 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const orderId = (checkout.body.data?.order ?? checkout.body.data)?.id;
    expect(orderId).toBeTruthy();

    const product = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(product.body.data?.stock_quantity)).toBe(5); // físico sin cambios
    expect(Number(product.body.data?.stock_reserved)).toBe(3);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.stock_reserved_at).not.toBeNull();
    expect(order!.stock_confirmed_at).toBeNull();

    const movement = await CatalogStockMovement.findOne({
      where: { catalog_product_id: productId, store_order_id: orderId },
      order: [['id', 'DESC']],
    });
    expect(movement!.type).toBe('reserve');
    expect(movement!.previous_quantity).toBe(0);
    expect(movement!.new_quantity).toBe(3);
  });

  it('confirmar el pago convierte la reserva en descuento definitivo de stock_quantity', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Confirmar',
      customerEmail: `qa-confirmar+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const orderId = (checkout.body.data?.order ?? checkout.body.data)?.id;

    const productBefore = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    const reservedBefore = Number(productBefore.body.data?.stock_reserved);
    const quantityBefore = Number(productBefore.body.data?.stock_quantity);

    const markPaid = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'paid' });
    expect(markPaid.status).toBe(200);

    const productAfter = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfter.body.data?.stock_reserved)).toBe(reservedBefore - 1);
    expect(Number(productAfter.body.data?.stock_quantity)).toBe(quantityBefore - 1);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.stock_confirmed_at).not.toBeNull();

    const movements = await CatalogStockMovement.findAll({
      where: { catalog_product_id: productId, store_order_id: orderId },
      order: [['id', 'ASC']],
    });
    expect(movements.map((m) => m.type)).toEqual(['reserve', 'release', 'sale']);
  });

  it('cancelar antes de confirmar el pago libera la reserva sin tocar stock_quantity', async () => {
    const productBefore = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    const quantityBefore = Number(productBefore.body.data?.stock_quantity);
    // Baseline relativo, no 0 absoluto: los tests anteriores de este archivo
    // pueden haber dejado reservas propias sin confirmar/cancelar sobre el
    // mismo producto compartido — lo que importa es que ESTE pedido libere
    // exactamente lo que reservó, ni más ni menos.
    const reservedBefore = Number(productBefore.body.data?.stock_reserved);

    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Cancelar Antes',
      customerEmail: `qa-cancelar-antes+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const orderId = (checkout.body.data?.order ?? checkout.body.data)?.id;

    const cancel = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);

    const productAfter = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(productAfter.body.data?.stock_quantity)).toBe(quantityBefore); // físico sin cambios
    expect(Number(productAfter.body.data?.stock_reserved)).toBe(reservedBefore); // vuelve exacto al baseline

    const movements = await CatalogStockMovement.findAll({
      where: { catalog_product_id: productId, store_order_id: orderId },
      order: [['id', 'ASC']],
    });
    expect(movements.map((m) => m.type)).toEqual(['reserve', 'release']);

    const order = await StoreOrder.findByPk(orderId);
    expect(order!.stock_confirmed_at).toBeNull();
    expect(order!.stock_restored_at).not.toBeNull();
  });

  it('un checkout que supera el stock disponible (ya reservado por otro pedido) responde 400', async () => {
    // Producto propio de 2 unidades: el primer checkout reserva las 2, el
    // segundo pide 1 más — stock_quantity todavía dice 2 (no bajó), pero
    // disponible = stock_quantity - stock_reserved = 0. computeOrderTotals
    // detecta esto en el chequeo de disponibilidad (400, "no disponible"),
    // no en el ledger — el 409 del ledger es solo para la carrera real entre
    // el chequeo y la reserva (dos requests simultáneos), cubierta por
    // checkout-idempotency.test.ts.
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Reserva Agotado QA ${Date.now()}`,
      price: 3000,
      stock_quantity: 2,
      show_in_store: true,
      active: true,
    });
    const soldOutProductId = product.body.data?.id;
    expect(soldOutProductId).toBeTruthy();

    const first = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Agota Stock',
      customerEmail: `qa-agota+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: soldOutProductId, size_name: null, quantity: 2 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(first.status).toBe(201);

    const second = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Sin Stock',
      customerEmail: `qa-sinstock+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: soldOutProductId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(second.status).toBe(400);

    const productAfter = await api().get(`${API}/catalog/products/${soldOutProductId}`).set(...auth(admin));
    expect(Number(productAfter.body.data?.stock_quantity)).toBe(2); // físico intacto
    expect(Number(productAfter.body.data?.stock_reserved)).toBe(2); // solo lo del primer pedido
  });
});
