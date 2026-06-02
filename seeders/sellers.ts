import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { connectDB } from '../src/config/db';
import '../src/models/index';
import { User }               from '../src/models/User';
import { Client }             from '../src/models/Client';
import { GarmentType }        from '../src/models/GarmentType';
import { SizeChart }          from '../src/models/SizeChart';
import { Order }              from '../src/models/Order';
import { OrderItem }          from '../src/models/OrderItem';
import { OrderStatusHistory } from '../src/models/OrderStatusHistory';
import { Invoice }            from '../src/models/Invoice';
import bcrypt from 'bcryptjs';
import type { OrderStatus, InvoiceStatus } from '../src/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(days: number, hourOffset = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hourOffset, 0, 0, 0);
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildSizes(ids: number[]): Record<string, number> {
  const base = ids.slice(0, 4);
  const result: Record<string, number> = {};
  base.forEach(id => { result[String(id)] = 5 + Math.floor(Math.random() * 15); });
  return result;
}

// Historial de estados que lleva a un estado final dado
const STATUS_PATH: Record<string, OrderStatus[]> = {
  pending:        ['pending'],
  under_review:   ['pending', 'under_review'],
  in_production:  ['pending', 'under_review', 'workshop_review', 'in_production'],
  quality_check:  ['pending', 'under_review', 'workshop_review', 'in_production', 'quality_check'],
  ready:          ['pending', 'under_review', 'workshop_review', 'in_production', 'quality_check', 'ready'],
  cancelled:      ['pending', 'cancelled'],
  observed:       ['pending', 'under_review', 'observed'],
};

let orderCounter = 1;
function nextOrderNumber(): string {
  return `SEED-${String(orderCounter++).padStart(4, '0')}`;
}

let invoiceCounter = 1;
function nextInvoiceNumber(): string {
  return `F-SEED-${String(invoiceCounter++).padStart(4, '0')}`;
}

// Estado de factura según estado del pedido
function invoiceStatusFor(orderStatus: string): InvoiceStatus | null {
  if (orderStatus === 'cancelled')    return null;       // sin factura
  if (orderStatus === 'pending')      return null;       // sin factura aún
  if (orderStatus === 'under_review') return 'draft';
  if (orderStatus === 'observed')     return 'draft';
  if (orderStatus === 'in_production') return 'issued';
  if (orderStatus === 'quality_check') return 'issued';
  if (orderStatus === 'ready')        return 'paid';
  return 'draft';
}

// ── Datos de los 5 vendedores ──────────────────────────────────────────────

const SELLERS_DATA = [
  { name: 'Lucas Martínez',    email: 'lucas@textil.com' },
  { name: 'Sofía González',    email: 'sofia@textil.com' },
  { name: 'Martín López',      email: 'martin@textil.com' },
  { name: 'Valentina Torres',  email: 'valentina@textil.com' },
  { name: 'Diego Ramírez',     email: 'diego@textil.com' },
];

// Pedidos a crear por vendedor: [status, días atrás de creación, días hasta entrega, precio unitario]
const ORDER_TEMPLATES: Array<{
  status: keyof typeof STATUS_PATH;
  createdDaysAgo: number;
  deliveryDaysFromNow: number;
  unitPrice: number;
  units: number;
  color: string;
}> = [
  { status: 'ready',         createdDaysAgo: 65, deliveryDaysFromNow: -30, unitPrice: 4500, units: 30, color: 'Azul royal' },
  { status: 'ready',         createdDaysAgo: 50, deliveryDaysFromNow: -15, unitPrice: 6200, units: 20, color: 'Rojo' },
  { status: 'cancelled',     createdDaysAgo: 45, deliveryDaysFromNow: -5,  unitPrice: 3800, units: 15, color: 'Negro' },
  { status: 'in_production', createdDaysAgo: 20, deliveryDaysFromNow: 10,  unitPrice: 5100, units: 25, color: 'Verde botella' },
  { status: 'quality_check', createdDaysAgo: 12, deliveryDaysFromNow: 5,   unitPrice: 7000, units: 18, color: 'Blanco' },
  { status: 'observed',      createdDaysAgo: 10, deliveryDaysFromNow: 15,  unitPrice: 4200, units: 22, color: 'Naranja' },
  { status: 'under_review',  createdDaysAgo: 5,  deliveryDaysFromNow: 20,  unitPrice: 5500, units: 12, color: 'Violeta' },
  { status: 'pending',       createdDaysAgo: 2,  deliveryDaysFromNow: 30,  unitPrice: 3900, units: 35, color: 'Celeste' },
  { status: 'pending',       createdDaysAgo: 1,  deliveryDaysFromNow: 45,  unitPrice: 6800, units: 28, color: 'Amarillo' },
];

// ── Seeder principal ───────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeder de vendedores con pedidos...\n');

  await connectDB();

  // Obtener admin para created_by / changed_by
  const admin = await User.findOne({ where: { role: 'admin' } });
  if (!admin) {
    console.error('❌ No hay usuario admin. Ejecutá primero: npm run seed');
    process.exit(1);
  }

  // Obtener clientes
  const clients = await Client.findAll({ limit: 10 });
  if (clients.length === 0) {
    console.error('❌ No hay clientes. Ejecutá primero: npm run seed');
    process.exit(1);
  }

  // Obtener datos maestros
  const garmentTypes = await GarmentType.findAll({ where: { active: true } });
  const sizeCharts   = await SizeChart.findAll({ where: { active: true }, order: [['sort_order', 'ASC']] });

  if (garmentTypes.length === 0 || sizeCharts.length === 0) {
    console.error('❌ Faltan datos maestros. Ejecutá primero: npm run seed');
    process.exit(1);
  }

  const sizeIds = sizeCharts.map(s => s.id).slice(0, 6); // XS..XXL

  // Hash de contraseña común
  const passwordHash = await bcrypt.hash('Vendedor123!', 10);

  // Verificar si el seeder ya se ejecutó
  const existing = await User.findOne({ where: { email: SELLERS_DATA[0].email } });
  if (existing) {
    const existingOrders = await Order.count({ where: { seller_id: existing.id } });
    if (existingOrders > 0) {
      console.log('⚠️  El seeder ya fue ejecutado (los vendedores tienen pedidos).');
      console.log('    Si querés regenerar, borrá los pedidos SEED-* primero.\n');
      process.exit(0);
    }
  }

  console.log('👤 Creando vendedores...');

  const sellers: User[] = [];
  for (const data of SELLERS_DATA) {
    const [seller, created] = await User.findOrCreate({
      where: { email: data.email },
      defaults: {
        name: data.name,
        email: data.email,
        password_hash: passwordHash,
        role: 'seller',
        active: true,
      },
    });
    sellers.push(seller);
    console.log(`  ${created ? '✅' : '↩️ '} ${data.name} <${data.email}>`);
  }

  console.log('\n📦 Creando pedidos...\n');

  let totalOrders = 0;

  for (const seller of sellers) {
    console.log(`  Vendedor: ${seller.name}`);
    const sellerOrders: string[] = [];

    for (const tpl of ORDER_TEMPLATES) {
      const client      = pick(clients);
      const garmentType = pick(garmentTypes);
      const sizes       = buildSizes(sizeIds);
      const totalUnits  = Object.values(sizes).reduce((s, q) => s + q, 0);
      const totalAmount = totalUnits * tpl.unitPrice;
      const createdAt   = daysAgo(tpl.createdDaysAgo);
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + tpl.deliveryDaysFromNow);

      const order = await Order.create({
        order_number: nextOrderNumber(),
        client_id:    client.id,
        created_by:   admin.id,
        seller_id:    seller.id,
        status:       tpl.status as OrderStatus,
        delivery_date: deliveryDate,
        total_amount:  totalAmount,
        notes:         `Pedido de prueba — ${tpl.color}`,
        createdAt,
        updatedAt: createdAt,
      });

      // Ítem del pedido
      await OrderItem.create({
        order_id:        order.id,
        garment_type_id: garmentType.id,
        stock_fabric_id: null,
        fabric_type_id:  null,
        color:           tpl.color,
        sizes,
        unit_price:      tpl.unitPrice,
        createdAt,
        updatedAt: createdAt,
      });

      // Historial de estados
      const path = STATUS_PATH[tpl.status] as OrderStatus[];
      for (let i = 0; i < path.length; i++) {
        const stepDate = new Date(createdAt.getTime() + i * 24 * 60 * 60 * 1000);
        await OrderStatusHistory.create({
          order_id:        order.id,
          previous_status: i === 0 ? null : path[i - 1],
          new_status:      path[i],
          changed_by:      admin.id,
          comment:         i === 0 ? 'Pedido creado' : null,
          createdAt:       stepDate,
          updatedAt:       stepDate,
        });
      }

      // Factura según estado del pedido
      const invStatus = invoiceStatusFor(tpl.status);
      if (invStatus) {
        const issueDate = new Date(createdAt.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 días después
        const dueDate   = new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 días
        await Invoice.create({
          order_id:       order.id,
          invoice_number: nextInvoiceNumber(),
          issue_date:     issueDate,
          due_date:       dueDate,
          status:         invStatus,
          total_amount:   totalAmount,
          discount_amount: 0,
          createdAt:      issueDate,
          updatedAt:      issueDate,
        });
      }

      sellerOrders.push(`${order.order_number} [${tpl.status}${invStatus ? ' 🧾' + invStatus : ''}] $${totalAmount.toLocaleString('es-AR')}`);
      totalOrders++;
    }

    sellerOrders.forEach(o => console.log(`    · ${o}`));
    console.log();
  }

  console.log(`\n🎉 Seeder completado: ${sellers.length} vendedores, ${totalOrders} pedidos\n`);
  console.log('Credenciales de todos los vendedores:');
  SELLERS_DATA.forEach(s => console.log(`  ${s.email.padEnd(30)} / Vendedor123!`));
  console.log();

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Error:', err.message ?? err);
  process.exit(1);
});
