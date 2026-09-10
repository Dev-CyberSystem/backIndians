import { api, API, loginAs, auth } from './helpers';
import { Invoice, OrderItem } from '../../models';
import { cloudinary, deleteImage } from '../../config/cloudinary';

// Solo la persistencia es real: ningún adjunto sale a Cloudinary durante los tests.
jest.mock('../../config/cloudinary', () => ({
  cloudinary: { uploader: {
    upload_stream: jest.fn((_options, callback) => ({
      end: () => callback(null, { secure_url: 'https://example.invalid/size-chart.png', public_id: 'qa-designer' }),
    })),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
  } },
  deleteImage: jest.fn().mockResolvedValue(undefined),
}));

/*
 * Perfil Diseñador (`designer`). Carga pedidos con la ficha técnica completa y
 * los manda al taller, pero nunca ve costos de producción ni facturación al
 * cliente (mismo criterio que el taller con los importes). Cambia estados solo
 * hasta `workshop_review`. Requiere `npm run seed`.
 */

describe('Perfil Diseñador — API', () => {
  let designer: string;
  let admin: string;
  let clientId: number;
  let garmentTypeId: number;

  beforeAll(async () => {
    designer = await loginAs('designer');
    admin = await loginAs('admin');
    const clients = await api().get(`${API}/clients`).set(...auth(designer));
    clientId = (clients.body.data?.rows ?? clients.body.data)[0].id;
    const gts = await api().get(`${API}/master/garment-types`).set(...auth(designer));
    garmentTypeId = (gts.body.data?.rows ?? gts.body.data)[0].id;
  });

  async function createOrderAsDesigner() {
    const res = await api().post(`${API}/orders`).set(...auth(designer)).send({
      client_id: clientId,
      items: [{
        garment_type_id: garmentTypeId,
        color: 'Azul',
        sizes: { M: 5 },
        // Aunque mande precio, el backend lo ignora para el diseñador.
        unit_price: 9999,
        fabric_composition: '100% poliéster',
        has_embroidery: true,
        embroidery_notes: 'Escudo pecho izquierdo',
      }],
    });
    return res;
  }

  it('crea un pedido con ficha técnica completa, sin vendedor y sin precios', async () => {
    const res = await createOrderAsDesigner();
    expect(res.status).toBe(201);
    const order = res.body.data;
    expect(order.status).toBe('pending');
    expect(order.seller_id ?? null).toBeNull();
    // Precios anulados en la respuesta al diseñador.
    expect(Number(order.total_amount)).toBe(0);
    expect(order.items[0].unit_price ?? null).toBeNull();
    // La ficha técnica sí se guardó.
    expect(order.items[0].embroidery_notes).toBe('Escudo pecho izquierdo');

    // Pero para billing el pedido quedó realmente en $0 (no es que se oculte).
    const asBilling = await loginAs('billing');
    const seen = await api().get(`${API}/orders/${order.id}`).set(...auth(asBilling));
    expect(Number(seen.body.data.total_amount)).toBe(0);
  });

  it('puede llevar el pedido hasta el taller pero no operar los controles', async () => {
    const { body } = await createOrderAsDesigner();
    const id = body.data.id;

    const toReview = await api().put(`${API}/orders/${id}`).set(...auth(designer))
      .send({ status: 'under_review', status_comment: 'Ficha lista' });
    expect(toReview.status).toBe(200);

    const toWorkshop = await api().put(`${API}/orders/${id}`).set(...auth(designer))
      .send({ status: 'workshop_review', status_comment: 'Va al taller' });
    expect(toWorkshop.status).toBe(200);

    // No puede iniciar el primer control de producción.
    const denied = await api().put(`${API}/orders/${id}`).set(...auth(designer))
      .send({ status: 'raw_material_control', status_comment: 'no permitido' });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(denied.status).toBeLessThan(500);
  });

  it('no puede editar la ficha una vez que el pedido está en el taller', async () => {
    const { body } = await createOrderAsDesigner();
    const id = body.data.id;
    await api().put(`${API}/orders/${id}`).set(...auth(designer)).send({ status: 'under_review' });
    await api().put(`${API}/orders/${id}`).set(...auth(designer)).send({ status: 'workshop_review' });

    const edit = await api().put(`${API}/orders/${id}`).set(...auth(designer)).send({
      items: [{ garment_type_id: garmentTypeId, color: 'Rojo', sizes: { L: 3 } }],
    });
    expect(edit.status).toBe(403);
  });

  it('ve todos los pedidos (no solo los suyos) y sin importes', async () => {
    await createOrderAsDesigner();
    const list = await api().get(`${API}/orders`).set(...auth(designer));
    expect(list.status).toBe(200);
    const rows = list.body.data?.rows ?? list.body.data;
    expect(Array.isArray(rows)).toBe(true);
    for (const o of rows) expect(Number(o.total_amount)).toBe(0);
  });

  it('no ve facturación al cliente ni costos ni el dashboard', async () => {
    for (const path of ['/invoices', '/costs/items?category=jersey', '/dashboard/summary']) {
      const res = await api().get(`${API}${path}`).set(...auth(designer));
      expect([401, 403]).toContain(res.status);
    }
  });

  it('ve el catálogo pero sin precios', async () => {
    const created = await api().post(`${API}/catalog/products`).set(...auth(admin)).send({
      client_id: clientId, title: 'QA diseñador precios', price: 5000, public_price: 9000, discount_percentage: 10,
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    for (const path of [`/catalog/products/${productId}`, `/catalog/products/client/${clientId}`, `/catalog/products?client_id=${clientId}&limit=100`]) {
      const res = await api().get(`${API}${path}`).set(...auth(designer));
      expect(res.status).toBe(200);
      const product = Array.isArray(res.body.data) ? res.body.data.find((p: any) => p.id === productId) : res.body.data;
      expect(product).toBeDefined();
      expect(product.price).toBeNull();
      expect(product.public_price).toBeNull();
      expect(product.discount_percentage).toBeNull();
    }
    const allowed = await api().get(`${API}/catalog/products/${productId}`).set(...auth(admin));
    expect(Number(allowed.body.data.price)).toBe(5000);
    expect(Number(allowed.body.data.public_price)).toBe(9000);
    const baseProducts = await api().get(`${API}/products`).set(...auth(designer));
    expect(baseProducts.status).toBe(200);
    expect(baseProducts.body.data.length).toBeGreaterThan(0);
    for (const p of baseProducts.body.data) expect(p.base_price).toBeNull();
  });

  it('bloquea toda la superficie comercial del catálogo antes de operar', async () => {
    for (const path of ['/catalog/invoices', '/catalog/orders', '/catalog/orders/1', '/catalog/orders/1/invoice']) {
      expect((await api().get(`${API}${path}`).set(...auth(designer))).status).toBe(403);
    }
    for (const path of ['/catalog/orders/1/payment', '/catalog/orders/1/payment/refresh', '/catalog/orders/1/invoice/images']) {
      expect((await api().post(`${API}${path}`).set(...auth(designer))).status).toBe(403);
    }
    expect((await api().delete(`${API}/catalog/orders/1/invoice/images/1`).set(...auth(designer))).status).toBe(403);
    expect((await api().get(`${API}/catalog/invoices`).set(...auth(admin))).status).toBe(200);
  });

  async function pricedOrder() {
    const res = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [{ garment_type_id: garmentTypeId, color: 'Azul', sizes: { M: 5 }, unit_price: 5000 }],
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  const technicalItem = (id: number, quantity = 5) => ({
    id, garment_type_id: garmentTypeId, color: 'Rojo', sizes: { M: quantity }, unit_price: 1,
  });

  it('conserva ID, precio, importe y tabla de talles al corregir una ficha cotizada', async () => {
    const order = await pricedOrder();
    const itemId = order.items[0].id;
    await OrderItem.update({ size_chart_image_url: 'https://example.invalid/original.png', size_chart_cloudinary_id: 'original' }, { where: { id: itemId } });
    const res = await api().put(`${API}/orders/${order.id}`).set(...auth(designer))
      .send({ items: [technicalItem(itemId)] });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].unit_price).toBeNull();
    expect(Number(res.body.data.total_amount)).toBe(0);
    const seen = await api().get(`${API}/orders/${order.id}`).set(...auth(admin));
    expect(seen.body.data.items[0].id).toBe(itemId);
    expect(Number(seen.body.data.items[0].unit_price)).toBe(5000);
    expect(Number(seen.body.data.total_amount)).toBe(25000);
    expect(seen.body.data.items[0].color).toBe('Rojo');
    expect(seen.body.data.items[0].size_chart_image_url).toContain('original.png');
    expect(Number((await Invoice.findOne({ where: { order_id: order.id } }))!.total_amount)).toBe(25000);
  });

  it('rechaza IDs omitidos, ajenos o repetidos y revierte también el cambio de estado', async () => {
    const order = await pricedOrder();
    const other = await pricedOrder();
    for (const items of [
      [{ garment_type_id: garmentTypeId, color: 'Rojo', sizes: { M: 5 } }],
      [technicalItem(other.items[0].id)],
      [technicalItem(order.items[0].id), technicalItem(order.items[0].id)],
    ]) {
      expect((await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({ status: 'under_review', items })).status).toBe(409);
      const seen = await api().get(`${API}/orders/${order.id}`).set(...auth(admin));
      expect(seen.body.data.status).toBe('pending');
      expect(Number(seen.body.data.total_amount)).toBe(25000);
    }
  });

  it('al reordenar conserva el precio de cada ID y rechaza cantidades inválidas', async () => {
    const created = await api().post(`${API}/orders`).set(...auth(admin)).send({
      client_id: clientId,
      items: [
        { garment_type_id: garmentTypeId, color: 'Primero', sizes: { M: 1 }, unit_price: 4000 },
        { garment_type_id: garmentTypeId, color: 'Segundo', sizes: { M: 2 }, unit_price: 7000 },
      ],
    });
    expect(created.status).toBe(201);
    const order = created.body.data;
    const response = await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({
      items: [technicalItem(order.items[1].id, 2), technicalItem(order.items[0].id, 1)],
    });
    expect(response.status).toBe(200);
    expect(Number((await OrderItem.findByPk(order.items[0].id))!.unit_price)).toBe(4000);
    expect(Number((await OrderItem.findByPk(order.items[1].id))!.unit_price)).toBe(7000);
    expect((await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({
      items: [{ ...technicalItem(order.items[0].id), sizes: {} }, technicalItem(order.items[1].id, 2)],
    })).status).toBe(422);
  });

  it('agrega ítems sin precio y exige borrado explícito; recalcula la factura borrador', async () => {
    const order = await pricedOrder();
    const added = await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({
      items: [technicalItem(order.items[0].id), { garment_type_id: garmentTypeId, color: 'Nuevo', sizes: { L: 2 }, unit_price: 9999 }],
    });
    expect(added.status).toBe(200);
    const newItem = added.body.data.items.find((item: any) => item.id !== order.items[0].id);
    expect((await OrderItem.findByPk(newItem.id))!.unit_price).toBeNull();
    const removed = await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({
      items: [technicalItem(newItem.id, 2)], deleted_item_ids: [order.items[0].id],
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data.items).toHaveLength(1);
    expect(Number((await Invoice.findOne({ where: { order_id: order.id } }))!.total_amount)).toBe(0);
  });

  it('sincroniza cantidades con extras/descuento y bloquea cambios sobre factura emitida o cobrada', async () => {
    const order = await pricedOrder();
    const invoice = (await Invoice.findOne({ where: { order_id: order.id } }))!;
    await invoice.update({ extra_items: [{ description: 'Extra QA', amount: 1000 }], discount_amount: 500 });
    expect((await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({ items: [technicalItem(order.items[0].id, 6)] })).status).toBe(200);
    await invoice.reload();
    expect(Number(invoice.total_amount)).toBe(30500);
    for (const fields of [{ status: 'issued' as const }, { status: 'draft' as const, payment_amount: 100 }]) {
      await invoice.update(fields);
      expect((await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({ items: [technicalItem(order.items[0].id, 7)] })).status).toBe(409);
      expect((await OrderItem.findByPk(order.items[0].id))!.sizes).toEqual({ M: 6 });
    }
  });

  it('sanitiza la respuesta de tabla de talles y bloquea los cuatro endpoints de adjuntos en taller', async () => {
    const order = await pricedOrder();
    const itemPath = `${API}/orders/${order.id}/items/${order.items[0].id}/size-chart`;
    const uploaded = await api().post(itemPath).set(...auth(designer)).attach('image', Buffer.from('fixture'), 'fixture.png');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.unit_price).toBeNull();
    expect(Number((await OrderItem.findByPk(order.items[0].id))!.unit_price)).toBe(5000);
    const image = await api().post(`${API}/orders/${order.id}/images`).set(...auth(designer)).attach('image', Buffer.from('fixture'), 'fixture.png');
    expect(image.status).toBe(201);
    await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({ status: 'under_review' });
    await api().put(`${API}/orders/${order.id}`).set(...auth(designer)).send({ status: 'workshop_review' });
    jest.clearAllMocks();
    for (const path of [itemPath, `${API}/orders/${order.id}/images`]) {
      expect((await api().post(path).set(...auth(designer)).attach('image', Buffer.from('fixture'), 'fixture.png')).status).toBe(403);
    }
    for (const path of [itemPath, `${API}/orders/${order.id}/images/${image.body.data.id}`]) {
      expect((await api().delete(path).set(...auth(designer))).status).toBe(403);
    }
    expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
    expect((await OrderItem.findByPk(order.items[0].id))!.size_chart_image_url).toContain('size-chart.png');
  });

  it('lee stock pero no puede registrar movimientos', async () => {
    const list = await api().get(`${API}/stock`).set(...auth(designer));
    expect(list.status).toBe(200);

    const move = await api().post(`${API}/stock/movements`).set(...auth(designer))
      .send({ stock_item_id: 1, type: 'in', quantity: 1 });
    expect([401, 403]).toContain(move.status);
  });

  it('no puede crear prendas base ni tocar usuarios', async () => {
    const prod = await api().post(`${API}/products`).set(...auth(designer)).send({ name: 'X', base_price: 1 });
    expect([401, 403]).toContain(prod.status);
    const users = await api().get(`${API}/users`).set(...auth(designer));
    expect([401, 403]).toContain(users.status);
  });
});
