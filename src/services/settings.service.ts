import { sequelize } from '../config/db';
import { Settings, CashAccount } from '../models';
import { invalidateCache } from '../utils/cache';
import { AppError } from '../middlewares/errorHandler';

export interface CompanySettings {
  company_name: string;
  company_address: string;
  company_cuit: string;
  company_phone: string;
  company_email: string;
  company_website: string;
  company_iva_condition: string;
  company_activity_start: string;
  invoice_due_days: string;
  invoice_point_of_sale: string;
  invoice_default_type: string;
}

const VALID_KEYS: string[] = [
  // Empresa
  'company_name', 'company_address', 'company_cuit',
  'company_phone', 'company_email', 'company_website',
  'company_iva_condition', 'company_activity_start',
  'invoice_due_days', 'invoice_point_of_sale', 'invoice_default_type',
  // Tienda — general
  'store_name', 'store_description', 'store_active',
  'store_logo_url', 'store_footer_logo_url', 'store_banner_url', 'store_primary_color',
  'store_whatsapp', 'store_instagram', 'store_facebook',
  // Tienda — envíos
  'shipping_cost', 'free_shipping_min', 'store_pickup_address',
  // Tienda — landing hero
  'store_hero_title', 'store_hero_subtitle', 'store_hero_cta',
  'store_hero_badge',
  'store_hero_image_url', 'store_hero_image_2_url', 'store_hero_image_3_url',
  'store_hero_image_mobile_url', 'store_hero_image_2_mobile_url', 'store_hero_image_3_mobile_url',
  // Tienda — landing secciones
  'store_announcement',
  'store_marquee',
  'store_categories_title',
  'store_featured_title', 'store_featured_subtitle',
  // Tienda — spotlight (3 clientes destacados)
  'store_spotlight_1_image', 'store_spotlight_1_title', 'store_spotlight_1_subtitle', 'store_spotlight_1_link',
  'store_spotlight_2_image', 'store_spotlight_2_title', 'store_spotlight_2_subtitle', 'store_spotlight_2_link',
  'store_spotlight_3_image', 'store_spotlight_3_title', 'store_spotlight_3_subtitle', 'store_spotlight_3_link',
  // Tienda — carrusel de banners (ancho completo, 4 slides)
  'store_carousel_1_image', 'store_carousel_1_image_mobile', 'store_carousel_1_link',
  'store_carousel_2_image', 'store_carousel_2_image_mobile', 'store_carousel_2_link',
  'store_carousel_3_image', 'store_carousel_3_image_mobile', 'store_carousel_3_link',
  'store_carousel_4_image', 'store_carousel_4_image_mobile', 'store_carousel_4_link',
  // Tienda — landing banner promo
  'store_promo_image_url', 'store_promo_title',
  'store_promo_subtitle', 'store_promo_cta',
  // Tienda — barra de promociones (pills)
  'store_promo_pills',
  // Tienda — transferencia bancaria
  'bank_transfer_cbu', 'bank_transfer_alias', 'bank_transfer_holder',
  // Tienda — chatbot de atención
  'store_chatbot_enabled', 'store_chatbot_greeting',
  // Tienda — seguimiento de pedidos (días de vigencia del link tras "Entregado")
  'tracking_link_expiry_days',
  // AFIP / ARCA — Facturación electrónica
  'afip_enabled', 'afip_environment', 'afip_punto_venta', 'afip_concepto_default',
  // Tienda — conexión con caja (2.3). Dos cuentas separadas desde la Fase 3
  // del plan de corrección de caja (CASH-PAY-002): store_cash_account_id
  // recibe SOLO pagos en efectivo; store_bank_account_id recibe MercadoPago
  // y transferencia — nunca deben mezclarse en la misma cuenta física.
  'store_cash_account_id',
  'store_bank_account_id',
];

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await Settings.findAll({ where: { key: VALID_KEYS } });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value ?? '';
  }
  return map;
}

// Fase 3 del plan de corrección de caja (CASH-PAY-002): la cuenta de tienda
// para efectivo solo puede ser tipo `cash`, la de no-efectivo solo `bank` —
// se rechaza el guardado si no coincide, no alcanza con un warning porque es
// exactamente la mala configuración que esta fase existe para prevenir.
const ACCOUNT_SETTING_TYPE: Partial<Record<string, 'cash' | 'bank'>> = {
  store_cash_account_id: 'cash',
  store_bank_account_id: 'bank',
};

export async function updateSettings(
  data: Record<string, string>
): Promise<Record<string, string>> {
  const entries = Object.entries(data).filter(([k]) => VALID_KEYS.includes(k));
  if (!entries.length) return getAllSettings();

  for (const [key, value] of entries) {
    const expectedType = ACCOUNT_SETTING_TYPE[key];
    if (!expectedType || !value) continue; // '' es la forma válida de "sin configurar"
    const account = await CashAccount.findByPk(Number(value));
    if (!account) throw new AppError(`La cuenta configurada para "${key}" no existe`, 400);
    if (account.type !== expectedType) {
      throw new AppError(
        `"${key}" debe ser una cuenta de tipo "${expectedType}" — "${account.name}" es de tipo "${account.type}"`,
        400
      );
    }
  }

  const now = new Date();
  await sequelize.transaction(async (t) => {
    for (const [key, value] of entries) {
      await Settings.upsert(
        { key, value: value ?? '', createdAt: now, updatedAt: now },
        { transaction: t }
      );
    }
  });

  // El comprador ve estos settings cacheados: invalidamos para reflejar el cambio ya.
  invalidateCache('store:settings');

  return getAllSettings();
}
