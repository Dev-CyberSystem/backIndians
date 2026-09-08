/*
 * Ventana de expiración de pedidos impagos (BR-STORE-004).
 *
 * `orderExpiresUnpaid()` es lo que decide si la tienda le ADVIERTE al comprador
 * que su pedido se va a cancelar. Tiene que coincidir exactamente con el `where`
 * de `jobs/expireStaleOrders.ts`, que es quien efectivamente cancela: si se
 * separan, el sistema promete una cancelación que no ocurre, o cancela sin haber
 * avisado. Estos tests fijan ese criterio.
 */

import { getOrderExpiryHours, orderExpiresUnpaid } from '../../config/orderExpiry';

describe('getOrderExpiryHours', () => {
  const original = process.env.ORDER_EXPIRY_HOURS;
  afterEach(() => {
    if (original === undefined) delete process.env.ORDER_EXPIRY_HOURS;
    else process.env.ORDER_EXPIRY_HOURS = original;
  });

  it('usa 48hs cuando la variable no está definida', () => {
    delete process.env.ORDER_EXPIRY_HOURS;
    expect(getOrderExpiryHours()).toBe(48);
  });

  it('respeta un valor configurado', () => {
    process.env.ORDER_EXPIRY_HOURS = '24';
    expect(getOrderExpiryHours()).toBe(24);
  });

  it.each(['0', '-5', 'abc', ''])('cae al default con el valor inválido %p', (value) => {
    process.env.ORDER_EXPIRY_HOURS = value;
    expect(getOrderExpiryHours()).toBe(48);
  });
});

describe('orderExpiresUnpaid', () => {
  it('MercadoPago siempre expira', () => {
    expect(orderExpiresUnpaid('mercadopago', false)).toBe(true);
    expect(orderExpiresUnpaid('mercadopago', true)).toBe(true);
  });

  it('transferencia SIN comprobante expira', () => {
    expect(orderExpiresUnpaid('bank_transfer', false)).toBe(true);
  });

  it('transferencia CON comprobante no expira: el comprador ya hizo su parte', () => {
    expect(orderExpiresUnpaid('bank_transfer', true)).toBe(false);
  });

  it('efectivo nunca expira: es pago presencial, no un pago online abandonado', () => {
    expect(orderExpiresUnpaid('cash', false)).toBe(false);
    expect(orderExpiresUnpaid('cash', true)).toBe(false);
  });

  it('un método desconocido o ausente no expira (no cancelar por las dudas)', () => {
    expect(orderExpiresUnpaid(null, false)).toBe(false);
    expect(orderExpiresUnpaid(undefined, false)).toBe(false);
    expect(orderExpiresUnpaid('cripto', false)).toBe(false);
  });
});
