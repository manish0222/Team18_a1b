// Workflow 1 - book a trip through sp_book_trip_atomic.
// Shows: balance before -> after, the audit row the trigger wrote, and a
// specific explanation (with a way out) when the database refuses.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useActor } from '../lib/actor';
import { money, dateTime, distance, STATUS_LABEL } from '../lib/format';
import { Link, useLocation } from '../lib/router';
import { useToast } from '../lib/toast';
import type { BookingResult, NearbyResponse, StatusChangeResult, Trip, VehicleDetail, VehicleSummary } from '../types';
import { RiderPicker, VehiclePicker } from '../components/pickers';
import { AuditTable } from '../components/AuditTable';
import { TripActions, TripStepper } from '../components/TripActions';
import { Button, ClassTag, EmptyState, PageHeader, Panel, PersonCell, Plate, StatusBadge, TextInput, Money } from '../components/ui';

type Outcome =
  | { kind: 'success'; result: BookingResult }
  | { kind: 'error'; error: ApiError; fare: number };

type ChosenVehicle = Pick<VehicleSummary, 'id' | 'license_plate' | 'class'>;

const QUICK_FARES = [25, 80, 150];
// Default pickup for suggestions: HITEC City, the centre of the seeded area
const PICKUP = { name: 'HITEC City', lat: 17.4435, lng: 78.382 };

export function BookRide() {
  const { query } = useLocation();
  const { rider, riderId, setRiderId, refresh } = useActor();
  const toast = useToast();
  const [vehicle, setVehicle] = useState<ChosenVehicle | null>(null);
  const [fare, setFare] = useState('25.00');
  const [fareError, setFareError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [topupBusy, setTopupBusy] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // ?vehicle=<id> (from the map's "Book" button) preselects the vehicle
  const vehicleParam = query.get('vehicle');
  useEffect(() => {
    if (!vehicleParam) return;
    api.get<VehicleDetail>(`/vehicles/${vehicleParam}`)
      .then((v) => setVehicle({ id: v.id, license_plate: v.license_plate, class: v.class }))
      .catch(() => {});
  }, [vehicleParam]);

  // Bring the result into view (it sits below the form on phones) and move
  // keyboard / screen-reader focus to it.
  useEffect(() => {
    if (!outcome || !resultRef.current) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    resultRef.current.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [outcome]);

  function validate(): number | null {
    const n = Number(fare);
    if (!fare.trim() || Number.isNaN(n)) { setFareError('Enter the fare as a number, e.g. 45.50.'); return null; }
    if (n <= 0) { setFareError('The fare must be more than zero.'); return null; }
    if (n > 99_999_999) { setFareError('That fare is too large.'); return null; }
    setFareError(null);
    return Math.round(n * 100) / 100;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = validate();
    if (amount === null || !riderId || !vehicle) return;
    setSubmitting(true);
    setOutcome(null);
    try {
      const result = await api.post<BookingResult>('/trips', { riderId, vehicleId: vehicle.id, fare: amount });
      setOutcome({ kind: 'success', result });
      toast('Trip booked');
    } catch (err) {
      setOutcome({ kind: 'error', error: err as ApiError, fare: amount });
    } finally {
      setSubmitting(false);
      refresh();
    }
  }

  async function topUp(amount: number) {
    if (!riderId) return;
    setTopupBusy(true);
    try {
      await api.post(`/riders/${riderId}/topup`, { amount });
      toast(`Added ${money(amount)} to the wallet`);
      setOutcome(null);
      refresh();
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setTopupBusy(false);
    }
  }

  function onTripChanged(r: StatusChangeResult) {
    refresh();
    setOutcome((o) => {
      if (o?.kind === 'success' && o.result.trip.id === r.trip.id) {
        return { kind: 'success', result: { ...o.result, trip: r.trip, audit_entries: r.audit_entries } };
      }
      // the blocking trip was moved on: clear the error so the rider can retry
      return null;
    });
  }

  const balance = rider?.wallet_balance ?? null;
  const fareNumber = Number(fare);
  const fareValid = fare.trim() !== '' && Number.isFinite(fareNumber) && fareNumber > 0;
  const overBalance = fareValid && balance !== null && fareNumber > balance;
  const fareHint = overBalance
    ? `That is ${money(fareNumber - (balance ?? 0))} more than the wallet holds, so the database will refuse it. Top up first, or try it to see the refusal.`
    : balance !== null && fareValid ? `${money((balance ?? 0) - fareNumber)} will be left in the wallet.` : undefined;

  return (
    <>
      <PageHeader
        title="Book a trip"
        intro={<>The fare is taken from the wallet and held for the trip. All of it happens inside one stored procedure, <code>sp_book_trip_atomic</code>, so a booking either fully happens or not at all.</>}
      />

      <div className="grid grid--book">
        <Panel title="Trip details">
          <form className="form" onSubmit={submit} noValidate>
            <RiderPicker
              id="book-rider"
              label="Rider"
              selected={rider ? <PersonCell name={rider.name} sub={rider.email} size="sm" /> : null}
              onSelect={(r) => { setRiderId(r.id); setOutcome(null); }}
              hint={rider ? 'The rider you are acting as.' : 'Type a name, e.g. Reddy.'}
            />
            <div className="stack stack--tight">
              <VehiclePicker
                id="book-vehicle"
                label="Vehicle"
                selected={vehicle ? <span className="inline-row"><Plate plate={vehicle.license_plate} /><ClassTag value={vehicle.class} /></span> : null}
                onSelect={(v) => { setVehicle(v); setOutcome(null); }}
                onClear={vehicle ? () => setVehicle(null) : undefined}
                hint={vehicle ? undefined : <>Pick one nearby below, search by plate, or choose on the <Link to="/map">live map</Link>.</>}
              />
              {!vehicle && <NearbySuggestions onPick={(v) => { setVehicle(v); setOutcome(null); }} />}
            </div>
            <div className="stack stack--tight">
              <TextInput
                label="Fare (₹)"
                inputMode="decimal"
                value={fare}
                onChange={(e) => { setFare(e.target.value); if (fareError) setFareError(null); }}
                onBlur={() => fare && validate()}
                error={fareError}
                hint={fareHint}
                hintTone={overBalance ? 'warn' : undefined}
                name="fare"
              />
              <div className="chip-row" aria-label="Quick fares">
                {QUICK_FARES.map((f) => (
                  <button type="button" key={f} className={`chip ${fareNumber === f ? 'is-on' : ''}`} aria-pressed={fareNumber === f}
                    onClick={() => { setFare(f.toFixed(2)); setFareError(null); }}>{money(f)}</button>
                ))}
                {balance !== null && (
                  <button type="button" className="chip chip--warn" onClick={() => { setFare((balance + 50).toFixed(2)); setFareError(null); }}>
                    More than the balance
                  </button>
                )}
              </div>
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" busy={submitting} disabled={!riderId || !vehicle}>
                {submitting ? 'Booking…' : `Book trip${fareValid ? ` · ${money(fareNumber)}` : ''}`}
              </Button>
              {!riderId && <span className="muted">Choose a rider first.</span>}
              {riderId && !vehicle && <span className="muted">Choose a vehicle.</span>}
            </div>
          </form>
        </Panel>

        <div className="stack">
          <Panel title="Wallet">
            {!rider ? (
              <EmptyState title="No rider selected">Choose a rider to see their balance.</EmptyState>
            ) : outcome?.kind === 'success' ? (
              <BalanceChange before={outcome.result.balance_before} after={outcome.result.balance_after} />
            ) : (
              <div className="balance-now">
                <span className="balance-label">Balance before booking</span>
                <Money value={rider.wallet_balance} className="balance-big" />
                {rider.active_trip && (
                  <p className="note note--live">
                    {rider.name.split(' ')[0]} already has a trip that is {STATUS_LABEL[rider.active_trip.status].toLowerCase()}.
                    Booking again will be refused by the database.
                  </p>
                )}
              </div>
            )}
          </Panel>

          <div aria-live="polite" ref={resultRef} className="result-anchor">
            {outcome?.kind === 'success' && <BookingSuccess result={outcome.result} onTripChanged={onTripChanged} />}
            {outcome?.kind === 'error' && (
              <BookingFailure outcome={outcome} onTopUp={topUp} topupBusy={topupBusy} onTripChanged={onTripChanged} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Four nearest available vehicles to a default pickup, one click to choose.
 *  Uses the same $geoNear endpoint as the map; hides itself if MongoDB is down. */
function NearbySuggestions({ onPick }: { onPick: (v: ChosenVehicle) => void }) {
  const [items, setItems] = useState<NearbyResponse['results'] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.get<NearbyResponse>('/map/nearby', { lat: PICKUP.lat, lng: PICKUP.lng, limit: 4, windowMinutes: 60 }, controller.signal)
      .then((r) => setItems(r.results.filter((x) => x.vehicle)))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, []);
  if (items === null) return <p className="muted small">Finding vehicles near {PICKUP.name}…</p>;
  if (!items.length) return null;
  return (
    <div className="suggest">
      <p className="suggest-title">Available near {PICKUP.name}</p>
      <ul className="suggest-list">
        {items.map((r) => (
          <li key={r.vehicle_id}>
            <button type="button" className="suggest-item" onClick={() => onPick({ id: r.vehicle_id, license_plate: r.vehicle!.license_plate, class: r.vehicle!.class })}>
              <Plate plate={r.vehicle!.license_plate} size="sm" />
              <ClassTag value={r.vehicle!.class} />
              <span className="suggest-dist num">{distance(r.distance_meters)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BalanceChange({ before, after }: { before: number; after: number }) {
  return (
    <div className="balance-change" data-testid="balance-change">
      <div><span className="balance-label">Before</span><Money value={before} className="balance-big" /></div>
      <div className="balance-arrow" aria-hidden="true">→</div>
      <div><span className="balance-label">After</span><Money value={after} className="balance-big" /></div>
      <div className="balance-delta"><Money value={after - before} signed /> held for this trip</div>
    </div>
  );
}

function BookingSuccess({ result, onTripChanged }: { result: BookingResult; onTripChanged: (r: StatusChangeResult) => void }) {
  const t = result.trip;
  const debit = result.audit_entries.find((a) => a.action_type === 'TRIP_ESCROW_DEBIT');
  return (
    <Panel title="Trip booked" className="panel--success">
      <div className="stack">
        <div className="inline-row">
          <StatusBadge status={t.status} />
          <Plate plate={t.license_plate} />
          <span className="muted">Trip <Link to={`/trips/${t.id}`}>{t.id.slice(0, 8)}</Link> · {dateTime(t.created_at)}</span>
        </div>
        <TripStepper trip={t} />
        <div>
          <h3 className="subhead">New entry in the wallet audit log</h3>
          <p className="muted small">Written by the trigger <code>trg_audit_wallet_balance</code> when the procedure changed the balance, not by the app.</p>
          <AuditTable rows={result.audit_entries} highlightId={debit?.id} />
        </div>
        <div>
          <h3 className="subhead">Move the trip along</h3>
          <TripActions trip={t} onChanged={onTripChanged} />
        </div>
      </div>
    </Panel>
  );
}

function BookingFailure({ outcome, onTopUp, topupBusy, onTripChanged }: {
  outcome: Extract<Outcome, { kind: 'error' }>;
  onTopUp: (amount: number) => void;
  topupBusy: boolean;
  onTripChanged: (r: StatusChangeResult) => void;
}) {
  const { error } = outcome;
  const d = error.details ?? {};
  let title = 'The booking did not go through';
  let body: ReactNode = error.message;
  let action: ReactNode = null;

  if (error.code === 'INSUFFICIENT_BALANCE') {
    const shortfall = Math.ceil(Number(d.shortfall ?? 0));
    title = 'Not enough money in the wallet';
    body = <>The balance is <strong>{money(d.balance)}</strong> but this trip costs <strong>{money(d.required)}</strong>, which is {money(d.shortfall)} short. Nothing was charged.</>;
    action = (
      <div className="btn-row">
        <Button variant="primary" busy={topupBusy} onClick={() => onTopUp(Math.max(shortfall, 1))}>Top up {money(Math.max(shortfall, 1))}</Button>
        <Button busy={topupBusy} onClick={() => onTopUp(500)}>Top up {money(500)}</Button>
      </div>
    );
  } else if (error.code === 'ACTIVE_TRIP_EXISTS') {
    const active: Trip | null = d.active_trip ?? null;
    title = 'This rider is already on a trip';
    body = <>A rider can have only one trip that is requested or in transit. The unique index <code>idx_active_rider_trip</code> refused the second one, and the wallet was not charged. Finish or cancel the current trip, then book again.</>;
    action = active ? (
      <div className="stack stack--tight">
        <div className="inline-row">
          <StatusBadge status={active.status} />
          <Plate plate={active.license_plate} size="sm" />
          <Money value={active.fare_amount} />
          <Link to={`/trips/${active.id}`}>Open trip</Link>
        </div>
        <TripActions trip={active} size="sm" onChanged={onTripChanged} />
      </div>
    ) : null;
  } else if (error.code === 'VEHICLE_UNAVAILABLE') {
    title = 'That vehicle cannot take bookings';
    body = 'It is marked inactive. Choose another vehicle.';
  } else if (error.code === 'INVALID_FARE') {
    title = 'Check the fare';
  }

  return (
    <section className="panel panel--error" role="alert" aria-label={title}>
      <div className="panel-body stack">
        <h2 className="error-heading" tabIndex={-1}>{title}</h2>
        <p>{body}</p>
        {action}
        {d.dbMessage && (
          <details className="db-said">
            <summary>What the database said</summary>
            <code>{d.sqlState ? `[${d.sqlState}] ` : ''}{d.dbMessage}</code>
          </details>
        )}
      </div>
    </section>
  );
}
