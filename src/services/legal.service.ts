import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import {
  LegalAcceptance,
  StoreCustomer,
  StoreOrder,
  StoreWithdrawalRequest,
  User,
} from '../models';
import type { LegalAcceptanceContext } from '../models/LegalAcceptance';
import type { WithdrawalStatus } from '../models/StoreWithdrawalRequest';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from '../config/legalDocs';
import { getAllSettings } from './settings.service';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../utils/logger';
import {
  sendWithdrawalRequestEmail,
  sendWithdrawalAdminEmail,
} from '../utils/email.service';

// ─── Metadatos de los documentos (públicos) ──────────────────────────────────

export function getLegalDocumentsMeta() {
  return LEGAL_DOCUMENT_KEYS.map((key) => ({ key, ...LEGAL_DOCUMENTS[key] }));
}

// ─── Constancia de aceptación ────────────────────────────────────────────────

export interface RecordAcceptanceInput {
  context: LegalAcceptanceContext;
  customerId?: number | null;
  storeOrderId?: number | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  transaction?: Transaction;
}

/**
 * Deja constancia de que se aceptaron los textos legales vigentes: una fila
 * por documento, con la versión que estaba publicada en ese momento.
 *
 * Nunca tira: una constancia que falla no puede voltear un registro de cuenta
 * ni un checkout ya cobrado. Si algo sale mal queda en el log como error
 * propio (`legal.acceptance.failed`) para poder reconstruirlo después.
 */
export async function recordLegalAcceptance(input: RecordAcceptanceInput): Promise<void> {
  const now = new Date();

  try {
    await LegalAcceptance.bulkCreate(
      LEGAL_DOCUMENT_KEYS.map((doc) => ({
        document: doc,
        version: LEGAL_DOCUMENTS[doc].version,
        customer_id: input.customerId ?? null,
        store_order_id: input.storeOrderId ?? null,
        email: input.email?.toLowerCase().trim() ?? null,
        context: input.context,
        ip: input.ip ?? null,
        // El user-agent real puede pasar los 255 de la columna: se recorta.
        user_agent: input.userAgent?.slice(0, 255) ?? null,
        accepted_at: now,
      })),
      { transaction: input.transaction }
    );

    // Resumen en la cuenta, para no tener que hacer JOIN en el panel.
    if (input.customerId) {
      await StoreCustomer.update(
        { terms_accepted_at: now, terms_version: LEGAL_DOCUMENTS.terms.version },
        { where: { id: input.customerId }, transaction: input.transaction }
      );
    }
  } catch (err) {
    logger.error('legal.acceptance.failed', err, {
      meta: {
        fatal: false,
        context: input.context,
        customerId: input.customerId ?? null,
        storeOrderId: input.storeOrderId ?? null,
      },
    });
  }
}

export interface ListAcceptancesFilters {
  customer_id?: number;
  store_order_id?: number;
  email?: string;
  page?: number;
  limit?: number;
}

export async function listLegalAcceptances(filters: ListAcceptancesFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));

  const where: Record<string, unknown> = {};
  if (filters.customer_id) where.customer_id = filters.customer_id;
  if (filters.store_order_id) where.store_order_id = filters.store_order_id;
  if (filters.email) where.email = filters.email.toLowerCase().trim();

  const { rows, count } = await LegalAcceptance.findAndCountAll({
    where,
    include: [
      { model: StoreCustomer, as: 'customer', attributes: ['id', 'name', 'email'] },
      { model: StoreOrder, as: 'order', attributes: ['id', 'order_number'] },
    ],
    order: [['accepted_at', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });

  return {
    data: rows,
    meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) },
  };
}

// ─── Arrepentimiento (Res. 424/2020 SCI) ─────────────────────────────────────

/**
 * Código de identificación del arrepentimiento: `ARR-AAAA-NNNNNN`, correlativo
 * por año. Mismo criterio que el número de pedido (`ECOM-...`): legible y
 * dictable por teléfono, no un UUID.
 */
async function generateWithdrawalCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ARR-${year}-`;

  const last = await StoreWithdrawalRequest.findOne({
    where: { code: { [Op.like]: `${prefix}%` } },
    order: [['id', 'DESC']],
    attributes: ['code'],
  });

  const seq = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

export interface WithdrawalInput {
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  order_number?: string | null;
  reason?: string | null;
  customerId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Registra una solicitud de arrepentimiento y devuelve el código.
 *
 * Nunca rechaza por "pedido inexistente": la Res. 424/2020 prohíbe exigir
 * trámites previos, así que el número de pedido es un dato declarado. Si
 * coincide con un pedido real se vincula (y sirve para gestionarlo), y si no,
 * la solicitud queda registrada igual y el equipo la resuelve por mail.
 */
export async function createWithdrawalRequest(
  input: WithdrawalInput
): Promise<StoreWithdrawalRequest> {
  const email = input.customer_email.toLowerCase().trim();
  const orderNumber = input.order_number?.trim() || null;

  let linkedOrder: StoreOrder | null = null;
  if (orderNumber) {
    linkedOrder = await StoreOrder.findOne({
      where: { order_number: orderNumber },
      attributes: ['id', 'customer_id', 'order_number'],
    });
  }

  // Reintento acotado: dos solicitudes simultáneas pueden calcular el mismo
  // correlativo y chocar contra el índice único de `code`.
  const MAX_ATTEMPTS = 3;
  let request: StoreWithdrawalRequest | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      request = await StoreWithdrawalRequest.create({
        code: await generateWithdrawalCode(),
        order_number: orderNumber,
        store_order_id: linkedOrder?.id ?? null,
        customer_id: input.customerId ?? linkedOrder?.customer_id ?? null,
        customer_name: input.customer_name.trim(),
        customer_email: email,
        customer_phone: input.customer_phone?.trim() || null,
        reason: input.reason?.trim() || null,
        status: 'received',
        ip: input.ip ?? null,
        user_agent: input.userAgent?.slice(0, 255) ?? null,
      });
      break;
    } catch (err) {
      if (err instanceof UniqueConstraintError && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }

  if (!request) throw new AppError('No se pudo registrar la solicitud. Intentá de nuevo.', 500);

  const created = request;

  // Los avisos no pueden voltear la solicitud ya registrada: el código ya
  // existe y se devuelve en la respuesta aunque el mail falle.
  void notifyWithdrawal(created).catch((err) =>
    logger.error('legal.withdrawal.notifyFailed', err, {
      meta: { fatal: false, code: created.code },
    })
  );

  logger.info('legal.withdrawal.created', {
    meta: { code: created.code, orderNumber, linked: !!linkedOrder },
  });

  return created;
}

async function notifyWithdrawal(request: StoreWithdrawalRequest): Promise<void> {
  await sendWithdrawalRequestEmail({
    email: request.customer_email,
    name: request.customer_name,
    code: request.code,
    orderNumber: request.order_number,
  });

  const settings = await getAllSettings();
  const adminEmail =
    process.env.LEGAL_NOTIFICATIONS_EMAIL ||
    settings.company_email ||
    process.env.ALERT_EMAIL_TO;

  if (!adminEmail) {
    // Sin destinatario el aviso interno no sale, y hasta acá se salteaba en
    // silencio (Q-C de la auditoría del 2026-08-19): el arrepentimiento quedaba
    // sólo en la bandeja de `/ecommerce/legal`, esperando que alguien la mirara.
    // La constancia al consumidor —que es la obligación de la Res. 424/2020— sí
    // salió; lo que se pierde es la gestión. Es exactamente el patrón que D-02
    // acaba de corregir en los jobs: fallar sin avisar.
    logger.warn('legal.withdrawal.adminEmailSkipped', {
      message:
        'Solicitud de arrepentimiento sin aviso al administrador: no hay LEGAL_NOTIFICATIONS_EMAIL, ' +
        'company_email ni ALERT_EMAIL_TO configurados. El reclamo queda sólo en la bandeja de legales.',
      meta: { code: request.code },
    });
    return;
  }

  await sendWithdrawalAdminEmail({
    to: adminEmail,
    code: request.code,
    customerName: request.customer_name,
    customerEmail: request.customer_email,
    customerPhone: request.customer_phone,
    orderNumber: request.order_number,
    reason: request.reason,
  });
}

export interface ListWithdrawalFilters {
  status?: WithdrawalStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listWithdrawalRequests(filters: ListWithdrawalFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

  const where: Record<string | symbol, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    where[Op.or] = [
      { code: { [Op.like]: term } },
      { customer_email: { [Op.like]: term } },
      { customer_name: { [Op.like]: term } },
      { order_number: { [Op.like]: term } },
    ];
  }

  const { rows, count } = await StoreWithdrawalRequest.findAndCountAll({
    where,
    include: [
      { model: StoreOrder, as: 'order', attributes: ['id', 'order_number', 'status', 'total_amount'] },
      { model: User, as: 'resolver', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });

  return {
    data: rows,
    meta: { total: count, page, limit, total_pages: Math.ceil(count / limit) },
  };
}

export async function getWithdrawalRequest(id: number): Promise<StoreWithdrawalRequest> {
  const request = await StoreWithdrawalRequest.findByPk(id, {
    include: [
      { model: StoreOrder, as: 'order', attributes: ['id', 'order_number', 'status', 'total_amount'] },
      { model: User, as: 'resolver', attributes: ['id', 'name'] },
    ],
  });
  if (!request) throw new AppError('Solicitud no encontrada', 404);
  return request;
}

export async function updateWithdrawalRequest(
  id: number,
  data: { status?: WithdrawalStatus; admin_notes?: string | null },
  userId: number
): Promise<StoreWithdrawalRequest> {
  const request = await StoreWithdrawalRequest.findByPk(id);
  if (!request) throw new AppError('Solicitud no encontrada', 404);

  if (data.status) {
    request.status = data.status;
    // Se marca quién y cuándo la cerró; si se reabre, se limpia la marca.
    const isClosed = data.status === 'resolved' || data.status === 'rejected';
    request.resolved_at = isClosed ? new Date() : null;
    request.resolved_by = isClosed ? userId : null;
  }
  if (data.admin_notes !== undefined) request.admin_notes = data.admin_notes;

  await request.save();
  return getWithdrawalRequest(id);
}
