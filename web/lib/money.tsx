/**
 * The API always serializes money as a decimal STRING (e.g. "49.99", "100")
 * to avoid float-precision loss over JSON — see the backend's own
 * Decimal-serialization convention (decimal.js's toJSON aliases
 * toString()). This only ever formats for display; no arithmetic happens
 * on the parsed number here, so float imprecision from Number() is not a
 * concern the way it would be if this value were computed on.
 */
export function formatMoney(value: string, currency: string = 'usd'): string {
  const amount = Number(value);
  if (Number.isNaN(amount)) return value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
}

export function Money({ value, currency = 'usd' }: { value: string; currency?: string }) {
  return <span>{formatMoney(value, currency)}</span>;
}
