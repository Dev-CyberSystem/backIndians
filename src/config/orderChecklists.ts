import type { OrderStatus } from '../types';

/**
 * Estados de control de producción (a partir de "revisión de taller") con su
 * checklist obligatorio. Para avanzar de un control al siguiente hay que tildar
 * TODOS sus ítems. Los ítems están fijos según el documento de control de calidad.
 *
 * El orden del array define la secuencia: cada control avanza al siguiente y, al
 * "observar", retrocede al anterior.
 */

export interface ChecklistItem {
  key: string;
  label: string;
}

/** Secuencia de estados de control (después de workshop_review, antes de ready). */
export const CONTROL_SEQUENCE: OrderStatus[] = [
  'raw_material_control',
  'cutting_control',
  'printing_control',
  'sewing_control',
  'quality_control',
  'packaging_control',
];

/** Estado previo al primer control y estado final (listo para despacho). */
export const BEFORE_FIRST_CONTROL: OrderStatus = 'workshop_review';
export const AFTER_LAST_CONTROL: OrderStatus = 'ready'; // "Listo para despacho"

export const ORDER_CHECKLISTS: Record<string, ChecklistItem[]> = {
  raw_material_control: [
    { key: 'fabric_color',       label: 'Tela: color según muestra aprobada' },
    { key: 'fabric_weight',      label: 'Tela: gramaje especificado' },
    { key: 'fabric_width',       label: 'Tela: ancho útil' },
    { key: 'fabric_composition', label: 'Tela: composición textil' },
    { key: 'fabric_defects',     label: 'Tela: sin defectos visibles (manchas, agujeros, líneas, tono)' },
    { key: 'supply_labels',      label: 'Insumos: etiquetas' },
    { key: 'supply_threads',     label: 'Insumos: hilos' },
    { key: 'supply_elastics',    label: 'Insumos: elásticos' },
    { key: 'supply_zippers',     label: 'Insumos: cierres' },
    { key: 'supply_pullers',     label: 'Insumos: tiradores' },
    { key: 'supply_bags',        label: 'Insumos: bolsas' },
    { key: 'supply_trims',       label: 'Insumos: avíos' },
  ],
  cutting_control: [
    { key: 'molds',          label: 'Moldes correctos' },
    { key: 'size',           label: 'Talle correcto' },
    { key: 'quantity',       label: 'Cantidad correcta' },
    { key: 'fabric_grain',   label: 'Sentido de la tela' },
    { key: 'sublim_align',   label: 'Alineación de diseño sublimado' },
    { key: 'panel_match',    label: 'Coincidencia de paneles' },
  ],
  printing_control: [
    { key: 'color_tone',     label: 'Tonalidad de colores' },
    { key: 'print_def',      label: 'Definición de impresión' },
    { key: 'logos_pos',      label: 'Posición de logos' },
    { key: 'crests_pos',     label: 'Posición de escudos' },
    { key: 'sponsors_pos',   label: 'Posición de sponsors' },
    { key: 'names_numbers',  label: 'Nombres y números' },
    { key: 'no_marks',       label: 'Ausencia de manchas o quemaduras' },
  ],
  sewing_control: [
    { key: 'm_total_length',  label: 'Medidas: largo total' },
    { key: 'm_chest',         label: 'Medidas: ancho de pecho' },
    { key: 'm_waist',         label: 'Medidas: ancho de cintura' },
    { key: 'm_sleeve',        label: 'Medidas: largo de manga' },
    { key: 'm_specific',      label: 'Medidas: específicas según producto' },
    { key: 'a_collars',       label: 'Armado: cuellos correctamente colocados' },
    { key: 'a_sleeves',       label: 'Armado: mangas alineadas' },
    { key: 'a_sides',         label: 'Armado: laterales simétricos' },
    { key: 'a_finishes',      label: 'Armado: terminaciones prolijas' },
    { key: 's_no_skipped',    label: 'Costuras: sin puntadas saltadas' },
    { key: 's_no_breaks',     label: 'Costuras: sin roturas' },
    { key: 's_no_puckers',    label: 'Costuras: sin frunces' },
    { key: 's_tension',       label: 'Costuras: sin diferencias de tensión' },
  ],
  quality_control: [
    { key: 'q_measures',   label: 'Medidas correctas' },
    { key: 'q_colors',     label: 'Colores correctos' },
    { key: 'q_logos',      label: 'Logos correctos' },
    { key: 'q_crests',     label: 'Escudos correctos' },
    { key: 'q_sponsors',   label: 'Sponsors correctos' },
    { key: 'q_names',      label: 'Nombres correctos' },
    { key: 'q_numbers',    label: 'Números correctos' },
    { key: 'q_labels',     label: 'Etiquetas colocadas' },
    { key: 'q_no_stains',  label: 'Sin manchas' },
    { key: 'q_no_threads', label: 'Sin hilos sueltos' },
    { key: 'q_no_defects', label: 'Sin defectos de costura' },
    { key: 'q_clean',      label: 'Prenda limpia' },
    { key: 'q_packaging',  label: 'Embalaje correcto' },
  ],
  packaging_control: [
    { key: 'p_size_bag',     label: 'Talle correcto en bolsa' },
    { key: 'p_quantities',   label: 'Cantidades correctas' },
    { key: 'p_order',        label: 'Orden de embalaje' },
    { key: 'p_ext_label',    label: 'Etiquetado externo' },
    { key: 'p_complete',     label: 'Control de pedido completo' },
  ],
};

/** ¿Es un estado de control con checklist? */
export function isControlStatus(status: string): boolean {
  return status in ORDER_CHECKLISTS;
}

/** Siguiente estado en la secuencia (o ready tras el último control). */
export function nextControlStatus(status: OrderStatus): OrderStatus | null {
  const i = CONTROL_SEQUENCE.indexOf(status);
  if (i === -1) return null;
  return i === CONTROL_SEQUENCE.length - 1 ? AFTER_LAST_CONTROL : CONTROL_SEQUENCE[i + 1];
}

/** Estado anterior en la secuencia (o workshop_review antes del primero). */
export function prevControlStatus(status: OrderStatus): OrderStatus | null {
  const i = CONTROL_SEQUENCE.indexOf(status);
  if (i === -1) return null;
  return i === 0 ? BEFORE_FIRST_CONTROL : CONTROL_SEQUENCE[i - 1];
}

/** Claves de todos los ítems de un control. */
export function checklistKeys(status: string): string[] {
  return (ORDER_CHECKLISTS[status] ?? []).map((i) => i.key);
}
