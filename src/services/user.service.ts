import bcrypt from 'bcryptjs';
import { User } from '../models';
import { AppError } from '../middlewares/errorHandler';
import { UserRole } from '../types';

interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  active?: boolean;
}

export async function listUsers() {
  return User.findAll({
    attributes: { exclude: ['password_hash'] },
    order: [['name', 'ASC']],
  });
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const existing = await User.findOne({ where: { email: input.email } });
  if (existing) throw new AppError('El email ya está en uso', 409);

  const password_hash = await bcrypt.hash(input.password, 12);

  return User.create({
    name: input.name,
    email: input.email,
    password_hash,
    role: input.role,
    active: true,
  });
}

export async function updateUser(
  id: number,
  input: UpdateUserInput
): Promise<User> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  const updateData: Partial<User> = {};

  if (input.name !== undefined) updateData.name = input.name;
  if (input.email !== undefined) {
    const existing = await User.findOne({ where: { email: input.email } });
    if (existing && existing.id !== id) throw new AppError('El email ya está en uso', 409);
    updateData.email = input.email;
  }
  if (input.role !== undefined) updateData.role = input.role;
  if (input.active !== undefined) updateData.active = input.active;
  if (input.password) {
    (updateData as any).password_hash = await bcrypt.hash(input.password, 12);
  }

  await user.update(updateData);

  const updated = await User.findByPk(id, {
    attributes: { exclude: ['password_hash'] },
  });
  return updated!;
}

export async function toggleUserActive(id: number, requesterId: number): Promise<User> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);

  if (id === requesterId) throw new AppError('No podés desactivarte a vos mismo', 400);

  // Si va a quedar inactivo y es admin, verificar que quede al menos un admin activo
  if (user.active && user.role === 'admin') {
    const activeAdmins = await User.count({ where: { role: 'admin', active: true } });
    if (activeAdmins <= 1) throw new AppError('No podés desactivar el único administrador activo', 400);
  }

  await user.update({ active: !user.active });
  const updated = await User.findByPk(id, { attributes: { exclude: ['password_hash'] } });
  return updated!;
}

export async function changeUserPassword(id: number, newPassword: string): Promise<void> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);
  const password_hash = await bcrypt.hash(newPassword, 12);
  await user.update({ password_hash });
}

// Soft delete: desactiva el usuario en lugar de eliminarlo
export async function softDeleteUser(id: number): Promise<void> {
  const user = await User.findByPk(id);
  if (!user) throw new AppError('Usuario no encontrado', 404);
  await user.update({ active: false });
}
