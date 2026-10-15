// Audit trail: wallet_audit_logs for one rider, date filter, running balance
// (computed in SQL by fn_rider_audit_trail and checked against balance_after).
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useActor } from '../lib/actor';
import { useApi } from '../lib/useApi';
import { setQuery, useLocation } from '../lib/router';
import { useToast } from '../lib/toast';
import { dateTime, endOfDayIso, isoDay, money, startOfDayIso } from '../lib/format';
import type { AuditResponse, RiderDetail } from '../types';
import { RiderPicker } from '../components/pickers';
import { AuditTable } from '../components/AuditTable';
import { LineChart } from '../components/charts';
import {
  AsyncContent, Button, EmptyState, ErrorState, PageHeader, PersonCell, Pagination, Panel, Segmented, Stat, TextInput,
} from '../components/ui';

type Preset = 'all' | '7' | '30' | '90' | 'custom';

export function Wallet() {
  const { query } = useLocation();
  const actor = useActor();
  const riderId = query.get('rider') ?? actor.riderId;
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const page = Number(query.get('page') ?? 1);
  const preset = (query.get('range') as Preset) ?? 'all';

  const rider = useApi<RiderDetail>(riderId ? `/riders/${riderId}` : null);
  const audit = useApi<AuditResponse>(riderId ? `/riders/${riderId}/audit` : null, {
    from: from ? startOfDayIso(from) : undefined,
    to: to ? endOfDayIso(to) : undefined,
    page,
    pageSize: 20,
  });

  function applyPreset(p: Preset) {
    if (p === 'all') return setQuery({ range: null, from: null, to: null, page: null });
    if (p === 'custom') return setQuery({ range: 'custom', page: null });
    const start = new Date();
    start.setDate(start.getDate() - Number(p));
    setQuery({ range: p, from: isoDay(start), to: isoDay(new Date()), page: null });
  }

  const dateError = from && to && from > to ? '“From” must be on or before “To”.' : null;

  return (
    <>
      <PageHeader
        title="Wallet & audit trail"
        intro={<>Every change to a wallet balance is recorded by the trigger <code>trg_audit_wallet_balance</code>. The running balance is recalculated from the log itself, so a ✓ means the stored “after” balance agrees with the history.</>}
      />

      <Panel>
        <div className="filters">
          <div className="filters-wide">
            <RiderPicker
              id="audit-rider"
              label="Rider"
              selected={rider.data ? <PersonCell name={rider.data.name} sub={rider.data.email} size="sm" /> : riderId ? 'Loading…' : null}
              onSelect={(r) => setQuery({ rider: r.id, page: null })}
            />
          </div>
          <div className="field">
            <span className="label-text">Period</span>
            <Segmented<Preset>
              label="Period"
              value={preset}
              onChange={applyPreset}
              options={[
                { value: 'all', label: 'All time' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' },
                { value: '90', label: '90 days' }, { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>
          {preset === 'custom' && (
            <>
              <TextInput label="From" type="date" value={from} max={to || undefined} onChange={(e) => setQuery({ from: e.target.value, page: null })} />
              <TextInput label="To" type="date" value={to} min={from || undefined} onChange={(e) => setQuery({ to: e.target.value, page: null })} error={dateError} />
            </>
          )}
        </div>
      </Panel>

      {!riderId ? (
        <Panel><EmptyState title="Choose a rider to see their wallet history.">Pick one above, or set who you are acting as in the menu.</EmptyState></Panel>
      ) : dateError ? null : (
        <AsyncContent state={audit} rows={6}>
          {(a) => (
            <>
              <div className="grid grid--2-1">
                <Panel title="Balance over time" aside={<span className="muted">{a.total ? `${a.total} entries` : ''}</span>}>
                  {a.series.length ? (
                    <LineChart
                      ariaLabel={`Running wallet balance for ${a.rider.name}`}
                      step
                      series={[{ id: 'bal', label: 'Running balance', points: a.series.map((p) => ({ x: +new Date(p.logged_at), y: p.running_balance })) }]}
                      formatY={(v) => money(v).replace('.00', '')}
                      formatX={(v) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    />
                  ) : <EmptyState title="No wallet movements in this period.">Try “All time”, or book a trip to create one.</EmptyState>}
                </Panel>
                <Panel title="Summary">
                  <div className="stats stats--2">
                    <Stat label="Opening balance" value={money(a.summary.opening_balance)} />
                    <Stat label="Closing balance" value={money(a.summary.closing_balance)} />
                    <Stat label="Money in" value={money(a.summary.total_in)} />
                    <Stat label="Money out" value={money(a.summary.total_out)} />
                  </div>
                  <p className={`consistency ${a.summary.all_consistent ? 'is-ok' : 'is-bad'}`}>
                    {a.summary.all_consistent
                      ? 'Every running balance matches the balance stored by the trigger.'
                      : 'Some rows do not match. Look for ✕ in the table.'}
                  </p>
                  <p className="muted small">Current wallet balance: <strong>{money(a.rider.wallet_balance)}</strong></p>
                  <TopUpForm riderId={a.rider.id} onDone={() => { audit.reload(); rider.reload(); actor.refresh(); }} />
                </Panel>
              </div>

              <Panel title="Ledger" flush>
                {a.items.length ? (
                  <>
                    <AuditTable rows={a.items} showRunning busy={audit.loading} />
                    <Pagination page={a.page} totalPages={a.totalPages} total={a.total} pageSize={a.pageSize} onChange={(p) => setQuery({ page: p })} />
                  </>
                ) : (
                  <EmptyState title="No entries for these dates.">Widen the period to see older movements.</EmptyState>
                )}
              </Panel>
            </>
          )}
        </AsyncContent>
      )}
    </>
  );
}

function TopUpForm({ riderId, onDone }: { riderId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ balance_after: number; audit_entry: { logged_at: string } }>(`/riders/${riderId}/topup`, { amount });
      toast(`Wallet topped up. New balance ${money(r.balance_after)} (logged ${dateTime(r.audit_entry?.logged_at)})`);
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="topup" onSubmit={submit}>
      <TextInput label="Top up (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button type="submit" busy={busy}>Add money</Button>
      {error && <ErrorState error={error} compact />}
    </form>
  );
}
