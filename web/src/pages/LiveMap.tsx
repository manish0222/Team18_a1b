// Workflow 3 - nearest available vehicles within 5 km ($geoNear).
// Polls every 5 s; vehicles that appear since the previous poll are marked new.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../lib/useApi';
import { navigate } from '../lib/router';
import { distance, relative } from '../lib/format';
import type { NearbyResponse } from '../types';
import { MapView, type LatLng } from '../components/MapView';
import { Button, ClassTag, EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, Plate, Segmented, SelectInput } from '../components/ui';

// Localities inside the seeded area (centre 78.382 E, 17.4435 N, ±0.15°)
const PLACES: { name: string; lat: number; lng: number }[] = [
  { name: 'HITEC City', lat: 17.4435, lng: 78.382 },
  { name: 'Madhapur', lat: 17.4483, lng: 78.3915 },
  { name: 'Gachibowli', lat: 17.4401, lng: 78.3489 },
  { name: 'Kondapur', lat: 17.4600, lng: 78.3639 },
  { name: 'Jubilee Hills', lat: 17.4316, lng: 78.4075 },
  { name: 'Banjara Hills', lat: 17.4126, lng: 78.4483 },
  { name: 'Kukatpally', lat: 17.4849, lng: 78.4138 },
  { name: 'Financial District', lat: 17.4130, lng: 78.3400 },
];

const RADIUS = 5000;
type Win = '5' | '15' | '60';

export function LiveMap() {
  const [origin, setOrigin] = useState<LatLng & { name?: string }>({ ...PLACES[0] });
  const [windowMin, setWindowMin] = useState<Win>('15');
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const nearby = useApi<NearbyResponse>(
    '/map/nearby',
    { lat: origin.lat.toFixed(6), lng: origin.lng.toFixed(6), radius: RADIUS, limit: 25, windowMinutes: windowMin },
    { pollMs: live ? 5000 : undefined },
  );

  // Track which vehicles are new compared with the previous poll at the same origin
  const prev = useRef<{ key: string; ids: Set<string>; pings: Map<string, string> } | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [movedIds, setMovedIds] = useState<Set<string>>(new Set());
  const originKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)},${windowMin}`;
  useEffect(() => {
    const d = nearby.data;
    if (!d) return;
    const ids = new Set(d.results.map((r) => r.vehicle_id));
    const pings = new Map(d.results.map((r) => [r.vehicle_id, r.ping_id]));
    if (prev.current && prev.current.key === originKey) {
      const p = prev.current;
      setNewIds(new Set([...ids].filter((id) => !p.ids.has(id))));
      setMovedIds(new Set([...ids].filter((id) => p.ids.has(id) && p.pings.get(id) !== pings.get(id))));
    } else {
      setNewIds(new Set());
      setMovedIds(new Set());
    }
    prev.current = { key: originKey, ids, pings };
  }, [nearby.data, originKey]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const results = nearby.data?.results ?? [];
  const placeValue = useMemo(() => PLACES.find((p) => p.name === origin.name)?.name ?? '', [origin.name]);

  return (
    <>
      <PageHeader
        title="Live map"
        intro={<>Available vehicles within 5 km, nearest first. The search is the <code>$geoNear</code> pipeline on the <code>TelemetryPings</code> collection. Click the map to search from somewhere else.</>}
      />

      <Panel>
        <div className="filters">
          <SelectInput
            label="Search from"
            value={placeValue}
            onChange={(e) => {
              const p = PLACES.find((x) => x.name === e.target.value);
              if (p) { setOrigin({ ...p }); setSelected(null); }
            }}
          >
            {!placeValue && <option value="">Point on map ({origin.lat.toFixed(4)}, {origin.lng.toFixed(4)})</option>}
            {PLACES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </SelectInput>
          <div className="field">
            <span className="label-text">Pings from the last</span>
            <Segmented<Win> label="Ping age" value={windowMin} onChange={setWindowMin}
              options={[{ value: '5', label: '5 min' }, { value: '15', label: '15 min' }, { value: '60', label: '1 hour' }]} />
          </div>
          <div className="field">
            <span className="label-text">Updates</span>
            <div className="inline-row">
              <Button size="sm" variant={live ? 'secondary' : 'primary'} onClick={() => setLive((l) => !l)} aria-pressed={live}>
                {live ? 'Pause live updates' : 'Resume live updates'}
              </Button>
              <span className="muted small live-status" aria-live="off">
                {live && <span className="dot-live" />}
                {nearby.data ? `Updated ${relative(nearby.data.generated_at, now)} · query ${nearby.data.query_ms} ms` : 'Loading…'}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid--map">
        <Panel flush className="map-panel">
          <MapView
            origin={origin}
            radius={RADIUS}
            results={results}
            newIds={newIds}
            selectedId={selected}
            onOriginChange={(p) => { setOrigin(p); setSelected(null); }}
            onSelect={setSelected}
          />
        </Panel>

        <Panel
          title="Nearest vehicles"
          aside={nearby.data && <span className="muted small">{results.length} within {RADIUS / 1000} km</span>}
          flush
        >
          {nearby.error && !nearby.data ? (
            <div className="panel-pad"><ErrorState error={nearby.error} onRetry={nearby.reload} /></div>
          ) : !nearby.data ? (
            <div className="panel-pad"><LoadingBlock rows={6} /></div>
          ) : !results.length ? (
            <EmptyState title="No available vehicles within 5 km.">
              Try a longer ping window or another part of the city. If the map stays empty everywhere, check that the API’s live pings are on.
            </EmptyState>
          ) : (
            <>
              {nearby.error && <div className="panel-pad"><ErrorState error={nearby.error} compact /></div>}
              <ol className="nearby" aria-label="Vehicles sorted by distance">
                {results.map((r, i) => (
                  <li
                    key={r.vehicle_id}
                    className={`${selected === r.vehicle_id ? 'is-selected' : ''} ${newIds.has(r.vehicle_id) ? 'is-new' : ''}`}
                    onClick={() => setSelected(r.vehicle_id)}
                  >
                    <span className="nearby-rank">{i + 1}</span>
                    <div className="nearby-main">
                      <div className="inline-row">
                        <Plate plate={r.vehicle?.license_plate} size="sm" />
                        {r.vehicle && <ClassTag value={r.vehicle.class} />}
                        {newIds.has(r.vehicle_id) && <span className="tag-new">New</span>}
                        {movedIds.has(r.vehicle_id) && !newIds.has(r.vehicle_id) && <span className="tag-moved">Moved</span>}
                      </div>
                      <div className="nearby-meta muted small">
                        {Math.round(r.speed_kmh)} km/h · pinged {relative(r.created_at, now)}
                      </div>
                    </div>
                    <div className="nearby-side">
                      <strong className="num">{distance(r.distance_meters)}</strong>
                      {r.vehicle && (
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); navigate('/book', { vehicle: r.vehicle_id }); }}>Book</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
