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
  backUrls: {
    success: string;
    failure: string;
    pending: string;
  };
}

export async function createPreference(input: CreatePreferenceInput) {
  const client = getClient();
  const preference = new Preference(client);

  const amount = input.paymentType === 'half'
    ? parseFloat((input.totalAmount / 2).toFixed(2))
    : input.totalAmount;

  // Si es mitad, ajustamos los precios proporcionalmente
  const items: MPItem[] = input.paymentType === 'half'
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
    auto_return: 'approved' as const,
    statement_descriptor: 'Indians Textil',
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
