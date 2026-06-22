import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { AppError } from '../middlewares/errorHandler';

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

export async function getPaymentInfo(paymentId: string) {
  const client = getClient();
  const payment = new Payment(client);
  return payment.get({ id: paymentId });
}

/** Busca pagos asociados a un external_reference (número de orden). Devuelve array vacío si no encuentra o falla. */
export async function searchPaymentsByReference(externalReference: string): Promise<Array<{ id: number | undefined; status: string | undefined }>> {
  const client = getClient();
  const payment = new Payment(client);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (payment as any).search({ options: { external_reference: externalReference, sort: 'date_created', criteria: 'desc' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((result?.results ?? []) as any[]).map((p: any) => ({ id: p.id as number | undefined, status: p.status as string | undefined }));
  } catch {
    return [];
  }
}
