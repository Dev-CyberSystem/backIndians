import { api, API, loginAs, auth } from './helpers';
import { Settings } from '../../models';
import { invalidateCache } from '../../utils/cache';
import { hasBankTransferConfigured } from '../../services/store.service';

/*
 * Contrato de medios de pago del checkout de tienda (R-02 de la auditoría del
 * 2026-08-19).
 *
 * El commit que desactivó el pago en efectivo cambió el validador de
 * `payment_method` sin dejar ningún test que fijara el nuevo contrato: los 17
 * archivos que usaban 'cash' pasaron a fallar y nada verificaba lo que sí
 * tenía que pasar. Este archivo es esa red — si mañana alguien reactiva
 * 'cash' en `store.routes.ts`, tiene que romper acá y no en producción.
 *
 * La segunda mitad cubre B-02: con el efectivo desactivado, la transferencia es
 * uno de los dos únicos medios de pago, y en producción se ofrecía con CBU,
 * alias y titular VACÍOS. El comprador creaba el pedido, reservaba stock y
 * terminaba en una pantalla con un mensaje dirigido al administrador.
 */

describe('Medios de pago aceptados por POST /store/checkout', () => {
  let admin: string;
  let productId: number;

  function checkoutBody(paymentMethod: string) {
    return {
      accept_terms: true,
      customerName: 'Robot QA Medios de Pago',
      customerEmail: `qa-medios+${Date.now()}-${Math.random()}@test.local`,
      customerPhone: '1100000000',
      items: [{ catalog_product_id: productId, size_name: null, quantity: 1 }],
      shipping_type: 'pickup',
      payment_method: paymentMethod,
    };
  }

  beforeAll(async () => {
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(admin));
    const clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;

    const product = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId,
      title: `Producto Medios de Pago QA ${Date.now()}-${Math.random()}`,
      price: 5000,
      stock_quantity: 50,
      show_in_store: true,
      active: true,
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  it("rechaza payment_method: 'cash' con 422 — el pago en efectivo está desactivado", async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('cash'));
    expect(res.status).toBe(422);
  });

  it('rechaza un medio de pago inventado con 422', async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('bitcoin'));
    expect(res.status).toBe(422);
  });

  it("acepta 'bank_transfer' (con datos bancarios configurados)", async () => {
    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('bank_transfer'));
    expect(res.status).toBe(201);
  });

  it('un checkout rechazado no deja stock reservado', async () => {
    const before = await api().get(`${API}/store/products/${productId}`);
    const reservedBefore = Number(before.body.data?.stock_reserved ?? 0);

    const res = await api().post(`${API}/store/checkout`).send(checkoutBody('cash'));
    expect(res.status).toBe(422);

    const after = await api().get(`${API}/store/products/${productId}`);
    expect(Number(after.body.data?.stock_reserved ?? 0)).toBe(reservedBefore);
  });

  // ─── B-02: transferencia sin datos bancarios cargados ──────────────────────

  describe('transferencia bancaria sin datos configurados', () => {
    const bancarias = ['bank_transfer_cbu', 'bank_transfer_alias', 'bank_transfer_holder'];
    const originales = new Map<string, string>();

    beforeAll(async () => {
      for (const key of bancarias) {
        const row = await Settings.findByPk(key);
        originales.set(key, row?.value ?? '');
        const now = new Date();
        await Settings.upsert({ key, value: '', createdAt: now, updatedAt: now });
      }
      invalidateCache('store:settings');
    });

    afterAll(async () => {
      for (const [key, value] of originales) {
        const now = new Date();
        await Settings.upsert({ key, value, createdAt: now, updatedAt: now });
      }
      invalidateCache('store:settings');
    });

    it('el predicado dice que no está configurado', () => {
      expect(hasBankTransferConfigured({})).toBe(false);
      expect(hasBankTransferConfigured({ bank_transfer_cbu: '', bank_transfer_alias: '   ' })).toBe(false);
      // El titular solo no alcanza: no se puede transferir a un nombre.
      expect(hasBankTransferConfigured({ bank_transfer_holder: 'Indians Textil' })).toBe(false);
      // Con CBU o con alias, sí.
      expect(hasBankTransferConfigured({ bank_transfer_cbu: '0000003100010000000001' })).toBe(true);
      expect(hasBankTransferConfigured({ bank_transfer_alias: 'INDIANS.TEXTIL' })).toBe(true);
    });

    it('el checkout rechaza el pedido en vez de crearlo y reservar stock', async () => {
      const antes = await api().get(`${API}/store/products/${productId}`);
      const reservadoAntes = Number(antes.body.data?.stock_reserved ?? 0);

      const res = await api().post(`${API}/store/checkout`).send(checkoutBody('bank_transfer'));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/transferencia/i);

      // Lo que hacía daño no era el error: era el pedido creado con stock
      // reservado que nadie iba a pagar nunca.
      const despues = await api().get(`${API}/store/products/${productId}`);
      expect(Number(despues.body.data?.stock_reserved ?? 0)).toBe(reservadoAntes);
    });

    it('MercadoPago sigue disponible — la falta de datos bancarios no cierra la tienda entera', async () => {
      const res = await api().post(`${API}/store/checkout`).send(checkoutBody('mercadopago'));
      expect(res.status).toBe(201);
    });

    it('el endpoint público de settings devuelve las tres claves vacías, para que el front pueda ocultar la opción', async () => {
      invalidateCache('store:settings');
      const res = await api().get(`${API}/store/settings`);
      const settings = (res.body?.data ?? res.body) as Record<string, string>;
      expect(hasBankTransferConfigured(settings)).toBe(false);
    });
  });
});
