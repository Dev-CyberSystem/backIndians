import {
  isValidStoreTransition,
  statusRequiresShipping,
  STORE_ORDER_TRANSITIONS,
} from '../config/storeOrderFlow';

/*
 * Validación de transiciones de estado de los pedidos de la tienda (pura, sin DB).
 * (Qué estados notifican al comprador se prueba en store-order-emails.test.ts.)
 */

describe('transiciones de estado — tienda', () => {
  it('camino feliz: paid → processing → shipped → delivered', () => {
    expect(isValidStoreTransition('paid', 'processing')).toBe(true);
    expect(isValidStoreTransition('processing', 'shipped')).toBe(true);
    expect(isValidStoreTransition('shipped', 'delivered')).toBe(true);
  });

  it('NO permite retroceder de "delivered" a "processing"', () => {
    expect(isValidStoreTransition('delivered', 'processing')).toBe(false);
  });

  it('NO permite saltear de "paid" directo a "delivered"', () => {
    expect(isValidStoreTransition('paid', 'delivered')).toBe(false);
  });

  it('permite marcar demorado en la etapa correspondiente', () => {
    expect(isValidStoreTransition('processing', 'delayed')).toBe(true);
  });

  it('"returned" ya no es una transición genérica de un click (2.4) — solo se llega vía POST /returns', () => {
    expect(isValidStoreTransition('shipped', 'returned')).toBe(false);
    expect(isValidStoreTransition('delivered', 'returned')).toBe(false);
  });

  it('un pedido cancelado no tiene transiciones salientes', () => {
    expect(STORE_ORDER_TRANSITIONS.cancelled).toEqual([]);
    expect(isValidStoreTransition('cancelled', 'processing')).toBe(false);
  });

  it('solo "shipped" (En camino) exige datos de despacho', () => {
    expect(statusRequiresShipping('shipped')).toBe(true);
    expect(statusRequiresShipping('processing')).toBe(false);
    expect(statusRequiresShipping('delivered')).toBe(false);
  });
});
