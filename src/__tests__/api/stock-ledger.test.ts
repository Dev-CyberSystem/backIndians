import { api, API, loginAs, auth } from './helpers';
import { CatalogStockMovement } from '../../models/CatalogStockMovement';

/*
 * Ledger de stock (1.2 / C-5): verifica que las tres rutas que tocan
 * catalog_products.stock_quantity — ajuste manual del admin, pedido mayorista
 * de catálogo y checkout de la tienda online — dejen un movimiento auditable
 * en catalog_stock_movements con cantidad anterior/resultante correctas, y que
 * el chequeo de stock insuficiente siga funcionando (409, sin movimiento).
 *
 * Usa un producto propio SIN talles (creado en beforeAll) para tener stock
 * conocido y determinístico — no depende de datos preexistentes.
 */

async function lastMovement(productId: number) {
  return CatalogStockMovement.findOne({
    where: { catalog_product_id: productId },
    order: [['id', 'DESC']],
  });
}

describe('Ledger de stock (catalog_stock_movements) — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const create = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Ledger QA ${Date.now()}`,
      price: 5000,
      stock_quantity: 20,
      show_in_store: true,
      active: true,
    });
    expect(create.status).toBe(201);
    productId = create.body.data?.id;
    expect(productId).toBeTruthy();
  });

  it('el ajuste manual de stock del admin deja un movimiento adjustment/manual', async () => {
    const res = await api()
      .patch(`${API}/catalog/products/${productId}/stock`)
      .set(...auth(admin))
      .send({ stock_quantity: 15 });
    expect(res.status).toBe(200);
    expect(Number(res.body.data?.stock_quantity)).toBe(15);

    const movement = await lastMovement(productId);
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('adjustment');
    expect(movement!.source).toBe('manual');
    expect(movement!.previous_quantity).toBe(20);
    expect(movement!.new_quantity).toBe(15);
    expect(movement!.user_id).not.toBeNull();
  });

  it('un pedido mayorista deja un movimiento sale/catalog con catalog_order_id', async () => {
    const before = 15;
    const sale = await api().post(`${API}/catalog/orders`).set(...auth(admin)).send({
      client_id: clientId,
      payment_type: 'full',
      items: [{ product_id: productId, quantity: 3 }],
    });
    expect(sale.status).toBe(201);
    const orderId = sale.body.data?.id;
    expect(orderId).toBeTruthy();

    const movement = await lastMovement(productId);
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('sale');
    expect(movement!.source).toBe('catalog');
    expect(movement!.previous_quantity).toBe(before);
    expect(movement!.new_quantity).toBe(before - 3);
    expect(movement!.catalog_order_id).toBe(orderId);
  });

  it('un pedido mayorista sin stock suficiente no descuenta ni deja movimiento nuevo', async () => {
    const before = await lastMovement(productId);
    const res = await api().post(`${API}/catalog/orders`).set(...auth(admin)).send({
      client_id: clientId,
      payment_type: 'full',
      items: [{ product_id: productId, quantity: 999 }],
    });
    // El chequeo previo (no atómico, solo UX) rechaza con 400 antes de llegar
    // a la transacción/ledger — igual que antes de este refactor.
    expect(res.status).toBe(400);

    const after = await lastMovement(productId);
    expect(after?.id).toBe(before?.id); // no se creó ningún movimiento nuevo
  });

  it('el checkout de la tienda (transferencia) deja un movimiento reserve/store con store_order_id (2.1: reserva, no descuenta todavía)', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      accept_terms: true,
      customerName: 'Robot QA Ledger',
      customerEmail: `qa-ledger+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'pickup',
      payment_method: 'bank_transfer',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data?.order ?? checkout.body.data;
    expect(order?.order_number).toBeTruthy();

    const movement = await lastMovement(productId);
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('reserve');
    expect(movement!.source).toBe('store');
    expect(movement!.previous_quantity).toBe(0);
    expect(movement!.new_quantity).toBe(2);
    expect(movement!.store_order_id).not.toBeNull();
  });
});
