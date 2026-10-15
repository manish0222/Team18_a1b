// Leaflet map for Workflow 3. Leaflet is used directly (no React wrapper):
// one map instance, three layers (radius circle, origin, vehicles) updated
// when props change. Click anywhere to move the search origin.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NearbyVehicle } from '../types';
import { distance } from '../lib/format';

export interface LatLng { lat: number; lng: number }

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function MapView({
  origin, radius, results, newIds, selectedId, onOriginChange, onSelect,
}: {
  origin: LatLng;
  radius: number;
  results: NearbyVehicle[];
  newIds: Set<string>;
  selectedId: string | null;
  onOriginChange: (p: LatLng) => void;
  onSelect: (vehicleId: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ circle: L.Circle; origin: L.CircleMarker; vehicles: L.LayerGroup } | null>(null);
  const handlers = useRef({ onOriginChange, onSelect });
  handlers.current = { onOriginChange, onSelect };

  // create once
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([origin.lat, origin.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    const circle = L.circle([origin.lat, origin.lng], {
      radius, color: '#1B2430', weight: 1.5, dashArray: '6 6', fillColor: '#F2B705', fillOpacity: 0.07,
    }).addTo(m);
    const originMarker = L.circleMarker([origin.lat, origin.lng], {
      radius: 9, color: '#1B2430', weight: 3, fillColor: '#F2B705', fillOpacity: 1,
    }).addTo(m).bindTooltip('Search origin');
    const vehicles = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => handlers.current.onOriginChange({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    layers.current = { circle, origin: originMarker, vehicles };
    return () => {
      m.remove();
      map.current = null;
      layers.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // origin / radius
  useEffect(() => {
    const m = map.current;
    const l = layers.current;
    if (!m || !l) return;
    l.circle.setLatLng([origin.lat, origin.lng]);
    l.circle.setRadius(radius);
    l.origin.setLatLng([origin.lat, origin.lng]);
    m.fitBounds(l.circle.getBounds(), { padding: [16, 16] });
  }, [origin.lat, origin.lng, radius]);

  // vehicles
  useEffect(() => {
    const l = layers.current;
    if (!l) return;
    l.vehicles.clearLayers();
    results.forEach((r, i) => {
      const [lng, lat] = r.location.coordinates;
      const isNew = newIds.has(r.vehicle_id);
      const isSel = selectedId === r.vehicle_id;
      const marker = L.circleMarker([lat, lng], {
        radius: isSel ? 10 : 7,
        color: isNew ? '#B07D00' : '#ffffff',
        weight: isNew ? 3 : 2,
        fillColor: isSel ? '#1B2430' : '#0B7A72',
        fillOpacity: 0.95,
        className: isNew ? 'vehicle-marker is-new' : 'vehicle-marker',
      });
      const plate = r.vehicle?.license_plate ?? 'Unregistered vehicle';
      marker.bindTooltip(`${i + 1}. ${escapeHtml(plate)} · ${distance(r.distance_meters)}`);
      marker.on('click', () => handlers.current.onSelect(r.vehicle_id));
      marker.addTo(l.vehicles);
    });
  }, [results, newIds, selectedId]);

  return <div ref={el} className="map" role="application" aria-label="Map of nearby vehicles. Click the map to move the search origin." />;
}
