// Searchable pickers. They query the API as you type (never load all 10,000
// riders / 2,500 vehicles into the browser).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import type { Page, RiderSummary, VehicleSummary } from '../types';
import { ClassTag, PersonCell, Plate } from './ui';

interface SearchPickerProps<T> {
  label: string;
  placeholder: string;
  search: (q: string, signal: AbortSignal) => Promise<T[]>;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  selected: ReactNode | null;
  onSelect: (item: T) => void;
  onClear?: () => void;
  hint?: ReactNode;
  id?: string;
}

export function SearchPicker<T>({ label, placeholder, search, itemKey, renderItem, selected, onSelect, onClear, hint, id }: SearchPickerProps<T>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const wrapRef = useRef<HTMLDivElement>(null);
  const editing = open || !selected;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatus('loading');
    const t = window.setTimeout(() => {
      search(q.trim(), controller.signal)
        .then((r) => { setItems(r); setActive(0); setStatus('idle'); })
        .catch((e) => { if (e?.name !== 'AbortError') setStatus('error'); });
    }, 220);
    return () => { window.clearTimeout(t); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function choose(item: T) {
    onSelect(item);
    setOpen(false);
    setQ('');
  }

  return (
    <div className="field picker" ref={wrapRef}>
      <label htmlFor={inputId}>{label}</label>
      {!editing ? (
        <div className="picker-selected">
          <div className="picker-selected-body">{selected}</div>
          <button type="button" className="link-btn" onClick={() => setOpen(true)}>Change</button>
          {onClear && <button type="button" className="link-btn" onClick={onClear}>Clear</button>}
        </div>
      ) : (
        <div className="picker-box">
          <input
            id={inputId}
            className="input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder={placeholder}
            value={q}
            autoFocus={open && !!selected}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]); }
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && (
            <ul className="picker-list" id={listId} role="listbox">
              {status === 'loading' && !items.length && <li className="picker-note">Searching…</li>}
              {status === 'error' && <li className="picker-note">Search failed. Is the API running?</li>}
              {status === 'idle' && !items.length && <li className="picker-note">No matches for “{q}”.</li>}
              {items.map((item, i) => (
                <li
                  key={itemKey(item)}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'is-active' : ''}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                >
                  {renderItem(item)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function RiderPicker({ label = 'Rider', selected, onSelect, onClear, hint, id }: {
  label?: string; selected: ReactNode | null; onSelect: (r: RiderSummary) => void; onClear?: () => void; hint?: ReactNode; id?: string;
}) {
  return (
    <SearchPicker<RiderSummary>
      id={id}
      label={label}
      placeholder="Search by name or email"
      hint={hint}
      selected={selected}
      onClear={onClear}
      onSelect={onSelect}
      itemKey={(r) => r.id}
      search={(q, signal) =>
        api.get<Page<RiderSummary>>('/riders', { q, pageSize: 8, sort: q ? 'name' : 'recent' }, signal).then((p) => p.items)}
      renderItem={(r) => (
        <span className="picker-row">
          <PersonCell name={r.name} sub={r.email} size="sm" />
          <span className="num">{money(r.wallet_balance)}{r.has_active_trip && <span className="dot-live" title="Has an active trip" />}</span>
        </span>
      )}
    />
  );
}

export function VehiclePicker({ label = 'Vehicle', selected, onSelect, onClear, hint, id }: {
  label?: string; selected: ReactNode | null; onSelect: (v: VehicleSummary) => void; onClear?: () => void; hint?: ReactNode; id?: string;
}) {
  return (
    <SearchPicker<VehicleSummary>
      id={id}
      label={label}
      placeholder="Search by plate, e.g. TS 09"
      hint={hint}
      selected={selected}
      onClear={onClear}
      onSelect={onSelect}
      itemKey={(v) => v.id}
      search={(q, signal) =>
        api.get<Page<VehicleSummary>>('/vehicles', { q, active: 'true', pageSize: 8 }, signal).then((p) => p.items)}
      renderItem={(v) => (
        <span className="picker-row">
          <Plate plate={v.license_plate} size="sm" />
          <ClassTag value={v.class} />
        </span>
      )}
    />
  );
}
