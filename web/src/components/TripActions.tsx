// Status buttons for a trip + the trip life-cycle stepper. The allowed moves
// come from the API (mirroring sp_update_trip_status); the database still
// has the final say and its refusal is shown if it says no.
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { STATUS_LABEL, TRANSITION_LABEL, dateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import type { StatusChangeResult, Trip, TripStatus } from '../types';
import { Button, ErrorState } from './ui';

export function TripActions({ trip, onChanged, size = 'md' }: { trip: Trip; onChanged: (r: StatusChangeResult) => void; size?: 'sm' | 'md' }) {
  const [busy, setBusy] = useState<TripStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const toast = useToast();
  const moves = trip.allowed_transitions ?? [];

  async function move(status: TripStatus) {
    setBusy(status);
    setError(null);
    try {
      const r = await api.post<StatusChangeResult>(`/trips/${trip.id}/status`, { status });
      toast(status === 'CANCELLED' ? 'Trip cancelled, fare refunded' : `Trip ${STATUS_LABEL[status].toLowerCase()}`);
      onChanged(r);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  if (!moves.length) return null;
  return (
    <div className="trip-actions">
      <div className="btn-row">
        {moves.map((s) => (
          <Button key={s} size={size} variant={s === 'CANCELLED' ? 'danger' : 'primary'} busy={busy === s} disabled={!!busy} onClick={() => move(s)}>
            {TRANSITION_LABEL[s]}
          </Button>
        ))}
      </div>
      {error && <ErrorState error={error} compact />}
    </div>
  );
}

/** REQUESTED -> IN_TRANSIT -> COMPLETED, with CANCELLED as the side exit. */
export function TripStepper({ trip }: { trip: Trip }) {
  const order: TripStatus[] = ['REQUESTED', 'IN_TRANSIT', 'COMPLETED'];
  const cancelled = trip.status === 'CANCELLED';
  const reached = cancelled ? -1 : order.indexOf(trip.status);
  return (
    <ol className={`stepper ${cancelled ? 'stepper--cancelled' : ''}`} aria-label="Trip progress">
      {order.map((s, i) => (
        <li key={s} className={i < reached ? 'is-done' : i === reached ? 'is-current' : ''} aria-current={i === reached ? 'step' : undefined}>
          <span className="stepper-dot" aria-hidden="true" />
          <span className="stepper-label">{STATUS_LABEL[s]}</span>
          {s === 'REQUESTED' && <span className="stepper-time">{dateTime(trip.created_at)}</span>}
          {s === 'COMPLETED' && trip.completed_at && <span className="stepper-time">{dateTime(trip.completed_at)}</span>}
        </li>
      ))}
      {cancelled && (
        <li className="is-cancelled" aria-current="step">
          <span className="stepper-dot" aria-hidden="true" />
          <span className="stepper-label">Cancelled</span>
        </li>
      )}
    </ol>
  );
}
