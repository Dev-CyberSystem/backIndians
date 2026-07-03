import { api, API, loginAdmin, auth } from './helpers';
import { sequelize } from '../../config/db';
import { StoreEvent } from '../../models/StoreEvent';
import { StoreCustomer } from '../../models/StoreCustomer';
import { StoreCartReminder } from '../../models/StoreCartReminder';
import { CatalogProduct } from '../../models/CatalogProduct';

/*
 * Robot de pruebas de Audiencia + Carritos abandonados.
 *
 * Estrategia: sembramos un cliente con un `cart_add` "viejo" (5 h atrás, para
 * superar el umbral de 3 h) sin compra posterior, ejercitamos los endpoints
 * admin y verificamos el flujo completo: aparece en la lista → se envía el
 * email (mockeado) → deja de aparecer por el dedup. Limpia todo al final.
 *
 * Requiere MySQL migrado + seeders (admin) — como el resto de la suite API.
 */

// No enviar emails reales: mockeamos solo el envío de recupero.
jest.mock('../../utils/email.service', () => {
  const actual = jest.requireActual('../../utils/email.service');
  return { __esModule: true, ...actual, sendAbandonedCartEmail: jest.fn().mockResolvedValue(undefined) };
});

const SESSION = `test-abandoned-${Date.now()}`;
const EMAIL = `robot-cart-${Date.now()}@test.local`;

describe('Tienda — Audiencia y carritos abandonados', () => {
  let token: string;
  let customerId: number | null = null;
  let productId: number | null = null;

  beforeAll(async () => {
    token = await loginAdmin();

    const product = await CatalogProduct.findOne({ attributes: ['id'] });
    productId = product?.id ?? null;

    const customer = await StoreCustomer.create({
      name: 'Robot Carrito',
      email: EMAIL,
      email_verified: true,
      active: true,
    });
    customerId = customer.id;

    if (productId) {
      // cart_add backdateado 5 h (supera MIN_AGE_MINUTES=180 y entra en la ventana
      // de 30 d). Forzamos createdAt con SQL crudo: Sequelize puede pisar el valor
      // pasado a create() con la fecha actual (timestamps automáticos).
      const ev = await StoreEvent.create({
        session_id: SESSION,
        customer_id: customerId,
        event_type: 'cart_add',
        product_id: productId,
        device_type: 'desktop',
      });
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      await sequelize.query('UPDATE store_events SET createdAt = :d WHERE id = :id', {
        replacements: { d: fiveHoursAgo, id: ev.id },
      });
    }
  });

  afterAll(async () => {
    if (customerId) {
      await StoreCartReminder.destroy({ where: { customer_id: customerId } });
      await StoreEvent.destroy({ where: { session_id: SESSION } });
      await StoreCustomer.destroy({ where: { id: customerId } });
    }
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  it('GET /store/admin/audience sin token → 401', async () => {
    const res = await api().get(`${API}/store/admin/audience`);
    expect(res.status).toBe(401);
  });

  it('GET /store/admin/abandoned-carts sin token → 401', async () => {
    const res = await api().get(`${API}/store/admin/abandoned-carts`);
    expect(res.status).toBe(401);
  });

  // ── Audiencia ─────────────────────────────────────────────────────────────
  it('GET /store/admin/audience devuelve la forma esperada', async () => {
    const res = await api().get(`${API}/store/admin/audience`).set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    for (const key of ['units_sold', 'unique_buyers', 'registered_customers', 'new_customers', 'unique_visits', 'avg_session_seconds', 'sessions_measured']) {
      expect(typeof d[key]).toBe('number');
    }
    expect(Array.isArray(d.units_daily)).toBe(true);
    expect(Array.isArray(d.units_monthly)).toBe(true);
    // Creamos al menos un cliente registrado en el setup
    expect(d.registered_customers).toBeGreaterThanOrEqual(1);
  });

  it('GET /store/admin/audience acepta período YYYY-MM', async () => {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const res = await api().get(`${API}/store/admin/audience?period=${period}`).set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.units_monthly).toBeDefined();
  });

  // ── Carritos abandonados (flujo completo) ────────────────────────────────────
  it('el cliente sembrado aparece en la lista de carritos abandonados', async () => {
    if (!productId) return; // sin catálogo no se puede sembrar el carrito
    const res = await api().get(`${API}/store/admin/abandoned-carts`).set(...auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const mine = res.body.data.find((c: any) => c.customer.id === customerId);
    expect(mine).toBeDefined();
    expect(mine.customer.email).toBe(EMAIL);
    expect(mine.products.length).toBeGreaterThanOrEqual(1);
    expect(mine.products[0]).toHaveProperty('title');
    expect(mine.products[0]).toHaveProperty('price');
  });

  it('POST enviar recupero responde OK y registra el recordatorio', async () => {
    if (!productId) return;
    const res = await api()
      .post(`${API}/store/admin/abandoned-carts/${customerId}/send`)
      .set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const reminder = await StoreCartReminder.findOne({ where: { customer_id: customerId! } });
    expect(reminder).not.toBeNull();
  });

  it('tras enviar, el carrito ya no aparece (dedup)', async () => {
    if (!productId) return;
    const res = await api().get(`${API}/store/admin/abandoned-carts`).set(...auth(token));
    expect(res.status).toBe(200);
    const mine = res.body.data.find((c: any) => c.customer.id === customerId);
    expect(mine).toBeUndefined();
  });

  it('enviar recupero a un cliente sin carrito → 400', async () => {
    // El cliente ya fue "recordado" y no tiene carrito pendiente nuevo
    const res = await api()
      .post(`${API}/store/admin/abandoned-carts/${customerId}/send`)
      .set(...auth(token));
    expect(res.status).toBe(400);
  });
});
