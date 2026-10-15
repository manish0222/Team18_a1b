// "Acting as" rider for demos (no real login). Stored in localStorage so a
// reload keeps the same rider.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { RiderDetail } from '../types';

const KEY = 'ridesync.actorRiderId';

interface ActorContextValue {
  riderId: string | null;
  rider: RiderDetail | null;
  loading: boolean;
  setRiderId: (id: string | null) => void;
  /** Re-read balance / active trip after something changed it. */
  refresh: () => void;
}

const ActorContext = createContext<ActorContextValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function ActorProvider({ children }: { children: ReactNode }) {
  const [riderId, setRiderIdState] = useState<string | null>(readStored);
  const [rider, setRider] = useState<RiderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const setRiderId = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: keep it in memory only */
    }
    setRiderIdState(id);
  }, []);

  useEffect(() => {
    if (!riderId) {
      setRider(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<RiderDetail>(`/riders/${riderId}`)
      .then((r) => !cancelled && setRider(r))
      .catch((e) => {
        if (cancelled) return;
        // stored id no longer exists (database re-seeded) -> forget it
        if (e?.code === 'RIDER_NOT_FOUND' || e?.code === 'INVALID_ID') setRiderId(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [riderId, tick, setRiderId]);

  const value = useMemo(
    () => ({ riderId, rider, loading, setRiderId, refresh: () => setTick((t) => t + 1) }),
    [riderId, rider, loading, setRiderId],
  );
  return <ActorContext.Provider value={value}>{children}</ActorContext.Provider>;
}

export function useActor() {
  const ctx = useContext(ActorContext);
  if (!ctx) throw new Error('useActor must be used inside <ActorProvider>');
  return ctx;
}
