/*
 * Plantillas de mail por estado del pedido. Mockeamos el SDK de Resend para
 * inspeccionar el subject/HTML que arma cada plantilla, sin enviar nada real.
 * Cubre el requisito "cada cambio de estado dispara el mail correcto" a nivel de
 * plantilla (la integración con la DB se prueba en api/store-tracking.test.ts).
 */

const mockSend = jest.fn().mockResolvedValue({ data: { id: 'test' }, error: null });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

import { sendStoreOrderStatusEmail } from '../utils/email.service';
import type { StoreOrderStatus } from '../models/StoreOrder';

const BASE = {
  email: 'comprador@test.local',
  name: 'Cliente QA',
  orderNumber: 'ECOM-20260724-0001',
  trackingUrl: 'https://indians.com.ar/tienda/seguimiento/abc123',
};

beforeEach(() => mockSend.mockClear());

describe('sendStoreOrderStatusEmail — subject por estado', () => {
  const cases: Array<[StoreOrderStatus, RegExp]> = [
    ['paid', /pago acreditado/i],
    ['processing', /en preparación/i],
    ['shipped', /en camino/i],
    ['delivered', /entregado/i],
    ['delayed', /demorado/i],
    ['returned', /devuelto/i],
    ['cancelled', /cancelado/i],
  ];

  it.each(cases)('estado "%s" usa el subject correcto e incluye N° de pedido y link', async (status, subjectRe) => {
    await sendStoreOrderStatusEmail({ ...BASE, status });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toMatch(subjectRe);
    expect(arg.subject).toContain(BASE.orderNumber);
    expect(arg.html).toContain(BASE.orderNumber);
    expect(arg.html).toContain(BASE.trackingUrl);
  });

  it('"En camino" incluye transportista y N° de seguimiento', async () => {
    await sendStoreOrderStatusEmail({
      ...BASE,
      status: 'shipped',
      courierName: 'Andreani',
      trackingNumber: 'AR123456789',
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).toContain('Andreani');
    expect(arg.html).toContain('AR123456789');
  });

  it('el estado inicial "pending_payment" NO envía mail', async () => {
    await sendStoreOrderStatusEmail({ ...BASE, status: 'pending_payment' });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
