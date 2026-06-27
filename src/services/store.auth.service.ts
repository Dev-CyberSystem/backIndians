import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import { StoreCustomer, StoreAddress } from '../models';
import { AppError } from '../middlewares/errorHandler';
import {
  sendVerificationEmail,
  sendPasswordResetEmailStore,
} from '../utils/email.service';

const STORE_JWT_SECRET = process.env.STORE_JWT_SECRET || process.env.JWT_SECRET!;
const STORE_JWT_REFRESH_SECRET = process.env.STORE_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET!;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface StoreTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface StoreJwtPayload {
  sub: number;
  email: string;
  type: 'store_customer';
}

function generateStoreTokens(customerId: number, email: string): StoreTokenPair {
  const payload: StoreJwtPayload = { sub: customerId, email, type: 'store_customer' };
  const accessToken = jwt.sign(payload, STORE_JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, STORE_JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

export async function storeRegisterService(data: {
  name: string;
  email: string;
  password: string;
}): Promise<{ message: string }> {
  const existing = await StoreCustomer.findOne({ where: { email: data.email } });
  if (existing) throw new AppError('Ya existe una cuenta con ese email', 409);

  const password_hash = await bcrypt.hash(data.password, 12);
  const verification_token = uuidv4();

  await StoreCustomer.create({
    name: data.name,
    email: data.email,
    password_hash,
    verification_token,
    email_verified: false,
  });

  await sendVerificationEmail(data.email, data.name, verification_token);

  return { message: 'Cuenta creada. Revisá tu email para verificarla.' };
}

export async function storeVerifyEmailService(token: string): Promise<void> {
  const customer = await StoreCustomer.findOne({ where: { verification_token: token } });
  if (!customer) throw new AppError('Token inválido o expirado', 400);

  customer.email_verified = true;
  customer.verification_token = null;
  await customer.save();
}

export async function storeLoginService(
  email: string,
  password: string
): Promise<{ customer: object; tokens: StoreTokenPair }> {
  const customer = await StoreCustomer.findOne({ where: { email, active: true } });
  if (!customer) throw new AppError('Credenciales inválidas', 401);
  if (!customer.password_hash) throw new AppError('Esta cuenta usa Google. Iniciá sesión con Google.', 401);
  if (!customer.email_verified) throw new AppError('Verificá tu email antes de ingresar.', 401);

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) throw new AppError('Credenciales inválidas', 401);

  const tokens = generateStoreTokens(customer.id, customer.email);
  const { password_hash: _, verification_token: __, ...safe } = customer.toJSON();
  return { customer: safe, tokens };
}

export async function storeGoogleAuthService(idToken: string): Promise<{
  customer: object;
  tokens: StoreTokenPair;
  isNew: boolean;
}> {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) throw new AppError('Token de Google inválido', 400);

  const { email, name, picture, sub: google_id } = payload;

  let customer = await StoreCustomer.findOne({ where: { email } });
  let isNew = false;

  if (!customer) {
    customer = await StoreCustomer.create({
      email,
      name: name || email,
      google_id,
      avatar_url: picture || null,
      email_verified: true,
      password_hash: null,
    });
    isNew = true;
  } else if (!customer.google_id) {
    customer.google_id = google_id;
    customer.email_verified = true;
    if (picture && !customer.avatar_url) customer.avatar_url = picture;
    await customer.save();
  }

  const tokens = generateStoreTokens(customer.id, customer.email);
  const { password_hash: _, verification_token: __, ...safe } = customer.toJSON();
  return { customer: safe, tokens, isNew };
}

export async function storeRefreshTokenService(
  refreshToken: string
): Promise<StoreTokenPair> {
  let payload: StoreJwtPayload;
  try {
    payload = jwt.verify(refreshToken, STORE_JWT_REFRESH_SECRET) as unknown as StoreJwtPayload;
  } catch {
    throw new AppError('Refresh token inválido', 401);
  }

  if (payload.type !== 'store_customer') throw new AppError('Token inválido', 401);

  const customer = await StoreCustomer.findByPk(payload.sub, {
    attributes: ['id', 'email', 'active'],
  });
  if (!customer || !customer.active) throw new AppError('Cuenta no disponible', 401);

  return generateStoreTokens(customer.id, customer.email);
}

export async function storeForgotPasswordService(email: string): Promise<void> {
  const customer = await StoreCustomer.findOne({ where: { email, active: true } });
  // No revelar si el email existe o no
  if (!customer || !customer.password_hash) return;

  const token = uuidv4();
  customer.verification_token = token;
  await customer.save();

  await sendPasswordResetEmailStore(email, customer.name, token);
}

export async function storeResetPasswordService(token: string, newPassword: string): Promise<void> {
  const customer = await StoreCustomer.findOne({ where: { verification_token: token } });
  if (!customer) throw new AppError('Token inválido o expirado', 400);

  customer.password_hash = await bcrypt.hash(newPassword, 12);
  customer.verification_token = null;
  await customer.save();
}

export async function storeGetProfileService(customerId: number) {
  const customer = await StoreCustomer.findByPk(customerId, {
    attributes: ['id', 'email', 'name', 'phone', 'avatar_url', 'email_verified', 'createdAt'],
    include: [{ model: StoreAddress, as: 'addresses' }],
  });
  if (!customer) throw new AppError('Cliente no encontrado', 404);
  return customer;
}

export async function storeUpdateProfileService(
  customerId: number,
  data: { name?: string; phone?: string }
) {
  const customer = await StoreCustomer.findByPk(customerId);
  if (!customer) throw new AppError('Cliente no encontrado', 404);

  if (data.name) customer.name = data.name;
  if (data.phone !== undefined) customer.phone = data.phone;
  await customer.save();

  const { password_hash: _, verification_token: __, ...safe } = customer.toJSON();
  return safe;
}

export async function storeUpsertAddressService(
  customerId: number,
  data: {
    id?: number;
    label?: string;
    street: string;
    city: string;
    state?: string;
    zip_code?: string;
    country?: string;
    is_default?: boolean;
  }
) {
  if (data.is_default) {
    await StoreAddress.update({ is_default: false }, { where: { customer_id: customerId } });
  }

  if (data.id) {
    const addr = await StoreAddress.findOne({ where: { id: data.id, customer_id: customerId } });
    if (!addr) throw new AppError('Dirección no encontrada', 404);
    await addr.update(data);
    return addr;
  }

  return StoreAddress.create({ ...data, customer_id: customerId });
}

export async function storeDeleteAddressService(customerId: number, addressId: number) {
  const addr = await StoreAddress.findOne({ where: { id: addressId, customer_id: customerId } });
  if (!addr) throw new AppError('Dirección no encontrada', 404);
  await addr.destroy();
}

export function verifyStoreToken(token: string): StoreJwtPayload {
  try {
    return jwt.verify(token, STORE_JWT_SECRET) as unknown as StoreJwtPayload;
  } catch {
    throw new AppError('Token inválido', 401);
  }
}
