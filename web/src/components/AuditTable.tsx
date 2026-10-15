// Rows from wallet_audit_logs. Used on the Book, Trip and Wallet screens.
import { ACTION_LABEL, dateTime, shortId } from '../lib/format';
import { Link } from '../lib/router';
import type { AuditEntry } from '../types';
import { DataTable, Money, type Column } from './ui';

export function AuditTable({ rows, showRunning = false, busy = false, highlightId }: { rows: AuditEntry[]; showRunning?: boolean; busy?: boolean; highlightId?: string }) {
  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'When', render: (r) => <span className="nowrap">{dateTime(r.logged_at)}</span> },
    {
      key: 'what', header: 'Movement', render: (r) => (
        <span className="audit-what">
          <span>{ACTION_LABEL[r.action_type] ?? r.action_type}</span>
          <code className="audit-code">{r.action_type}</code>
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount_changed} signed /> },
    { key: 'before', header: 'Before', align: 'right', render: (r) => <Money value={r.balance_before} /> },
    { key: 'after', header: 'After', align: 'right', render: (r) => <Money value={r.balance_after} /> },
  ];
  if (showRunning) {
    columns.push({
      key: 'running', header: 'Running balance', align: 'right', render: (r) => (
        <span className="running">
          <Money value={r.running_balance ?? null} />
          {r.is_consistent === false
            ? <span className="check check--bad" title="Running balance does not match balance_after">✕</span>
            : <span className="check" title="Matches balance_after stored by the trigger">✓</span>}
        </span>
      ),
    });
  }
  columns.push({
    key: 'trip', header: 'Trip', render: (r) => r.reference_trip_id
      ? <Link to={`/trips/${r.reference_trip_id}`} onClick={(e) => e.stopPropagation()}>{shortId(r.reference_trip_id)}</Link>
      : <span className="muted">—</span>,
  });
  return (
    <DataTable
      caption="Wallet audit log entries"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      busy={busy}
      rowClassName={(r) => (r.id === highlightId ? 'is-new' : '')}
    />
  );
}
