import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from '../src/config/db';
import '../src/models/index';
import { User } from '../src/models/User';
import { Client } from '../src/models/Client';
import { Product } from '../src/models/Product';
import { GarmentType } from '../src/models/GarmentType';
import { FabricType } from '../src/models/FabricType';
import { SizeChart } from '../src/models/SizeChart';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Iniciando seeders de desarrollo...');

  await connectDB();

  // ─── Usuarios ──────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin123!', 12);
  const sellerHash = await bcrypt.hash('Vendedor123!', 12);

  const [admin] = await User.findOrCreate({
    where: { email: 'admin@textil.com' },
    defaults: {
      name: 'Administrador',
      email: 'admin@textil.com',
      password_hash: adminHash,
      role: 'admin',
      active: true,
    },
  });

  const [billing] = await User.findOrCreate({
    where: { email: 'facturacion@textil.com' },
    defaults: {
      name: 'María Facturación',
      email: 'facturacion@textil.com',
      password_hash: adminHash,
      role: 'billing',
      active: true,
    },
  });

  const [workshop] = await User.findOrCreate({
    where: { email: 'taller@textil.com' },
    defaults: {
      name: 'Juan Taller',
      email: 'taller@textil.com',
      password_hash: adminHash,
      role: 'workshop',
      active: true,
    },
  });

  const [seller] = await User.findOrCreate({
    where: { email: 'vendedor@textil.com' },
    defaults: {
      name: 'Carlos Vendedor',
      email: 'vendedor@textil.com',
      password_hash: sellerHash,
      role: 'seller',
      active: true,
    },
  });

  console.log(
    `✅ Usuarios: ${admin.name}, ${billing.name}, ${workshop.name}, ${seller.name}`
  );

  // ─── Clientes ──────────────────────────────────────────────────────────────
  const [club] = await Client.findOrCreate({
    where: { name: 'Club Atlético Los Pumas' },
    defaults: {
      name: 'Club Atlético Los Pumas',
      contact_name: 'Roberto García',
      phone: '0351-4567890',
      email: 'admin@lospumas.com.ar',
      address: 'Av. Colón 1234, Córdoba',
      cuit: '30-71234567-8',
      notes: 'Cliente habitual. Requiere uniformes de fútbol y básquet.',
    },
  });

  const [colegio] = await Client.findOrCreate({
    where: { name: 'Colegio San Martín' },
    defaults: {
      name: 'Colegio San Martín',
      contact_name: 'Lic. Ana Rodríguez',
      phone: '0351-4123456',
      email: 'preceptoria@colegiosanmartin.edu.ar',
      address: 'Belgrano 567, Córdoba',
      cuit: '30-65432100-1',
      notes: 'Pedidos anuales de ropa deportiva para educación física.',
    },
  });

  const [municipio] = await Client.findOrCreate({
    where: { name: 'Municipalidad de Villa Allende' },
    defaults: {
      name: 'Municipalidad de Villa Allende',
      contact_name: 'Sr. Carlos Pérez',
      phone: '03543-456789',
      email: 'compras@villaallende.gob.ar',
      address: 'San Martín 100, Villa Allende',
      cuit: '30-99887766-5',
      notes: 'Requiere ropa de trabajo e identificación para empleados.',
    },
  });

  console.log(`✅ Clientes: ${club.name}, ${colegio.name}, ${municipio.name}`);

  // ─── Productos ─────────────────────────────────────────────────────────────
  const productos = [
    {
      name: 'Camiseta de fútbol',
      description: 'Camiseta sublimada 100% poliéster, con número y nombre incluidos',
      base_price: 4500,
      category: 'Fútbol',
    },
    {
      name: 'Short deportivo',
      description: 'Short con elástico y lazo, tela dry-fit',
      base_price: 2800,
      category: 'Indumentaria general',
    },
    {
      name: 'Buzo con capucha',
      description: 'Buzo frisa con capucha, estampa o bordado incluido',
      base_price: 7200,
      category: 'Abrigo',
    },
    {
      name: 'Remera institucional',
      description: 'Remera algodón peinado 30/1, con logo bordado',
      base_price: 3100,
      category: 'Institucional',
    },
    {
      name: 'Campera rompeviento',
      description: 'Campera rompeviento con capucha desmontable, impermeable',
      base_price: 9500,
      category: 'Abrigo',
    },
  ];

  for (const prod of productos) {
    await Product.findOrCreate({
      where: { name: prod.name },
      defaults: { ...prod, active: true },
    });
  }

  console.log(`✅ ${productos.length} productos cargados`);

  // ─── Tipos de prenda ───────────────────────────────────────────────────────
  const prendas = [
    { name: 'Camiseta', sort_order: 1 },
    { name: 'Remera', sort_order: 2 },
    { name: 'Pantalón', sort_order: 3 },
    { name: 'Short', sort_order: 4 },
    { name: 'Campera', sort_order: 5 },
    { name: 'Medias', sort_order: 6 },
  ];

  for (const prenda of prendas) {
    await GarmentType.findOrCreate({
      where: { name: prenda.name },
      defaults: { ...prenda, active: true },
    });
  }

  console.log(`✅ ${prendas.length} tipos de prenda cargados`);

  // ─── Tipos de tela ─────────────────────────────────────────────────────────
  const telas = [
    { name: 'Poliéster', sort_order: 1 },
    { name: 'Nylon', sort_order: 2 },
    { name: 'Spandex (Elastano)', sort_order: 3 },
    { name: 'Polisap', sort_order: 4 },
    { name: 'Dry-fit', sort_order: 5 },
    { name: 'Microfibra', sort_order: 6 },
    { name: 'Malla', sort_order: 7 },
    { name: 'Licra', sort_order: 8 },
  ];

  for (const tela of telas) {
    await FabricType.findOrCreate({
      where: { name: tela.name },
      defaults: { ...tela, active: true },
    });
  }

  console.log(`✅ ${telas.length} tipos de tela cargados`);

  // ─── Tallas ────────────────────────────────────────────────────────────────
  const talles = [
    { name: 'XS', sort_order: 1 },
    { name: 'S', sort_order: 2 },
    { name: 'M', sort_order: 3 },
    { name: 'L', sort_order: 4 },
    { name: 'XL', sort_order: 5 },
    { name: 'XXL', sort_order: 6 },
    { name: 'XXXL', sort_order: 7 },
    { name: 'Talle 2', sort_order: 8 },
    { name: 'Talle 4', sort_order: 9 },
    { name: 'Talle 6', sort_order: 10 },
    { name: 'Talle 8', sort_order: 11 },
    { name: 'Talle 10', sort_order: 12 },
    { name: 'Talle 12', sort_order: 13 },
    { name: 'Único', sort_order: 14 },
  ];

  for (const talle of talles) {
    await SizeChart.findOrCreate({
      where: { name: talle.name },
      defaults: { ...talle, active: true },
    });
  }

  console.log(`✅ ${talles.length} tallas cargadas`);

  console.log('\n🎉 Seeders completados exitosamente');
  console.log('\nCredenciales de acceso:');
  console.log('  Admin:      admin@textil.com        / Admin123!');
  console.log('  Billing:    facturacion@textil.com   / Admin123!');
  console.log('  Workshop:   taller@textil.com        / Admin123!');
  console.log('  Seller:     vendedor@textil.com      / Vendedor123!');

  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Error en seeders:', err);
  process.exit(1);
});
