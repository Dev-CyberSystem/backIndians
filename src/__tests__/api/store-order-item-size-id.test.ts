import { api, API, loginAs, auth } from './helpers';
import { StoreOrderItem } from '../../models/StoreOrderItem';
import { CatalogProductSize } from '../../models/CatalogProductSize';
import { CatalogStockMovement } from '../../models/CatalogStockMovement';

/*
 * catalog_product_size_id en store_order_items (1.10 / M-8): el checkout
 * tiene que guardar el id del talle (no solo el texto), y la restitución de
 * stock al cancelar tiene que usarlo directo (sin buscar por size_name).
 * Usa un producto propio con talles para tener valores determinísticos.
 */

describe('catalog_product_size_id en store_order_items — API', () => {
  let admin: string;
  let clientId: number;
  let productId: number;
  let sizeMId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Talle QA ${Date.now()}`,
      price: 4000,
      show_in_store: true,
      active: true,
      sizes: [
        { size_name: 'M', stock_quantity: 10 },
        { size_name: 'L', stock_quantity: 5 },
      ],
    });
    expect(product.status).toBe(201);
    productId = product.body.data?.id;
    expect(productId).toBeTruthy();

    const sizeM = await CatalogProductSize.findOne({ where: { product_id: productId, size_name: 'M' } });
    sizeMId = sizeM!.id;
  });

  it('el checkout guarda catalog_product_size_id en el ítem del pedido', async () => {
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA Talle',
      customerEmail: `qa-talle+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: 'M', quantity: 3 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const orderId = checkout.body.data?.order?.id;
    expect(orderId).toBeTruthy();

    const item = await StoreOrderItem.findOne({ where: { store_order_id: orderId } });
    expect(item).not.toBeNull();
    expect(item!.catalog_product_size_id).toBe(sizeMId);

    // Cancelar y verificar que la restitución usa el FK directo: stock del
    // talle M vuelve a 10 y el movimiento queda linkeado a ese talle.
    const cancel = await api()
      .patch(`${API}/store/admin/orders/${orderId}/status`)
      .set(...auth(admin))
      .send({ status: 'cancelled' });
    expect(cancel.status).toBe(200);

    const sizeMAfter = await CatalogProductSize.findByPk(sizeMId);
    expect(sizeMAfter!.stock_quantity).toBe(10);

    const movement = await CatalogStockMovement.findOne({
      where: { catalog_product_size_id: sizeMId, store_order_id: orderId },
      order: [['id', 'DESC']],
    });
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('cancel');
    expect(movement!.previous_quantity).toBe(7); // 10 - 3
    expect(movement!.new_quantity).toBe(10);
  });
});
