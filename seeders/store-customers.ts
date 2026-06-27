import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import { connectDB } from '../src/config/db';
import '../src/models/index';
import { StoreCustomer } from '../src/models/StoreCustomer';
import { StoreAddress } from '../src/models/StoreAddress';
import bcrypt from 'bcryptjs';

const PASSWORD = 'Cliente123!';

const customers = [
  {
    name: 'Lucía Fernández',
    email: 'lucia.fernandez@example.com',
    phone: '351-4112233',
    address: {
      label: 'Casa',
      street: 'Av. Rafael Núñez 4521',
      city: 'Córdoba',
      state: 'Córdoba',
      zip_code: '5009',
      country: 'Argentina',
      is_default: true,
    },
  },
  {
    name: 'Martín Quiroga',
    email: 'martin.quiroga@example.com',
    phone: '351-5223344',
    address: {
      label: 'Casa',
      street: 'Bv. San Juan 1200',
      city: 'Córdoba',
      state: 'Córdoba',
      zip_code: '5000',
      country: 'Argentina',
      is_default: true,
    },
  },
  {
    name: 'Valentina Sosa',
    email: 'valentina.sosa@example.com',
    phone: '351-6334455',
    address: {
      label: 'Trabajo',
      street: 'Ing. Huergo 843, Piso 3',
      city: 'Buenos Aires',
      state: 'Buenos Aires',
      zip_code: '1107',
      country: 'Argentina',
      is_default: true,
    },
  },
  {
    name: 'Ignacio Romero',
    email: 'ignacio.romero@example.com',
    phone: '351-7445566',
    address: null,
  },
  {
    name: 'Camila Torres',
    email: 'camila.torres@example.com',
    phone: null,
    address: {
      label: 'Casa',
      street: 'Los Cedros 234',
      city: 'Mendoza',
      state: 'Mendoza',
      zip_code: '5500',
      country: 'Argentina',
      is_default: true,
    },
  },
];

async function seedStoreCustomers() {
  await connectDB();

  const hash = await bcrypt.hash(PASSWORD, 12);

  let created = 0;
  let skipped = 0;

  for (const data of customers) {
    const [customer, wasCreated] = await StoreCustomer.findOrCreate({
      where: { email: data.email },
      defaults: {
        name: data.name,
        email: data.email,
        password_hash: hash,
        phone: data.phone ?? null,
        email_verified: true,
        active: true,
      },
    });

    if (wasCreated) {
      if (data.address) {
        await StoreAddress.create({
          customer_id: customer.id,
          ...data.address,
        });
      }
      created++;
      console.log(`  ✅ ${customer.name} <${customer.email}>`);
    } else {
      skipped++;
      console.log(`  ⏭  ${data.email} ya existe (sin cambios)`);
    }
  }

  console.log(`\n🎉 Store customers: ${created} creados, ${skipped} ya existían`);
  console.log(`\nContraseña para todos: ${PASSWORD}`);

  process.exit(0);
}

seedStoreCustomers().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
