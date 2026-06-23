import { EventEmitter } from 'events';

// Singleton EventEmitter para notificar cambios de productos de la tienda.
// Los handlers SSE se suscriben aquí y emiten eventos a sus clientes respectivos.
export const storeEvents = new EventEmitter();
storeEvents.setMaxListeners(500); // admite muchas conexiones SSE simultáneas
