import { api, API, loginAs, auth } from './helpers';
import * as mpService from '../../services/mercadopago.service';
import { confirmStorePayment } from '../../services/store.service';
import { CashTransaction } from '../../models/CashTransaction';
import { User } from '../../models/User';

/*
 * Registro automático del ingreso al confirmarse el pago de un pedido de
 * tienda (2.3 — cierra C-7 para el circuito de cobros).
 *
 * Desde la Fase 3 del plan de corrección de caja (cierra CASH-PAY-002), la
 * cuenta destino depende del medio de pago: `cash` va a una cuenta física
 * (`store_cash_account_id`), `mercadopago`/`bank_transfer` van a una cuenta
 * bancaria separada (`store_bank_account_id`) — nunca se mezclan. Usa
 * cuentas propias; restaura los settings originales al terminar para no
 * dejar basura en la DB de dev.
 */

describe('Ingreso en caja/banco al confirmar el pago de un pedido de tienda — 2.3 / Fase 3', () => {
  let admin: string;
  let clientId: number;
  let cashAccountId: number;
  let bankAccountId: number;
  let adminUserId: number;
  let originalCashAccountSetting: string | undefined;
  let originalBankAccountSetting: string | undefined;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const me = await api().get(`${API}/auth/me`).set(...auth(admin));
    adminUserId = me.body.data?.id;
    expect(adminUserId).toBeTruthy();

    const cashAcc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja QA Fase3 ${Date.now()}`, type: 'cash' });
    cashAccountId = cashAcc.body.data.id;

    const bankAcc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Banco QA Fase3 ${Date.now()}`, type: 'bank' });
    bankAccountId = bankAcc.body.data.id;

    const currentSettings = await api().get(`${API}/settings`).set(...auth(admin));
    originalCashAccountSetting = currentSettings.body.data?.store_cash_account_id;
    originalBankAccountSetting = currentSettings.body.data?.store_bank_account_id;

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: String(cashAccountId),
      store_bank_account_id: String(bankAccountId),
    });
  });

  afterAll(async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: originalCashAccountSetting ?? '',
      store_bank_account_id: originalBankAccountSetting ?? '',
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

  async function checkoutAndPay(paymentMethod: 'cash' | 'mercadopago' | 'bank_transfer', label: string) {
    const productId = await createTestProduct();
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: `Robot QA ${label}`,
      customerEmail: `qa-${label.toLowerCase().replace(/\s+/g, '-')}+${Date.now()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: paymentMethod,
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body.data.order ?? checkout.body.data;

    const markPaid = await api()
      .patch(`${API}/store/admin/orders/${order.id}/status`)
      .set(...auth(admin))
      .send({ status: 'paid' });
    expect(markPaid.status).toBe(200);

    return order;
  }

  it('un pedido pagado en efectivo genera el ingreso en la cuenta de CAJA, atribuido al admin que lo confirmó', async () => {
    const order = await checkoutAndPay('cash', 'Efectivo');

    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('income');
    expect(Number(tx!.amount)).toBe(Number(order.total_amount));
    expect(tx!.account_id).toBe(cashAccountId); // NUNCA la cuenta bancaria
    expect(tx!.created_by).toBe(adminUserId);
  });

  it('un pedido pagado por MercadoPago genera el ingreso en la cuenta BANCARIA, nunca en la de caja física (CASH-PAY-002)', async () => {
    const productId = await createTestProduct();
    const checkout = await api().post(`${API}/store/checkout`).send({
      customerName: 'Robot QA MercadoPago',
      customerEmail: `qa-mp+${Date.now()}@test.local`,
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
    expect(tx!.account_id).toBe(bankAccountId); // la clave del hallazgo: NO la cuenta cash
    expect(tx!.account_id).not.toBe(cashAccountId);

    const systemUser = await User.findOne({ where: { email: 'sistema@indians.internal' } });
    expect(tx!.created_by).toBe(systemUser!.id); // confirmado automáticamente (webhook/reconciliación)

    jest.restoreAllMocks();
  });

  it('un pedido pagado por transferencia bancaria también va a la cuenta BANCARIA', async () => {
    const order = await checkoutAndPay('bank_transfer', 'Transferencia');

    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).not.toBeNull();
    expect(tx!.account_id).toBe(bankAccountId);
  });

  it('sin cuenta de caja configurada, un pago en efectivo no falla — solo no crea el asiento (y el pago por MP sigue funcionando)', async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({ store_cash_account_id: '' });

    const order = await checkoutAndPay('cash', 'Sin Cuenta Caja');
    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).toBeNull(); // no se creó nada, sin cuenta de caja configurada

    // La cuenta bancaria sigue configurada — un pago no-efectivo no se ve afectado.
    const bankOrder = await checkoutAndPay('bank_transfer', 'Sin Cuenta Caja Pero Banco Ok');
    const bankTx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: bankOrder.id },
    });
    expect(bankTx).not.toBeNull();
    expect(bankTx!.account_id).toBe(bankAccountId);

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: String(cashAccountId),
    });
  });

  it('sin cuenta bancaria configurada, un pago por MercadoPago no falla — solo no crea el asiento', async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({ store_bank_account_id: '' });

    const order = await checkoutAndPay('mercadopago', 'Sin Cuenta Banco');
    // 'paid' vía PATCH admin (no vía confirmStorePayment acá) también dispara el intento de asiento.
    const tx = await CashTransaction.findOne({
      where: { reference_type: 'store_order', reference_id: order.id },
    });
    expect(tx).toBeNull();

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_bank_account_id: String(bankAccountId),
    });
  });

  it('rechaza configurar una cuenta de tipo incorrecto en cada setting', async () => {
    const rejectCash = await api().put(`${API}/settings`).set(...auth(admin))
      .send({ store_cash_account_id: String(bankAccountId) }); // banco en el slot de caja
    expect(rejectCash.status).toBe(400);

    const rejectBank = await api().put(`${API}/settings`).set(...auth(admin))
      .send({ store_bank_account_id: String(cashAccountId) }); // caja en el slot de banco
    expect(rejectBank.status).toBe(400);

    // Los settings no deben haber cambiado tras el rechazo.
    const after = await api().get(`${API}/settings`).set(...auth(admin));
    expect(after.body.data.store_cash_account_id).toBe(String(cashAccountId));
    expect(after.body.data.store_bank_account_id).toBe(String(bankAccountId));
  });
});
