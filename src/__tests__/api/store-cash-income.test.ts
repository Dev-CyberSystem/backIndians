import { api, API, loginAs, auth } from './helpers';
import * as mpService from '../../services/mercadopago.service';
import { confirmStorePayment } from '../../services/store.service';
import { CashTransaction } from '../../models/CashTransaction';
import { User } from '../../models/User';

/*
 * Registro automático del ingreso en caja al confirmarse un pago de la
 * tienda (2.3 — cierra C-7 para el circuito de cobros). Usa un producto y
 * cuenta propios; restaura el setting `store_cash_account_id` original al
 * terminar para no dejar basura en la DB de dev.
 */

describe('Ingreso en caja al confirmar el pago de un pedido de tienda — 2.3', () => {
  let admin: string;
  let clientId: number;
  let accountId: number;
  let adminUserId: number;
  let originalCashAccountSetting: string | undefined;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const me = await api().get(`${API}/auth/me`).set(...auth(admin));
    adminUserId = me.body.data?.id;
    expect(adminUserId).toBeTruthy();

    const accounts = await api().get(`${API}/cash/accounts`).set(...auth(admin));
    const accountsList = accounts.body.data?.rows ?? accounts.body.data;
    accountId = accountsList[0].id;
    expect(accountId).toBeTruthy();

    const currentSettings = await api().get(`${API}/settings`).set(...auth(admin));
    originalCashAccountSetting = currentSettings.body.data?.store_cash_account_id;

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: String(accountId),
    });
  });

  afterAll(async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: originalCashAccountSetting ?? '',
    });
  });

  async function createTestProduct(): Promise<number> {
    const res = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Caja QA ${Date.now()}-${Math.random()}`,
      price: 6000,
      stock_quantity: 10,
      show_in_store: true,
      active: true,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  it('el admin marca un pedido en efectivo como pagado a mano: se crea el ingreso en caja atribuido a él', async () => {
    const productId = await createTestProduct();
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA Caja',
      customerEmail: `qa-caja+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 2 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order ?? checkout.body.data;

    const markPaid = await api()
      .patch(`${API}/store/admin/orders/${order.id}/status`)
      .set(...auth(admin))
      .send({ status: 'paid' });
    expect(markPaid.status).toBe(200);

    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('income');
    expect(Number(tx!.amount)).toBe(Number(order.total_amount));
    expect(tx!.account_id).toBe(accountId);
    expect(tx!.created_by).toBe(adminUserId); // lo confirmó un admin humano
  });

  it('un pago confirmado automáticamente (webhook/reconciliación) se atribuye al usuario Sistema', async () => {
    const productId = await createTestProduct();
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA Caja Sistema',
      customerEmail: `qa-caja-sistema+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'mercadopago',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order ?? checkout.body.data;

    jest.spyOn(mpService, 'searchPaymentsByReference').mockResolvedValue([{
      id: 12345, status: 'approved', external_reference: order.order_number,
      transaction_amount: order.total_amount, currency_id: 'ARS',
      date_approved: new Date().toISOString(), date_last_updated: new Date().toISOString(),
    }]);

    const result = await confirmStorePayment({ orderNumber: order.order_number });
    expect(result.status).toBe('paid');

    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).not.toBeNull();

    const systemUser = await User.findOne({ where: { email: 'sistema@indians.internal' } });
    expect(tx!.created_by).toBe(systemUser!.id);

    jest.restoreAllMocks();
  });

  it('sin cuenta de caja configurada, confirmar el pago no falla — solo no crea el asiento', async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({ store_cash_account_id: '' });

    const productId = await createTestProduct();
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA Caja Sin Cuenta',
      customerEmail: `qa-caja-sin-cuenta+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order ?? checkout.body.data;

    const markPaid = await api()
      .patch(`${API}/store/admin/orders/${order.id}/status`)
      .set(...auth(admin))
      .send({ status: 'paid' });
    expect(markPaid.status).toBe(200); // el pago se confirma igual

    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).toBeNull(); // no se creó nada, sin cuenta configurada

    // Restaurar la cuenta para no afectar otros tests de este archivo si
    // llegaran a correr después (orden de ejecución de Jest en el mismo archivo).
    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: String(accountId),
    });
  });
});
