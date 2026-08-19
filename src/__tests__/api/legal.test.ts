import { api, API, loginAs, auth } from './helpers';
import { LegalAcceptance } from '../../models/LegalAcceptance';
import { StoreWithdrawalRequest } from '../../models/StoreWithdrawalRequest';
import { StoreOrder } from '../../models/StoreOrder';
import { LEGAL_DOCUMENTS } from '../../config/legalDocs';

/*
 * Textos legales de la tienda: constancia de aceptación y botón de
 * arrepentimiento.
 *
 * Lo que estos tests protegen es lo que se rompe sin ruido: que una compra o
 * un alta puedan concretarse SIN dejar constancia de la aceptación (queda una
 * operación sin respaldo ante un reclamo), y que el botón de arrepentimiento
 * exija algún trámite previo (lo que la Res. 424/2020 prohíbe expresamente).
 */

describe('Legales — aceptación de términos y arrepentimiento', () => {
  let admin: string;
  let clientId: number;

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
  });

  async function createProduct(stock = 5): Promise<number> {
    const res = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Legal QA ${Date.now()}-${Math.random()}`,
      price: 4000,
      stock_quantity: stock,
      show_in_store: true,
      active: true,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  function checkoutBody(productId: number, email: string) {
    return {
      customerName: 'Robot QA Legal',
      customerEmail: email,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: 'cash',
    };
  }

  // ─── Versiones publicadas ──────────────────────────────────────────────────

  it('expone la versión vigente de cada documento legal', async () => {
    const res = await api().get(`${API}/store/legal`);
    expect(res.status).toBe(200);

    const keys = res.body.data.map((d: { key: string }) => d.key).sort();
    expect(keys).toEqual(['privacy', 'terms']);

    const terms = res.body.data.find((d: { key: string }) => d.key === 'terms');
    expect(terms.version).toBe(LEGAL_DOCUMENTS.terms.version);
    expect(terms.path).toBe('/tienda/legal/terminos');
  });

  // ─── Constancia de aceptación ──────────────────────────────────────────────

  it('rechaza el checkout sin aceptación de los términos', async () => {
    const productId = await createProduct();
    const res = await api()
      .post(`${API}/store/checkout`)
      .send(checkoutBody(productId, `qa-legal-sin+${Date.now()}@test.local`));

    expect(res.status).toBe(422);
  });

  it('rechaza el checkout si la aceptación viene en false', async () => {
    const productId = await createProduct();
    const res = await api()
      .post(`${API}/store/checkout`)
      .send({ ...checkoutBody(productId, `qa-legal-false+${Date.now()}@test.local`), accept_terms: false });

    expect(res.status).toBe(422);
  });

  it('deja constancia de T&C y Privacidad al confirmar un pedido', async () => {
    const productId = await createProduct();
    const email = `qa-legal-ok+${Date.now()}@test.local`;

    const checkout = await api()
      .post(`${API}/store/checkout`)
      .send({ ...checkoutBody(productId, email), accept_terms: true });

    expect(checkout.status).toBe(201);
    const orderId: number = checkout.body.data.order.id;

    const rows = await LegalAcceptance.findAll({ where: { store_order_id: orderId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.document).sort()).toEqual(['privacy', 'terms']);

    for (const row of rows) {
      expect(row.context).toBe('checkout');
      expect(row.email).toBe(email.toLowerCase());
      expect(row.version).toBe(LEGAL_DOCUMENTS[row.document].version);
      expect(row.accepted_at).toBeInstanceOf(Date);
    }
  });

  it('rechaza el alta de cuenta sin aceptación de los términos', async () => {
    const res = await api().post(`${API}/store/auth/register`).send({
      name: 'Robot QA Legal',
      email: `qa-legal-reg+${Date.now()}@test.local`,
      password: 'Test1234!',
    });

    expect(res.status).toBe(422);
  });

  // ─── Botón de arrepentimiento (Res. 424/2020) ──────────────────────────────

  it('registra una solicitud de arrepentimiento sin login y devuelve el código', async () => {
    const email = `qa-arrepentimiento+${Date.now()}@test.local`;
    const res = await api().post(`${API}/store/legal/withdrawal`).send({
      customer_name: 'Robot QA Arrepentido',
      customer_email: email,
      reason: 'Prueba automática',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^ARR-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe('received');

    const row = await StoreWithdrawalRequest.findOne({ where: { code: res.body.data.code } });
    expect(row).not.toBeNull();
    expect(row!.customer_email).toBe(email.toLowerCase());
    // Sin pedido informado no se vincula nada, pero la solicitud existe igual.
    expect(row!.store_order_id).toBeNull();
  });

  it('vincula la solicitud al pedido cuando el número informado existe', async () => {
    const productId = await createProduct();
    const email = `qa-arr-pedido+${Date.now()}@test.local`;

    const checkout = await api()
      .post(`${API}/store/checkout`)
      .send({ ...checkoutBody(productId, email), accept_terms: true });
    expect(checkout.status).toBe(201);

    const orderNumber: string = checkout.body.data.order.order_number;

    const res = await api().post(`${API}/store/legal/withdrawal`).send({
      customer_name: 'Robot QA Arrepentido',
      customer_email: email,
      order_number: orderNumber,
    });
    expect(res.status).toBe(201);

    const row = await StoreWithdrawalRequest.findOne({ where: { code: res.body.data.code } });
    const order = await StoreOrder.findOne({ where: { order_number: orderNumber } });
    expect(row!.store_order_id).toBe(order!.id);
  });

  it('acepta la solicitud aunque el número de pedido no exista (no exige trámite previo)', async () => {
    const res = await api().post(`${API}/store/legal/withdrawal`).send({
      customer_name: 'Robot QA Arrepentido',
      customer_email: `qa-arr-inexistente+${Date.now()}@test.local`,
      order_number: 'ECOM-19990101-9999',
    });

    expect(res.status).toBe(201);
    const row = await StoreWithdrawalRequest.findOne({ where: { code: res.body.data.code } });
    expect(row!.store_order_id).toBeNull();
    expect(row!.order_number).toBe('ECOM-19990101-9999');
  });

  it('rechaza la solicitud sin nombre o con email inválido', async () => {
    const sinNombre = await api().post(`${API}/store/legal/withdrawal`).send({
      customer_name: '',
      customer_email: 'valido@test.local',
    });
    expect(sinNombre.status).toBe(422);

    const emailMalo = await api().post(`${API}/store/legal/withdrawal`).send({
      customer_name: 'Robot QA',
      customer_email: 'no-es-un-email',
    });
    expect(emailMalo.status).toBe(422);
  });

  // ─── Panel de gestión ──────────────────────────────────────────────────────

  it('el admin lista las solicitudes y puede cerrarlas', async () => {
    const created = await api().post(`${API}/store/legal/withdrawal`).send({
      customer_name: 'Robot QA Gestion',
      customer_email: `qa-arr-gestion+${Date.now()}@test.local`,
    });
    const code: string = created.body.data.code;

    const list = await api()
      .get(`${API}/store/admin/legal/withdrawals`)
      .query({ search: code })
      .set(...auth(admin));

    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const id: number = list.body.data[0].id;

    const updated = await api()
      .patch(`${API}/store/admin/legal/withdrawals/${id}`)
      .set(...auth(admin))
      .send({ status: 'resolved', admin_notes: 'Reintegrado por transferencia' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('resolved');
    expect(updated.body.data.resolved_at).toBeTruthy();
    expect(updated.body.data.resolved_by).toBeTruthy();
  });

  it('las constancias y las solicitudes no son accesibles sin autenticación de staff', async () => {
    const acceptances = await api().get(`${API}/store/admin/legal/acceptances`);
    expect(acceptances.status).toBe(401);

    const withdrawals = await api().get(`${API}/store/admin/legal/withdrawals`);
    expect(withdrawals.status).toBe(401);
  });

  it('el admin consulta las constancias por email', async () => {
    const productId = await createProduct();
    const email = `qa-constancia+${Date.now()}@test.local`;

    const checkout = await api()
      .post(`${API}/store/checkout`)
      .send({ ...checkoutBody(productId, email), accept_terms: true });
    expect(checkout.status).toBe(201);

    const res = await api()
      .get(`${API}/store/admin/legal/acceptances`)
      .query({ email })
      .set(...auth(admin));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((a: { context: string }) => a.context === 'checkout')).toBe(true);
  });
});
