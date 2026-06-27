/**
 * Escapa caracteres especiales de HTML para evitar XSS al interpolar datos del
 * usuario (nombres, títulos de productos, direcciones) dentro de emails HTML u
 * otro markup generado en el servidor.
 */
export function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default escapeHtml;
