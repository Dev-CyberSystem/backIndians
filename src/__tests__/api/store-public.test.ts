import { api, API, asProductList } from './helpers';

/*
 * Smoke de los endpoints públicos de la tienda. Verifican que respondan y que
 * tengan la forma esperada ({ success, data }). No asumen que haya productos
 * cargados (la tienda puede estar vacía), salvo donde se indica.
 */

describe('Tienda pública — API', () => {
  it('GET /health responde ok', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /store/settings devuelve la configuración de la tienda', async () => {
    const res = await api().get(`${API}/store/settings`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it('GET /store/products lista productos visibles', async () => {
    const res = await api().get(`${API}/store/products`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(asProductList(res.body))).toBe(true);
  });

  it('GET /store/products/filters devuelve opciones de filtro', async () => {
    const res = await api().get(`${API}/store/products/filters`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /store/promo-popup responde (cupón o null)', async () => {
    const res = await api().get(`${API}/store/promo-popup`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /store/orders/:n/status con pedido inexistente NO da 200', async () => {
    const res = await api().get(`${API}/store/orders/NO-EXISTE-${Date.now()}/status`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /store/coupons/validate con código inválido NO acredita descuento', async () => {
    const res = await api()
      .post(`${API}/store/coupons/validate`)
      .send({ code: `INVALIDO-${Date.now()}`, subtotal: 10000 });
    // Puede responder 400 (rechazo) o 200 con valid:false según implementación
    if (res.status === 200) {
      expect(res.body?.data?.valid ?? false).toBe(false);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});
