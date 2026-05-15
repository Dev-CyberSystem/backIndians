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

export async function listClients(page: number, limit: number) {
  const offset = (page - 1) * limit;
  const { rows, count } = await Client.findAndCountAll({
    order: [['name', 'ASC']],
    limit,
    offset,
  });
  return { clients: rows, total: count, page, limit };
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
