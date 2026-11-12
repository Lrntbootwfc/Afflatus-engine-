/** Escape dynamic content for HTML email bodies. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip CR/LF from header-like fields to prevent injection. */
export function sanitizeHeaderValue(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 500);
}
