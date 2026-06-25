// Tipos y enums compartidos en todo el proyecto

export type UserRole = 'admin' | 'billing' | 'workshop' | 'seller';

export type OrderStatus =
  | 'pending'
  | 'under_review'
  | 'workshop_review'
  | 'observed'
  // ── Controles de producción (flujo nuevo) ──
  | 'raw_material_control'   // Control de materias primas
  | 'cutting_control'        // Control de corte
  | 'printing_control'       // Control de sublimación y estampado
  | 'sewing_control'         // Control de confección y medidas
  | 'quality_control'        // Control de calidad
  | 'packaging_control'      // Control de embalaje
  | 'ready'                  // Listo para despacho
  | 'cancelled'
  // ── Estados legados (conservados solo para el historial) ──
  | 'in_production'
  | 'sewing'
  | 'stamping'
  | 'quality_check';

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

// ─── Tipos de la Ficha Técnica ────────────────────────────────────────────────

// Tipo de cuello (V, Redondo, Mao)
export type CollarType = 'v' | 'round' | 'mao';

// Tipo de manga (Ranglan o Clásica)
export type SleeveType = 'raglan' | 'classic';

// Un sponsor en la ficha técnica: elemento + ubicación física en la prenda
export interface Sponsor {
  element: string;   // "Escudo del club", "Marca", "Sponsor principal", etc.
  location: string;  // "Pecho izquierdo", "Espalda superior", "Manga derecha", etc.
}

// Datos de personalización individual (número, nombre)
export interface Customization {
  number_on_back: boolean;
  number_on_chest: boolean;
  player_name: boolean;
  number_font?: string;           // Tipografía (ej: "IND_Ñ")
  number_color_home?: string;     // Color número titular
  number_color_away?: string;     // Color número alternativa
}

// ─── Mapas y tipos auxiliares ─────────────────────────────────────────────────

// Mapa de tallas para OrderItem: { "id_de_SizeChart": cantidad }
// Ej: { "1": 5, "2": 10, "3": 8 } donde 1,2,3 son IDs de SizeChart
export type SizesMap = Record<string, number>;

// ─── JWT y Auth ───────────────────────────────────────────────────────────────

export interface JwtPayload {
  id: number;
  email: string;
  role: UserRole;
  session_version: number;
}

import { Request } from 'express';
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// ─── Respuestas estándar ──────────────────────────────────────────────────────

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorResponse {
  success: false;
  message: string;
  errors?: unknown[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}
