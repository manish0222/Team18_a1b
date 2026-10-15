// Shared building blocks. Every screen is composed from these so spacing,
// colour and states look the same everywhere.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import type { ApiError } from '../lib/api';
import { STATUS_LABEL, count, money } from '../lib/format';
import type { TripStatus, VehicleClass } from '../types';

/* ---------- Buttons ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary', size = 'md', busy = false, children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${busy ? 'is-busy' : ''} ${className}`}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- Layout ---------- */
export function PageHeader({ title, intro, actions }: { title: ReactNode; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {intro && <p className="page-intro">{intro}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title, aside, children, className = '', flush = false, id,
}: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; flush?: boolean; id?: string }) {
  return (
    <section className={`panel ${flush ? 'panel--flush' : ''} ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || aside) && (
        <div className="panel-head">
          {title && <h2 tabIndex={-1}>{title}</h2>}
          {aside && <div className="panel-aside">{aside}</div>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

/* ---------- Form controls ---------- */
export function Field({ label, hint, error, children, htmlFor, hintTone }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; hintTone?: 'warn' }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className={`field-hint ${hintTone ? `field-hint--${hintTone}` : ''}`} aria-live="polite">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ label, hint, error, hintTone, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; hintTone?: 'warn' }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id} hintTone={hintTone}>
      <input id={rest.id ?? id} className="input" aria-invalid={!!error || undefined} {...rest} />
    </Field>
  );
}

export function SelectInput({ label, hint, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={rest.id ?? id}>
      <select id={rest.id ?? id} className="input" {...rest}>{children}</select>
    </Field>
  );
}

/* ---------- Domain atoms ---------- */

const AVATAR_TONES = [
  ['#E3F2F0', '#075A54'], ['#E7E9F8', '#2D3A8C'], ['#F6EBDD', '#7A4A12'], ['#F3E5EC', '#7D2552'],
  ['#E6F0FA', '#1F4E7A'], ['#EEF1E2', '#4A5A16'], ['#F8E6E2', '#8A2E1C'], ['#ECE7F6', '#4B3489'],
];

/** Initials on a colour picked from the name, so the same rider always looks the same. */
export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const clean = (name ?? '?').trim();
  const parts = clean.split(/\s+/);
  const initials = ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  let h = 0;
  for (const ch of clean) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
  return <span className={`avatar avatar--${size}`} style={{ background: bg, color: fg }} aria-hidden="true">{initials}</span>;
}

/** Avatar + name (+ optional second line), the standard way to show a person. */
export function PersonCell({ name, sub, size = 'md' }: { name: string; sub?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className="person">
      <Avatar name={name} size={size} />
      <span className="person-text">
        <span className="person-name">{name}</span>
        {sub && <span className="person-sub">{sub}</span>}
      </span>
    </span>
  );
}

/** Licence plate chip in the style of an Indian HSRP plate. */
export function Plate({ plate, vehicleClass, size = 'md' }: { plate: string | null | undefined; vehicleClass?: VehicleClass | string; size?: 'sm' | 'md' | 'lg' }) {
  if (!plate) return <span className="muted">Unknown vehicle</span>;
  return (
    <span className={`plate plate--${size}`} title={vehicleClass ? `${plate} · ${vehicleClass}` : plate}>
      <span className="plate-band" aria-hidden="true">IND</span>
      <span className="plate-text">{plate}</span>
    </span>
  );
}

export function ClassTag({ value }: { value: VehicleClass | string }) {
  return <span className={`class-tag class-tag--${String(value).toLowerCase()}`}>{value}</span>;
}

export function StatusBadge({ status }: { status: TripStatus | string }) {
  return <span className={`status status--${status.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Money({ value, signed = false, className = '' }: { value: number | null | undefined; signed?: boolean; className?: string }) {
  if (value === null || value === undefined) return <span className="num">—</span>;
  const tone = signed ? (value > 0 ? 'pos' : value < 0 ? 'neg' : '') : '';
  const text = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') + money(Math.abs(value)) : money(value);
  return <span className={`num ${tone ? `num--${tone}` : ''} ${className}`}>{text}</span>;
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'live' | 'warn' }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Stars({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">No rating</span>;
  const full = Math.round(value);
  return (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {'★★★★★'.slice(0, full)}<span className="stars-off">{'★★★★★'.slice(full)}</span>
    </span>
  );
}

/* ---------- States ---------- */
export function LoadingBlock({ label = 'Loading…', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${92 - i * 9}%` }} />)}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false }: { error: ApiError | Error; onRetry?: () => void; compact?: boolean }) {
  const code = (error as ApiError).code;
  const db = (error as ApiError).details?.dbMessage;
  return (
    <div className={`error-box ${compact ? 'error-box--compact' : ''}`} role="alert">
      <p className="error-title">{error.message}</p>
      {code && code !== 'NETWORK' && <p className="error-code">Error code {code}</p>}
      {db && db !== error.message && (
        <details className="db-said">
          <summary>What the database said</summary>
          <code>{db}</code>
        </details>
      )}
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Wraps the three states every data view has. */
export function AsyncContent<T>({
  state, children, empty, isEmpty, rows,
}: {
  state: { data: T | undefined; error?: ApiError; initialLoading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  rows?: number;
}) {
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.initialLoading || state.data === undefined) return <LoadingBlock rows={rows} />;
  if (isEmpty?.(state.data) && empty) return <>{empty}</>;
  return (
    <>
      {state.error && <ErrorState error={state.error} onRetry={state.reload} compact />}
      {children(state.data)}
    </>
  );
}

/* ---------- Table + pagination ---------- */
export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, caption, busy = false, rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  caption?: string;
  busy?: boolean;
  rowClassName?: (row: T) => string;
}) {
  return (
    <div className={`table-wrap ${busy ? 'is-busy' : ''}`} aria-busy={busy || undefined}>
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} style={{ textAlign: c.align ?? 'left' }} className={c.className}>{c.header}</th>)}
            {onRowClick && <th className="row-go" aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`${onRowClick ? 'is-clickable' : ''} ${rowClassName?.(row) ?? ''}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => <td key={c.key} style={{ textAlign: c.align ?? 'left' }} className={c.className}>{c.render(row)}</td>)}
              {onRowClick && <td className="row-go" aria-hidden="true">›</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onChange }: { page: number; totalPages: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-info">{count(first)}–{count(last)} of {count(total)}</span>
      <div className="pagination-buttons">
        <Button size="sm" variant="ghost" onClick={() => onChange(1)} disabled={page <= 1} aria-label="First page">«</Button>
        <Button size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>Previous</Button>
        <span className="pagination-page">Page {count(page)} of {count(totalPages)}</span>
        <Button size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>Next</Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(totalPages)} disabled={page >= totalPages} aria-label="Last page">»</Button>
      </div>
    </nav>
  );
}

/** Segmented control for small option sets (status filters, time windows). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
