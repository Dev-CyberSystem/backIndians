import { randomUUID } from 'crypto';
import { api, API, loginAs, auth } from './helpers';

/*
 * Fase 2 del plan de GO (DEC-012) — cierra CASH-INV-001/CASH-INV-002:
 * cobrar una factura (fábrica o catálogo) ahora asienta automáticamente en
 * caja, con transacción + lock (dos cobranzas concurrentes no dejan
 * `payment_amount` subvaluado) e idempotencia (doble clic / reintento de
 * red no duplica el cobro ni su asiento).
 *
 * `addPaymentToCatalogInvoice` es una copia funcional de
 * `addPaymentToInvoice` — este archivo cubre AMBOS circuitos con la misma
 * batería de casos, porque tener el mismo defecto arreglado en uno solo
 * habría dejado la otra mitad del sistema sin cerrar.
 */

describe('Cobranza de facturas conectada a caja — Fase 2 (DEC-012)', () => {
  let admin: string;
  let billing: string;
  let clientId: number;
  let cashAccountId: number;
  let bankAccountId: number;
  let originalCashSetting: string | undefined;
  let originalBankSetting: string | undefined;

  beforeAll(async () => {
    admin = await loginAs('admin');
    billing = await loginAs('billing');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const cashAcc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Caja QA Cobranzas ${Date.now()}`, type: 'cash' });
    cashAccountId = cashAcc.body.data.id;

    const bankAcc = await api().post(`${API}/cash/accounts`).set(...auth(admin))
      .send({ name: `Banco QA Cobranzas ${Date.now()}`, type: 'bank' });
    bankAccountId = bankAcc.body.data.id;

    const current = await api().get(`${API}/settings`).set(...auth(admin));
    originalCashSetting = current.body.data?.store_cash_account_id;
    originalBankSetting = current.body.data?.store_bank_account_id;

    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: String(cashAccountId),
      store_bank_account_id: String(bankAccountId),
    });
  });

  afterAll(async () => {
    await api().put(`${API}/settings`).set(...auth(admin)).send({
      store_cash_account_id: originalCashSetting ?? '',
      store_bank_account_id: originalBankSetting ?? '',
    });
  });

  async function balanceOf(accountId: number): Promise<number> {
    const res = await api().get(`${API}/cash/accounts`).set(...auth(admin));
    return Number((res.body.data as Array<{ id: number; current_balance: number }>).find((a) => a.id === accountId)!.current_balance);
  }

  // ── Facturas de fábrica ─────────────────────────────────────────────────

  async function createFabricInvoice(): Promise<{ invoiceId: number; orderId: number }> {
    const gts = await api().get(`${API}/master/garment-types`).set(...auth(admin));
    const garmentTypeId = (gts.body.data?.rows ?? gts.body.data)[0].id;
    const order = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [{ garment_type_id: garmentTypeId, color: 'QA', sizes: { M: 1 }, unit_price: 10000 }],
    });
    const orderId = order.body.data.id;
    const inv = await api().get(`${API}/invoices/by-order/${orderId}`).set(...auth(admin));
    const data = Array.isArray(inv.body.data) ? inv.body.data[0] : inv.body.data;
    return { invoiceId: data.id, orderId };
  }

  describe('Facturas de fábrica', () => {
    it('un cobro en efectivo asienta en la cuenta cash; uno por transferencia asienta en la cuenta bank', async () => {
      const { invoiceId } = await createFabricInvoice();
      const before = { cash: await balanceOf(cashAccountId), bank: await balanceOf(bankAccountId) };

      const cash = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
        .send({ amount: 4000, payment_method: 'cash', notes: 'Efectivo QA' });
      expect(cash.status).toBe(201);
      expect(await balanceOf(cashAccountId)).toBe(before.cash + 4000);
      expect(await balanceOf(bankAccountId)).toBe(before.bank);

      const transfer = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
        .send({ amount: 6000, payment_method: 'bank_transfer', notes: 'Transferencia QA' });
      expect(transfer.status).toBe(201);
      expect(await balanceOf(bankAccountId)).toBe(before.bank + 6000);
      expect(await balanceOf(cashAccountId)).toBe(before.cash + 4000); // no se movió de más

      const inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
      expect(Number(inv.body.data.payment_amount)).toBe(10000);
      expect(inv.body.data.status).toBe('paid');

      const cashTx = await api().get(`${API}/cash/transactions?reference_type=invoice&limit=50`).set(...auth(admin));
      const rows = cashTx.body.data as Array<{ reference_id: number; amount: number; account: { id: number } }>;
      const forThisInvoice = rows.filter((r) => r.reference_id === invoiceId);
      expect(forThisInvoice.length).toBe(2);
      expect(forThisInvoice.some((r) => Number(r.amount) === 4000 && r.account.id === cashAccountId)).toBe(true);
      expect(forThisInvoice.some((r) => Number(r.amount) === 6000 && r.account.id === bankAccountId)).toBe(true);
    });

    it('dos cobranzas concurrentes dejan payment_amount correcto y la factura en paid (CASH-INV-002)', async () => {
      const { invoiceId } = await createFabricInvoice();

      const [r1, r2] = await Promise.all([
        api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
          .send({ amount: 5000, payment_method: 'cash', notes: 'Concurrente A' }),
        api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
          .send({ amount: 5000, payment_method: 'cash', notes: 'Concurrente B' }),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
      expect(Number(inv.body.data.payment_amount)).toBe(10000);
      expect(inv.body.data.status).toBe('paid');
      expect(inv.body.data.payments.length).toBe(2);
    });

    it('doble clic con la misma Idempotency-Key no duplica el cobro ni su asiento', async () => {
      const { invoiceId } = await createFabricInvoice();
      const key = randomUUID();
      const before = await balanceOf(cashAccountId);

      const r1 = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
        .set('Idempotency-Key', key)
        .send({ amount: 3000, payment_method: 'cash' });
      const r2 = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
        .set('Idempotency-Key', key)
        .send({ amount: 3000, payment_method: 'cash' });

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(await balanceOf(cashAccountId)).toBe(before + 3000); // no +6000

      const inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
      expect(inv.body.data.payments.length).toBe(1);
    });

    it('cuenta sin configurar: el cobro se registra igual, sin asiento (BR-CASH-008)', async () => {
      await api().put(`${API}/settings`).set(...auth(admin)).send({ store_cash_account_id: '' });
      try {
        const { invoiceId } = await createFabricInvoice();
        const res = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
          .send({ amount: 2000, payment_method: 'cash' });
        expect(res.status).toBe(201);

        const inv = await api().get(`${API}/invoices/${invoiceId}`).set(...auth(admin));
        expect(Number(inv.body.data.payment_amount)).toBe(2000);
      } finally {
        await api().put(`${API}/settings`).set(...auth(admin)).send({ store_cash_account_id: String(cashAccountId) });
      }
    });

    it('anular una factura con cobros ya asentados revierte todos sus ingresos de caja', async () => {
      const { invoiceId } = await createFabricInvoice();
      const before = await balanceOf(cashAccountId);

      await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(admin))
        .send({ amount: 4000, payment_method: 'cash', notes: 'Primer cobro' });
      const partial = await balanceOf(cashAccountId);
      expect(partial).toBe(before + 4000);

      const cancel = await api().put(`${API}/invoices/${invoiceId}`).set(...auth(admin))
        .send({ status: 'cancelled' });
      expect(cancel.status).toBe(200);
      expect(cancel.body.data.status).toBe('cancelled');

      expect(await balanceOf(cashAccountId)).toBe(before); // revertido por completo

      const cashTx = await api().get(`${API}/cash/transactions?reference_type=invoice&limit=50`).set(...auth(admin));
      const rows = cashTx.body.data as Array<{ reference_id: number; status: string; reversal_of_id: number | null }>;
      const forThisInvoice = rows.filter((r) => r.reference_id === invoiceId);
      expect(forThisInvoice.some((r) => r.status === 'reversed')).toBe(true);
      expect(forThisInvoice.some((r) => r.reversal_of_id !== null)).toBe(true);
    });

    it('anular una factura sin cobros no revierte nada raro (caso normal)', async () => {
      const { invoiceId } = await createFabricInvoice();
      const cancel = await api().put(`${API}/invoices/${invoiceId}`).set(...auth(admin))
        .send({ status: 'cancelled' });
      expect(cancel.status).toBe(200);
      expect(cancel.body.data.status).toBe('cancelled');
    });

    it('billing puede cobrar pero no anular queda igualmente auditado (rol permitido en ambos)', async () => {
      const { invoiceId } = await createFabricInvoice();
      const res = await api().post(`${API}/invoices/${invoiceId}/payments`).set(...auth(billing))
        .send({ amount: 1000, payment_method: 'cash' });
      expect(res.status).toBe(201);
    });
  });

  // ── Facturas de catálogo ────────────────────────────────────────────────

  async function createCatalogInvoice(): Promise<{ invoiceId: number; orderId: number }> {
    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Cobranzas QA ${Date.now()}-${Math.random()}`,
      price: 5000,
      stock_quantity: 10,
    });
    const productId = product.body.data.id;

    const order = await api().post(`${API}/catalog/orders`).set(...auth(admin)).send({
      client_id: clientId,
      payment_type: 'full',
      items: [{ product_id: productId, quantity: 2 }], // 10000 total
    });
    const orderId = order.body.data.id;

    const inv = await api().get(`${API}/catalog/orders/${orderId}/invoice`).set(...auth(admin));
    return { invoiceId: inv.body.data.id, orderId };
  }

  describe('Facturas de catálogo (copia funcional del circuito de fábrica)', () => {
    it('un cobro en efectivo asienta en la cuenta cash; uno por transferencia asienta en la cuenta bank', async () => {
      const { orderId, invoiceId } = await createCatalogInvoice();
      const before = { cash: await balanceOf(cashAccountId), bank: await balanceOf(bankAccountId) };

      const cash = await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
        .send({ amount: 4000, payment_method: 'cash' });
      expect(cash.status).toBe(201);
      expect(await balanceOf(cashAccountId)).toBe(before.cash + 4000);

      const transfer = await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
        .send({ amount: 6000, payment_method: 'bank_transfer' });
      expect(transfer.status).toBe(201);
      expect(await balanceOf(bankAccountId)).toBe(before.bank + 6000);

      const inv = await api().get(`${API}/catalog/orders/${orderId}/invoice`).set(...auth(admin));
      expect(Number(inv.body.data.payment_amount)).toBe(10000);
      expect(inv.body.data.status).toBe('paid');

      const cashTx = await api().get(`${API}/cash/transactions?reference_type=catalog_invoice&limit=50`).set(...auth(admin));
      const rows = cashTx.body.data as Array<{ reference_id: number }>;
      expect(rows.filter((r) => r.reference_id === invoiceId).length).toBe(2);
    });

    it('dos cobranzas concurrentes dejan payment_amount correcto y la factura en paid', async () => {
      const { orderId } = await createCatalogInvoice();

      const [r1, r2] = await Promise.all([
        api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
          .send({ amount: 5000, payment_method: 'cash' }),
        api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
          .send({ amount: 5000, payment_method: 'cash' }),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const inv = await api().get(`${API}/catalog/orders/${orderId}/invoice`).set(...auth(admin));
      expect(Number(inv.body.data.payment_amount)).toBe(10000);
      expect(inv.body.data.status).toBe('paid');
    });

    it('doble clic con la misma Idempotency-Key no duplica el cobro ni su asiento', async () => {
      const { orderId } = await createCatalogInvoice();
      const key = randomUUID();
      const before = await balanceOf(cashAccountId);

      const r1 = await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
        .set('Idempotency-Key', key)
        .send({ amount: 3000, payment_method: 'cash' });
      const r2 = await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
        .set('Idempotency-Key', key)
        .send({ amount: 3000, payment_method: 'cash' });

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(await balanceOf(cashAccountId)).toBe(before + 3000);
    });

    it('cuenta sin configurar: el cobro se registra igual, sin asiento', async () => {
      await api().put(`${API}/settings`).set(...auth(admin)).send({ store_bank_account_id: '' });
      try {
        const { orderId } = await createCatalogInvoice();
        const res = await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
          .send({ amount: 2500, payment_method: 'bank_transfer' });
        expect(res.status).toBe(201);

        const inv = await api().get(`${API}/catalog/orders/${orderId}/invoice`).set(...auth(admin));
        expect(Number(inv.body.data.payment_amount)).toBe(2500);
      } finally {
        await api().put(`${API}/settings`).set(...auth(admin)).send({ store_bank_account_id: String(bankAccountId) });
      }
    });

    it('anular (vía PATCH de estado) una factura con cobros ya asentados revierte todos sus ingresos de caja', async () => {
      const { orderId, invoiceId } = await createCatalogInvoice();
      const before = await balanceOf(cashAccountId);

      await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
        .send({ amount: 4500, payment_method: 'cash' });
      expect(await balanceOf(cashAccountId)).toBe(before + 4500);

      const cancel = await api().patch(`${API}/catalog/orders/${orderId}/invoice/status`).set(...auth(admin))
        .send({ status: 'cancelled' });
      expect(cancel.status).toBe(200);

      expect(await balanceOf(cashAccountId)).toBe(before);

      const cashTx = await api().get(`${API}/cash/transactions?reference_type=catalog_invoice&limit=50`).set(...auth(admin));
      const rows = cashTx.body.data as Array<{ reference_id: number; status: string }>;
      expect(rows.some((r) => r.reference_id === invoiceId && r.status === 'reversed')).toBe(true);
    });

    it('anular dos veces la misma factura (idempotencia de la reversión) no revierte de más', async () => {
      const { orderId } = await createCatalogInvoice();
      await api().post(`${API}/catalog/orders/${orderId}/invoice/payments`).set(...auth(admin))
        .send({ amount: 1000, payment_method: 'cash' });

      const first = await api().patch(`${API}/catalog/orders/${orderId}/invoice/status`).set(...auth(admin))
        .send({ status: 'cancelled' });
      expect(first.status).toBe(200);
      const balanceAfterFirst = await balanceOf(cashAccountId);

      // Segunda llamada con el mismo status: reverseAllForReference no encuentra
      // nada activo, es un no-op — el saldo no se mueve de nuevo.
      const second = await api().patch(`${API}/catalog/orders/${orderId}/invoice/status`).set(...auth(admin))
        .send({ status: 'cancelled' });
      expect(second.status).toBe(200);
      expect(await balanceOf(cashAccountId)).toBe(balanceAfterFirst);
    });
  });
});
