import { Op } from 'sequelize';
import { Client } from '../models';
import { AppError } from '../middlewares/errorHandler';

interface ClientInput {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  cuit?: string;
  notes?: string;
}

export async function listClients(page: number, limit: number, search?: string) {
  const offset = (page - 1) * limit;
  const where = search
    ? {
        [Op.or]: [
          { name:         { [Op.like]: `%${search}%` } },
          { email:        { [Op.like]: `%${search}%` } },
          { cuit:         { [Op.like]: `%${search}%` } },
          { contact_name: { [Op.like]: `%${search}%` } },
        ],
      }
    : {};
  const { rows, count } = await Client.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset,
  });
  return { clients: rows, total: count, page, limit };
}

export async function getClientById(id: number): Promise<Client> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  return client;
}

export async function createClient(input: ClientInput): Promise<Client> {
  return Client.create({
    name: input.name,
    contact_name: input.contact_name || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    cuit: input.cuit || null,
    notes: input.notes || null,
  });
}

export async function updateClient(
  id: number,
  input: Partial<ClientInput>
): Promise<Client> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  await client.update(input);
  return client;
}

export async function deleteClient(id: number): Promise<void> {
  const client = await Client.findByPk(id);
  if (!client) throw new AppError('Cliente no encontrado', 404);
  await client.destroy();
}
