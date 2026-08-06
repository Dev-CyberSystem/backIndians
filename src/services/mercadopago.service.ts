import crypto from 'crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../utils/logger';

/**
 * Valida la firma (`x-signature`) que MercadoPago envía en sus webhooks.
 * Manifiesto según doc de MP: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * firmado con HMAC-SHA256 y el secreto del webhook (`MP_WEBHOOK_SECRET`).
 *
 * Si `MP_WEBHOOK_SECRET` no está configurado: en producción se rechaza todo
 * (fail-closed — `server.ts` además impide arrancar sin esta variable en
 * producción). Fuera de producción se acepta sin validar (fail-open) para no
 * frenar el desarrollo local, dejando un WARN para que no pase desapercibido.
 */
export function verifyWebhookSignature(params: {
  dataId: string | undefined;
  xSignature: string | undefined;
  xRequestId: string | undefined;
}): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return false;
    logger.warn('mercadopago.webhookSecretMissing', {
      message: 'MP_WEBHOOK_SECRET no configurado: firma del webhook sin validar (solo permitido fuera de producción)',
    });
    return true;
  }

  const { dataId, xSignature, xRequestId } = params;
  if (!xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim(), v?.trim()];
    })
  ) as Record<string, string | undefined>;

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${(dataId ?? '').toLowerCase()};request-id:${xRequestId ?? ''};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

function getClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new AppError('MercadoPago no configurado: falta MP_ACCESS_TOKEN', 500);
  return new MercadoPagoConfig({ accessToken: token });
}

export interface MPItem {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id?: string;
}

export interface CreatePreferenceInput {
  externalReference: string;
  items: MPItem[];
  totalAmount: number;
  paymentType: 'full' | 'half';
  overrideAmount?: number;
  backUrls: {
    success: string;
    failure: string;
    pending: string;
  };
  /** URL pública del backend que MP llamará al cambiar el estado del pago */
  notificationUrl?: string;
  /** Si true, MP redirige automáticamente al sitio tras un pago aprobado */
  autoReturn?: boolean;
}

export async function createPreference(input: CreatePreferenceInput) {
  const client = getClient();
  const preference = new Preference(client);

  const amount = input.overrideAmount != null
    ? parseFloat(input.overrideAmount.toFixed(2))
    : input.paymentType === 'half'
    ? parseFloat((input.totalAmount / 2).toFixed(2))
    : input.totalAmount;

  // Con monto personalizado, un solo ítem con ese monto
  // Con tipo half/full, se ajustan los ítems del pedido
  const items: MPItem[] = input.overrideAmount != null
    ? [{ id: 'pago', title: `Pago pedido ${input.externalReference}`, quantity: 1, unit_price: amount, currency_id: 'ARS' }]
    : input.paymentType === 'half'
    ? input.items.map((item) => ({
        ...item,
        unit_price: parseFloat((item.unit_price / 2).toFixed(2)),
        currency_id: item.currency_id || 'ARS',
      }))
    : input.items.map((item) => ({
        ...item,
        currency_id: item.currency_id || 'ARS',
      }));

  const body = {
    external_reference: input.externalReference,
    items,
    back_urls: input.backUrls,
    statement_descriptor: 'Indians Textil',
    // MP llama a esta URL (server-to-server) cuando cambia el estado del pago
    ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
    // Redirección automática al sitio tras aprobación (requiere back_urls.success)
    ...(input.autoReturn ? { auto_return: 'approved' as const } : {}),
  };

  const result = await preference.create({ body });

  return {
    preference_id: result.id ?? null,
    init_point: result.init_point ?? null,
    sandbox_init_point: result.sandbox_init_point ?? null,
    payment_amount: amount,
  };
}

/**
 * Reconsulta una preference ya creada (por su id) para recuperar sus links de
 * pago. Se usa al responder un checkout duplicado (mismo Idempotency-Key):
 * el pedido ya tiene `mp_preference_id` guardado, pero no el `init_point`
 * (nunca se persiste), así que hay que volver a pedírselo a MP. Devuelve
 * `null` si falla (p. ej. preference vencida) en vez de cortar la respuesta:
 * el pedido ya existe igual, solo no se puede reofrecer el link de pago.
 */
export async function getPreference(preferenceId: string): Promise<{ init_point: string | null; sandbox_init_point: string | null } | null> {
  try {
    const client = getClient();
    const preference = new Preference(client);
    const result = await preference.get({ preferenceId });
    return {
      init_point: result.init_point ?? null,
      sandbox_init_point: result.sandbox_init_point ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Subconjunto de campos de un pago de MP que necesitamos para aplicar su
 * resultado a un pedido (1.5): estado, monto/moneda (para validar contra
 * `total_amount` antes de acreditar) y fechas (para descartar eventos que
 * llegan desordenados — ver `applyPaymentResult` en store.service.ts).
 */
export interface PaymentInfo {
  id?: number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string;
  date_last_updated?: string;
  date_created?: string;
}

export async function getPaymentInfo(paymentId: string): Promise<PaymentInfo> {
  const client = getClient();
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

/** Busca pagos asociados a un external_reference (número de orden). Devuelve array vacío si no encuentra o falla. */
export async function searchPaymentsByReference(externalReference: string): Promise<PaymentInfo[]> {
  const client = getClient();
  const payment = new Payment(client);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (payment as any).search({ options: { external_reference: externalReference, sort: 'date_created', criteria: 'desc' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((result?.results ?? []) as any[]).map((p: any): PaymentInfo => ({
      id: p.id,
      status: p.status,
      external_reference: p.external_reference,
      transaction_amount: p.transaction_amount,
      currency_id: p.currency_id,
      date_approved: p.date_approved,
      date_last_updated: p.date_last_updated,
      date_created: p.date_created,
    }));
  } catch {
    return [];
  }
}
