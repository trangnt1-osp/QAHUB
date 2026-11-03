const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 20 });

/** Presentation only: keep original numeric values for sorting and API requests. */
export function fmtNumber(value: number | bigint | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  const number = Object.is(value, -0) ? 0 : value;
  return options ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 20, ...options }).format(number) : decimal.format(number);
}

/** Parse Vietnamese input and reject incorrectly grouped values. */
export function parseNumber(value: string): number {
  const input = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(input)) return NaN;
  return Number(input.replace(/\./g, '').replace(',', '.'));
}
