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

// Vencimiento de los tokens de un solo uso (columna verification_token).
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // verificación de email: 24 h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;       // reset de contraseña: 1 h

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface StoreTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface StoreJwtPayload {
  sub: number;
  email: string;
  type: 'store_customer';
  session_version: number;
}

function generateStoreTokens(customerId: number, email: string, sessionVersion: number): StoreTokenPair {
  const payload: StoreJwtPayload = { sub: customerId, email, type: 'store_customer', session_version: sessionVersion };
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
    token_expires_at: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    email_verified: false,
  });

  await sendVerificationEmail(data.email, data.name, verification_token);

  return { message: 'Cuenta creada. Revisá tu email para verificarla.' };
}

export async function storeVerifyEmailService(token: string): Promise<void> {
  const customer = await StoreCustomer.findOne({ where: { verification_token: token } });
  if (!customer || isTokenExpired(customer)) throw new AppError('Token inválido o expirado', 400);

  customer.email_verified = true;
  customer.verification_token = null;
  customer.token_expires_at = null;
  await customer.save();
}

// token_expires_at NULL = sin vencimiento (tokens previos a la migración 051).
function isTokenExpired(customer: StoreCustomer): boolean {
  return customer.token_expires_at != null && customer.token_expires_at.getTime() < Date.now();
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

  const tokens = generateStoreTokens(customer.id, customer.email, customer.session_version);
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
  // No confiar en el email si Google no lo verificó: evita vincular la cuenta a
  // un email ajeno no confirmado (vector de account takeover).
  if (payload.email_verified !== true) throw new AppError('El email de Google no está verificado', 400);

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

  const tokens = generateStoreTokens(customer.id, customer.email, customer.session_version);
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
    attributes: ['id', 'email', 'active', 'session_version'],
  });
  if (!customer || !customer.active) throw new AppError('Cuenta no disponible', 401);

  // Invalida refresh tokens viejos: si la sesión fue revocada (ej: reset de
  // contraseña incrementa session_version), el token deja de servir.
  if ((payload.session_version ?? 0) !== customer.session_version) {
    throw new AppError('Sesión expirada. Iniciá sesión de nuevo.', 401);
  }

  return generateStoreTokens(customer.id, customer.email, customer.session_version);
}

export async function storeForgotPasswordService(email: string): Promise<void> {
  const customer = await StoreCustomer.findOne({ where: { email, active: true } });
  // No revelar si el email existe o no
  if (!customer || !customer.password_hash) return;

  const token = uuidv4();
  customer.verification_token = token;
  customer.token_expires_at = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await customer.save();

  await sendPasswordResetEmailStore(email, customer.name, token);
}

export async function storeResetPasswordService(token: string, newPassword: string): Promise<void> {
  const customer = await StoreCustomer.findOne({ where: { verification_token: token } });
  if (!customer || isTokenExpired(customer)) throw new AppError('Token inválido o expirado', 400);

  customer.password_hash = await bcrypt.hash(newPassword, 12);
  customer.verification_token = null;
  customer.token_expires_at = null;
  await customer.save();

  // Revoca todas las sesiones/refresh tokens previos tras cambiar la contraseña.
  // `increment` (SQL atómico) y no `session_version = leído + 1` (REV-01): acá
  // el riesgo es menor que en el sistema — `storeLoginService` NO incrementa la
  // versión al loguear (la tienda permite sesiones concurrentes a propósito),
  // así que no hay un login que pueda perderse. Queda igual por consistencia
  // con `changeUserPassword` y porque dos resets concurrentes sí se pisarían.
  await customer.increment('session_version');
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

  // Whitelist explícita, NUNCA `addr.update(data)` con el body crudo (AUD-01 /
  // mismo criterio que `updateAccount` en cash.service.ts): la ruta
  // `POST /store/me/addresses` no tiene validadores y Sequelize aplica
  // cualquier atributo que venga en el objeto. Con el body crudo, un
  // `{ id: <propia>, customer_id: <ajeno> }` movía la dirección del atacante a
  // la cuenta de otro comprador (escritura cruzada entre clientes), y un `id`
  // inyectado podía pisar otra fila. `customer_id` sale SIEMPRE del token.
  const fields = {
    label:      data.label,
    street:     data.street,
    city:       data.city,
    state:      data.state,
    zip_code:   data.zip_code,
    country:    data.country,
    is_default: data.is_default,
  };

  if (data.id) {
    const addr = await StoreAddress.findOne({ where: { id: data.id, customer_id: customerId } });
    if (!addr) throw new AppError('Dirección no encontrada', 404);
    await addr.update(fields);
    return addr;
  }

  return StoreAddress.create({ ...fields, customer_id: customerId });
}

export async function storeDeleteAddressService(customerId: number, addressId: number) {
  const addr = await StoreAddress.findOne({ where: { id: addressId, customer_id: customerId } });
  if (!addr) throw new AppError('Dirección no encontrada', 404);
  await addr.destroy();
}

export function verifyStoreToken(token: string): StoreJwtPayload {
  let payload: StoreJwtPayload;
  try {
    payload = jwt.verify(token, STORE_JWT_SECRET) as unknown as StoreJwtPayload;
  } catch {
    throw new AppError('Token inválido', 401);
  }
  // Rechazar tokens del sistema: si STORE_JWT_SECRET cae a JWT_SECRET, un token
  // de usuario del sistema tendría firma válida pero no debe autenticar en la tienda.
  if (payload.type !== 'store_customer') throw new AppError('Token inválido', 401);
  return payload;
}
