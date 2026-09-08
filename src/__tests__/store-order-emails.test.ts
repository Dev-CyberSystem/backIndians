/*
 * Plantillas de mail por estado del pedido. Mockeamos el SDK de Resend para
 * inspeccionar el subject/HTML que arma cada plantilla, sin enviar nada real.
 * Cubre el requisito "cada cambio de estado dispara el mail correcto" a nivel de
 * plantilla (la integración con la DB se prueba en api/store-tracking.test.ts).
 */

// El SDK está mockeado (nada sale a la red), pero `mailGuard` corta los envíos
// bajo Jest y los dominios de prueba. Esta variable deja pasar la llamada hasta
// el mock para poder inspeccionar el payload; sólo tiene efecto bajo Jest.
process.env.MAIL_TEST_DELIVER = '1';

const mockSend = jest.fn().mockResolvedValue({ data: { id: 'test' }, error: null });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

import { sendStoreOrderStatusEmail, sendOrderConfirmationEmail } from '../utils/email.service';
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

/*
 * Cancelación por falta de pago: el comprador tiene que poder distinguir cuál de
 * sus pedidos se canceló. El mail genérico "tu pedido fue cancelado" generó
 * quejas reales — gente con dos pedidos abiertos creía que le habían cancelado
 * el que sí había pagado.
 */
describe('sendStoreOrderStatusEmail — cancelación por falta de pago', () => {
  it('con reason "unpaid" el subject y el cuerpo explican el motivo', async () => {
    await sendStoreOrderStatusEmail({ ...BASE, status: 'cancelled', reason: 'unpaid' });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toMatch(/cancelado por falta de pago/i);
    expect(arg.html).toMatch(/no tuvimos novedades del pago/i);
    // El N° de pedido es lo que le permite identificar cuál se canceló.
    expect(arg.html).toContain(BASE.orderNumber);
  });

  it('aclara que los otros pedidos ya pagos no se ven afectados', async () => {
    await sendStoreOrderStatusEmail({ ...BASE, status: 'cancelled', reason: 'unpaid' });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).toMatch(/más de un pedido/i);
    expect(arg.html).toMatch(/no se ve afectado/i);
  });

  it('sin reason mantiene el copy genérico de cancelación', async () => {
    await sendStoreOrderStatusEmail({ ...BASE, status: 'cancelled' });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toMatch(/cancelado/i);
    expect(arg.subject).not.toMatch(/falta de pago/i);
    expect(arg.html).not.toMatch(/no tuvimos novedades del pago/i);
  });
});

/*
 * Advertencia del plazo en el mail de confirmación. El plazo llega por parámetro
 * (lo decide `orderExpiresUnpaid()` en el caller): un pedido que no expira no
 * debe prometer ningún plazo.
 */
describe('sendOrderConfirmationEmail — advertencia de cancelación automática', () => {
  const ITEMS = [{ title: 'Camiseta Titular (M)', qty: 2, price: 48000 }];

  it('con expiryHours advierte el plazo y nombra el pedido', async () => {
    await sendOrderConfirmationEmail(BASE.email, BASE.name, BASE.orderNumber, ITEMS, 48000, 48);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).toMatch(/48 horas/);
    expect(arg.html).toMatch(/se cancela automáticamente/i);
    expect(arg.html).toContain(BASE.orderNumber);
  });

  it('respeta un plazo distinto de 48 (ORDER_EXPIRY_HOURS configurable)', async () => {
    await sendOrderConfirmationEmail(BASE.email, BASE.name, BASE.orderNumber, ITEMS, 48000, 24);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).toMatch(/24 horas/);
    expect(arg.html).not.toMatch(/48 horas/);
  });

  it('sin expiryHours (efectivo) no menciona ningún plazo', async () => {
    await sendOrderConfirmationEmail(BASE.email, BASE.name, BASE.orderNumber, ITEMS, 48000);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).not.toMatch(/se cancela automáticamente/i);
    expect(arg.html).not.toMatch(/horas/);
  });
});
