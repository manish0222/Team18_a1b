// Formatting helpers. Money is shown in rupees: the seeded city is Hyderabad
// (see README assumptions); the database stores plain NUMERIC(10,2).

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const inrShort = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('en-IN');

export const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : inr.format(v));
export const moneyShort = (v: number | null | undefined) => (v === null || v === undefined ? '—' : inrShort.format(v));
export const count = (v: number | null | undefined) => (v === null || v === undefined ? '—' : num.format(v));

export function signedMoney(v: number) {
  return (v > 0 ? '+' : v < 0 ? '−' : '') + inr.format(Math.abs(v));
}

export function dateTime(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function day(v: string | null | undefined) {
  if (!v) return '—';
  // 'YYYY-MM-DD' -> local date without timezone shifting
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relative(v: string | null | undefined, now = Date.now()) {
  if (!v) return 'never';
  const s = Math.round((now - new Date(v).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function distance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

export const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  IN_TRANSIT: 'In transit',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Button text for moving a trip *to* a status. */
export const TRANSITION_LABEL: Record<string, string> = {
  IN_TRANSIT: 'Start trip',
  COMPLETED: 'Complete trip',
  CANCELLED: 'Cancel and refund',
};

export const ACTION_LABEL: Record<string, string> = {
  TRIP_ESCROW_DEBIT: 'Fare held for trip',
  TRIP_REFUND: 'Refund for cancelled trip',
  TOPUP: 'Wallet top-up',
  TOPUP_OR_REFUND: 'Credit',
  DEBIT_OR_ESCROW: 'Debit',
};

/** Local-midnight ISO string for a YYYY-MM-DD date input (inclusive start). */
export function startOfDayIso(d: string) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toISOString();
}
/** Local midnight of the NEXT day, so "to" is inclusive of the chosen day. */
export function endOfDayIso(d: string) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd + 1).toISOString();
}

export function isoDay(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
