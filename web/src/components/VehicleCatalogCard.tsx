// Readable rendering of a flexible VehicleMetadata document (MongoDB).
// Known fields get a designed layout; anything else the document carries is
// listed generically, so new attributes still show up without code changes.
import { useState } from 'react';
import { dateTime } from '../lib/format';
import type { VehicleMetadata } from '../types';
import { ClassTag, Plate } from './ui';

const FEATURE_LABEL: Record<string, string> = {
  has_child_seat: 'Child seat',
  wheelchair_accessible: 'Wheelchair accessible',
  pet_friendly: 'Pet friendly',
  dashcam_enabled: 'Dashcam',
};

const KNOWN = new Set(['vehicle_id', 'license_plate', 'class', 'inspection_records', 'features', 'updated_at', 'inspection_count']);

function prettify(key: string) {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function VehicleCatalogCard({ doc, showHeader = true }: { doc: VehicleMetadata; showHeader?: boolean }) {
  const [raw, setRaw] = useState(false);
  const inspections = [...(doc.inspection_records ?? [])].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const features = Object.entries(doc.features ?? {});
  const extra = Object.entries(doc).filter(([k]) => !KNOWN.has(k));

  return (
    <article className="catalog">
      {showHeader && (
        <header className="catalog-head">
          <Plate plate={doc.license_plate} size="lg" />
          <ClassTag value={doc.class} />
        </header>
      )}

      <div className="catalog-grid">
        <section>
          <h3>Features</h3>
          {features.length ? (
            <ul className="features">
              {features.map(([k, v]) => (
                <li key={k} className={v ? 'is-yes' : 'is-no'}>
                  <span className="feature-mark" aria-hidden="true">{v ? '✓' : '–'}</span>
                  {FEATURE_LABEL[k] ?? prettify(k)}
                  <span className="sr-only">{v ? ': yes' : ': no'}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No features recorded.</p>}
        </section>

        <section>
          <h3>Inspection history</h3>
          {inspections.length ? (
            <ol className="timeline">
              {inspections.map((r) => (
                <li key={r.inspection_id} className={r.passed ? 'is-pass' : 'is-fail'}>
                  <div className="timeline-head">
                    <strong>{r.passed ? 'Passed' : 'Failed'}</strong>
                    <span className="muted">{dateTime(r.date)}</span>
                  </div>
                  <div className="timeline-body">{r.inspector}</div>
                  {r.notes && <div className="timeline-note">{r.notes}</div>}
                </li>
              ))}
            </ol>
          ) : <p className="muted">No inspections on file.</p>}
        </section>
      </div>

      {extra.length > 0 && (
        <section>
          <h3>Other attributes</h3>
          <dl className="kv">
            {extra.map(([k, v]) => (
              <div key={k}><dt>{prettify(k)}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <footer className="catalog-foot">
        <span className="muted">Document updated {dateTime(doc.updated_at as string)}</span>
        <button type="button" className="link-btn" onClick={() => setRaw((r) => !r)} aria-expanded={raw}>
          {raw ? 'Hide raw document' : 'Show raw document'}
        </button>
      </footer>
      {raw && <pre className="raw-json">{JSON.stringify(doc, null, 2)}</pre>}
    </article>
  );
}
