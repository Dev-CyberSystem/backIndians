/**
 * Documentos legales de la tienda online (versionado).
 *
 * La versión es lo único que hace útil la constancia de aceptación: sin ella
 * no se puede probar QUÉ texto aceptó el comprador. Regla operativa:
 *
 *   - Cambio de fondo en un texto legal (qué se cobra, cómo se devuelve, qué
 *     datos se tratan) → subir `version` y `effective_date` acá y en el texto
 *     del frontend. Las aceptaciones viejas quedan atadas a la versión vieja.
 *   - Corrección de tipeo o redacción sin cambio de fondo → no subir versión.
 *
 * Los textos viven en el frontend (`frontIndians/src/pages/store/legal/`);
 * acá solo vive la versión vigente, que es la que se estampa en
 * `legal_acceptances`.
 */

export type LegalDocumentKey = 'terms' | 'privacy';

export interface LegalDocumentMeta {
  /** Versión vigente del documento (la que se estampa al aceptar). */
  version: string;
  /** Fecha de vigencia de esa versión (ISO, sin hora). */
  effective_date: string;
  /** Título tal como se muestra al comprador. */
  title: string;
  /** Path público en la tienda. */
  path: string;
}

export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocumentMeta> = {
  terms: {
    version: '1.0',
    effective_date: '2026-08-18',
    title: 'Términos y Condiciones',
    path: '/tienda/legal/terminos',
  },
  privacy: {
    version: '1.0',
    effective_date: '2026-08-18',
    title: 'Política de Privacidad',
    path: '/tienda/legal/privacidad',
  },
};

export const LEGAL_DOCUMENT_KEYS = Object.keys(LEGAL_DOCUMENTS) as LegalDocumentKey[];

/**
 * Etiqueta que se guarda en `legal_acceptances.version` cuando se aceptan los
 * dos documentos juntos (que es el único flujo que existe hoy: el checkbox
 * cubre T&C + Privacidad). Se guarda una fila por documento, cada una con su
 * propia versión — esta función solo resuelve la versión vigente de cada uno.
 */
export function currentVersion(doc: LegalDocumentKey): string {
  return LEGAL_DOCUMENTS[doc].version;
}
