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

const KEYS: (keyof CompanySettings)[] = [
  'company_name', 'company_address', 'company_cuit',
  'company_phone', 'company_email', 'invoice_due_days',
];

export async function getAllSettings(): Promise<CompanySettings> {
  const rows = await Settings.findAll({ where: { key: KEYS } });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value ?? '';
  }
  return {
    company_name:     map.company_name     ?? '',
    company_address:  map.company_address  ?? '',
    company_cuit:     map.company_cuit     ?? '',
    company_phone:    map.company_phone    ?? '',
    company_email:    map.company_email    ?? '',
    invoice_due_days: map.invoice_due_days ?? '30',
  };
}

export async function updateSettings(data: Partial<CompanySettings>): Promise<CompanySettings> {
  const entries = Object.entries(data).filter(([k]) => KEYS.includes(k as keyof CompanySettings));
  const now = new Date();
  await sequelize.transaction(async (t) => {
    for (const [key, value] of entries) {
      await Settings.upsert({ key, value: value ?? '', createdAt: now, updatedAt: now }, { transaction: t });
    }
  });
  return getAllSettings();
}
