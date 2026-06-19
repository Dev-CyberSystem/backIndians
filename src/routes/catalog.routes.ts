import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import { upload } from '../middlewares/upload';
import * as ctrl from '../controllers/catalog.controller';

const router = Router();

// Webhook de MercadoPago — sin autenticación (llamado por MP directamente)
router.post('/webhook/mp', ctrl.mpWebhook);

router.use(authenticate);

// ─── Productos del catálogo ───────────────────────────────────────────────────

// GET /catalog/products?client_id=&page=&limit=
router.get('/products', ctrl.listProducts);

// GET /catalog/products/client/:clientId
router.get(
  '/products/client/:clientId',
  [param('clientId').isInt({ min: 1 }), validate],
  ctrl.listClientProducts
);

// GET /catalog/products/:id
router.get(
  '/products/:id',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getProduct
);

// POST /catalog/products
router.post(
  '/products',
  authorize('admin', 'billing'),
  [
    body('client_id').isInt({ min: 1 }).withMessage('Cliente requerido'),
    body('title').notEmpty().withMessage('Título requerido'),
    body('price').isFloat({ min: 0 }).withMessage('Precio inválido'),
    validate,
  ],
  ctrl.createProduct
);

// PUT /catalog/products/:id
router.put(
  '/products/:id',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('title').optional().notEmpty(),
    body('price').optional().isFloat({ min: 0 }),
    validate,
  ],
  ctrl.updateProduct
);

// DELETE /catalog/products/:id
router.delete(
  '/products/:id',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteProduct
);

// PATCH /catalog/products/:id/stock — ajustar stock manualmente (solo para productos sin talles)
router.patch(
  '/products/:id/stock',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('stock_quantity').isInt({ min: 0 }).withMessage('Stock debe ser un número entero mayor o igual a 0'),
    validate,
  ],
  ctrl.adjustProductStock
);

// PUT /catalog/products/:id/sizes — guardar/reemplazar todos los talles del producto
router.put(
  '/products/:id/sizes',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('sizes').isArray().withMessage('sizes debe ser un array'),
    body('sizes.*.size_name').notEmpty().withMessage('Nombre de talle requerido'),
    body('sizes.*.stock_quantity').isInt({ min: 0 }).withMessage('Stock de talle inválido'),
    validate,
  ],
  ctrl.saveProductSizes
);

// ─── Imágenes de producto ─────────────────────────────────────────────────────

// POST /catalog/products/:id/images (máx 1 imagen por llamada, máx 3 por producto)
router.post(
  '/products/:id/images',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), validate],
  upload.single('image'),
  ctrl.uploadProductImage
);

// DELETE /catalog/products/:id/images/:imageId
router.delete(
  '/products/:id/images/:imageId',
  authorize('admin', 'billing'),
  [param('id').isInt({ min: 1 }), param('imageId').isInt({ min: 1 }), validate],
  ctrl.deleteProductImage
);

// ─── Pedidos del catálogo ─────────────────────────────────────────────────────

// GET /catalog/invoices?status=&client_id=&seller_id=&date_from=&date_to=&page=&limit=
router.get(
  '/invoices',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['draft', 'issued', 'paid', 'cancelled']),
    query('client_id').optional().isInt({ min: 1 }),
    query('seller_id').optional().isInt({ min: 1 }),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    validate,
  ],
  ctrl.listCatalogInvoices
);

// GET /catalog/orders?client_id=&seller_id=&status=&page=&limit=
router.get(
  '/orders',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    validate,
  ],
  ctrl.listCatalogOrders
);

// GET /catalog/orders/:id
router.get(
  '/orders/:id',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getCatalogOrder
);

// POST /catalog/orders
router.post(
  '/orders',
  authorize('admin', 'billing', 'seller'),
  [
    body('client_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('payment_type').isIn(['full', 'half']).withMessage('Tipo de pago inválido'),
    body('items').isArray({ min: 1 }).withMessage('Se requiere al menos un ítem'),
    body('items.*.product_id').isInt({ min: 1 }),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Cantidad mínima: 1'),
    body('items.*.size_name').optional({ nullable: true }).isString(),
    validate,
  ],
  ctrl.createCatalogOrder
);

// PATCH /catalog/orders/:id/status
router.patch(
  '/orders/:id/status',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['created', 'invoice_created', 'delivered']).withMessage('Estado inválido'),
    validate,
  ],
  ctrl.updateCatalogOrderStatus
);

// POST /catalog/orders/:id/payment — genera/regenera la preferencia de MP
router.post(
  '/orders/:id/payment',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.initiateCatalogPayment
);

// ─── Facturas del catálogo ────────────────────────────────────────────────────

// GET /catalog/orders/:id/invoice
router.get(
  '/orders/:id/invoice',
  [param('id').isInt({ min: 1 }), validate],
  ctrl.getCatalogInvoice
);

// PATCH /catalog/orders/:id/invoice/status
router.patch(
  '/orders/:id/invoice/status',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('status').isIn(['draft', 'issued', 'paid', 'cancelled']).withMessage('Estado de factura inválido'),
    validate,
  ],
  ctrl.updateCatalogInvoiceStatus
);

// POST /catalog/orders/:id/invoice/payments
router.post(
  '/orders/:id/invoice/payments',
  authorize('admin', 'billing'),
  [
    param('id').isInt({ min: 1 }),
    body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a 0'),
    body('notes').optional().isString(),
    validate,
  ],
  ctrl.addCatalogInvoicePayment
);

// POST /catalog/orders/:id/invoice/images
router.post(
  '/orders/:id/invoice/images',
  [param('id').isInt({ min: 1 }), validate],
  upload.single('image'),
  ctrl.uploadInvoiceImage
);

// DELETE /catalog/orders/:id/invoice/images/:imageId
router.delete(
  '/orders/:id/invoice/images/:imageId',
  [param('id').isInt({ min: 1 }), param('imageId').isInt({ min: 1 }), validate],
  ctrl.deleteInvoiceImage
);

export default router;
