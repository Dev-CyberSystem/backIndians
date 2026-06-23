import { sequelize } from '../config/db';
import { Settings } from '../models';

export interface CompanySettings {
  company_name: string;
  company_address: string;
  company_cuit: string;
  company_phone: string;
  company_email: string;
  invoice_due_days: string;
}

const VALID_KEYS: string[] = [
  // Empresa
  'company_name', 'company_address', 'company_cuit',
  'company_phone', 'company_email', 'invoice_due_days',
  // Tienda — general
  'store_name', 'store_description', 'store_active',
  'store_logo_url', 'store_banner_url', 'store_primary_color',
  'store_whatsapp', 'store_instagram', 'store_facebook',
  // Tienda — envíos
  'shipping_cost', 'free_shipping_min', 'store_pickup_address',
  // Tienda — landing hero
  'store_hero_title', 'store_hero_subtitle', 'store_hero_cta',
  'store_hero_badge',
  'store_hero_image_url', 'store_hero_image_2_url', 'store_hero_image_3_url',
  // Tienda — landing secciones
  'store_marquee',
  'store_categories_title',
  'store_featured_title', 'store_featured_subtitle',
  // Tienda — spotlight (3 clientes destacados)
  'store_spotlight_1_image', 'store_spotlight_1_title', 'store_spotlight_1_subtitle', 'store_spotlight_1_link',
  'store_spotlight_2_image', 'store_spotlight_2_title', 'store_spotlight_2_subtitle', 'store_spotlight_2_link',
  'store_spotlight_3_image', 'store_spotlight_3_title', 'store_spotlight_3_subtitle', 'store_spotlight_3_link',
  // Tienda — landing banner promo
  'store_promo_image_url', 'store_promo_title',
  'store_promo_subtitle', 'store_promo_cta',
  // Tienda — barra de promociones (pills)
  'store_promo_pills',
  // Tienda — transferencia bancaria
  'bank_transfer_cbu', 'bank_transfer_alias', 'bank_transfer_holder',
];

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await Settings.findAll({ where: { key: VALID_KEYS } });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value ?? '';
  }
  return map;
}

export async function updateSettings(
  data: Record<string, string>
): Promise<Record<string, string>> {
  const entries = Object.entries(data).filter(([k]) => VALID_KEYS.includes(k));
  if (!entries.length) return getAllSettings();

  const now = new Date();
  await sequelize.transaction(async (t) => {
    for (const [key, value] of entries) {
      await Settings.upsert(
        { key, value: value ?? '', createdAt: now, updatedAt: now },
        { transaction: t }
      );
    }
  });

  return getAllSettings();
}
