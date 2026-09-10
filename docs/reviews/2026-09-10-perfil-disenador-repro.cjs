// Diagnóstico aislado: ejecuta código real con persistencia y servicios externos simulados.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../..');
const dep = createRequire(path.join(root, 'package.json'));
const ts = dep('typescript');
function load(file, mocks) {
  const filename = path.join(root, file);
  const local = createRequire(filename);
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})', { filename })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : local(name), module, module.exports);
  return module.exports;
}
class AppError extends Error { constructor(message, status) { super(message); this.statusCode = status; } }
async function main() {
  const order = { id: 17, status: 'under_review', client_id: 1, total_amount: 25000,
    update: async function(v) { Object.assign(this, v); }, setDataValue() {} };
  const item = { id: 4, order_id: 17, unit_price: 5000, update: async function(v) { Object.assign(this,v); } };
  const models = new Proxy({
    Order: { findByPk: async () => order },
    OrderItem: { findAll: async () => [item], findOne: async () => item }
  }, { get: (target,key) => target[key] || {} });
  const service = load('src/services/order.service.ts', {
    '../models': models, '../config/db': { sequelize: { transaction: async cb => cb({ LOCK: { UPDATE: 'UPDATE' } }) } },
    './invoice.service': {}, './cost.service': { buildOrderCostSnapshot: async () => {} },
    '../config/orderChecklists': load('src/config/orderChecklists.ts', {}),
    '../middlewares/errorHandler': { AppError }, '../config/cloudinary': { deleteImage: async () => {} },
    '../config/socket': { getIO: () => { throw Error('disabled'); } }
  });
  await service.updateOrder(17, { items: [{ id: 4, garment_type_id: 1, color: 'Rojo', sizes: { M: 5 } }] }, { id: 9, role: 'designer' });
  assert.equal(order.total_amount, 25000);
  assert.equal(item.unit_price, 5000);
  console.log('PRICE_EDIT: conserva total 25000 y precio 5000');
  order.status = 'workshop_review';
  item.size_chart_image_url = 'fixture.png';
  await assert.rejects(service.deleteItemSizeChart(17,4,{ id:9,role:'designer' }), error => error.statusCode === 403);
  assert.equal(item.size_chart_image_url, 'fixture.png');
  console.log('WORKSHOP_SIZE_CHART_DELETE: 403 y adjunto conservado');
  const controller = load('src/controllers/catalog.controller.ts', {
    '../services/catalog.service': { listAllProducts: async () => ({ products: [{ id:1, price:5000, public_price:9000 }], page:1, limit:20, total:1 }) },
    '../events/storeEvents': {}, '../services/mercadopago.service': {},
    '../services/pricingVisibility': load('src/services/pricingVisibility.ts', {})
  });
  await controller.listProducts({ user: { role:'designer' }, query:{} }, { json: data => {
    assert.equal(data.data[0].price, null);
    assert.equal(data.data[0].public_price, null);
    console.log('DESIGNER_CATALOG_RESPONSE: ambos precios ocultos');
  } }, e => { throw e; });
  const express = dep('express');
  const request = dep('supertest');
  const next = (_req,_res,next) => next();
  const ctrl = new Proxy({}, { get: (_t,key) => (req,res) => res.json({ reachedController: key, role:req.user.role }) });
  const router = load('src/routes/catalog.routes.ts', {
    '../middlewares/auth': { authenticate: (req,res,next) => { req.user = { role:'designer' }; next(); } },
    '../middlewares/authorize': load('src/middlewares/authorize.ts', { './errorHandler':{ AppError } }),
    '../middlewares/validate': { validate:next },
    '../middlewares/rateLimit': { webhookLimiter:next, catalogPaymentRefreshLimiter:next },
    '../middlewares/upload': { upload:{ single:() => next } },
    '../controllers/catalog.controller': ctrl
  }).default;
  const app = express(); app.use(express.json()); app.use(router);
  app.use((err,req,res,next) => res.status(err.statusCode || 500).json({ message:err.message }));
  for (const [method,url] of [['get','/invoices'],['get','/orders'],['get','/orders/1/invoice'],['post','/orders/1/payment'],['delete','/orders/1/invoice/images/1']]) {
    const response = await request(app)[method](url);
    assert.equal(response.status, 403);
    console.log('DESIGNER_ROUTE:', method.toUpperCase(), url, response.status, JSON.stringify(response.body));
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
