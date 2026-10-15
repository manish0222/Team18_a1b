// Live TelemetryPings generator.
//
// Why it exists: TelemetryPings has a 2-hour TTL index, so seeded pings
// disappear two hours after seeding and the map would go empty. The simulator
// moves a few hundred real (PostgreSQL) vehicles a little every tick and
// inserts a fresh ping for each - the map page polls and shows them arriving.
// Disable with SIMULATE_TELEMETRY=false.

const CENTER = { lng: 78.382, lat: 17.4435 }; // same centre as mongo_seeder.py
const SPREAD = 0.15; // degrees, same as the seeder

export function createTelemetrySimulator({ pg, mongo, tickMs = 5000, vehiclesPerTick = 150, log = console }) {
  const fleet = new Map(); // vehicle_id -> { lng, lat, heading }
  let timer = null;
  let ticking = false;
  const state = { enabled: true, running: false, last_tick_at: null, pings_inserted: 0, last_error: null, fleet_size: 0 };

  async function loadFleet() {
    const { rows } = await pg.query('SELECT id FROM vehicles WHERE is_active');
    let lastPositions = new Map();
    try {
      // Continue from each vehicle's latest known position if pings exist.
      const latest = await mongo.collection('TelemetryPings').aggregate([
        { $sort: { created_at: -1 } },
        { $group: { _id: '$vehicle_id', location: { $first: '$location' } } },
      ], { allowDiskUse: true }).toArray();
      lastPositions = new Map(latest.map((d) => [d._id, d.location.coordinates]));
    } catch { /* start from random positions */ }

    for (const { id } of rows) {
      const known = lastPositions.get(id);
      fleet.set(id, {
        lng: known ? known[0] : CENTER.lng + (Math.random() * 2 - 1) * SPREAD,
        lat: known ? known[1] : CENTER.lat + (Math.random() * 2 - 1) * SPREAD,
        heading: Math.random() * 360,
      });
    }
    state.fleet_size = fleet.size;
  }

  function step(v, now) {
    // realistic city speed; distance = speed x time since this vehicle's last ping
    const seconds = v.lastAt ? Math.min(120, (now - v.lastAt) / 1000) : 30;
    v.lastAt = now;
    v.speed = Math.max(0, Math.min(60, (v.speed ?? 25) + (Math.random() * 20 - 10)));
    v.heading = (v.heading + (Math.random() * 60 - 30) + 360) % 360;
    const meters = (v.speed / 3.6) * seconds;
    const rad = (v.heading * Math.PI) / 180;
    v.lat += (meters * Math.cos(rad)) / 111_320;
    v.lng += (meters * Math.sin(rad)) / (111_320 * Math.cos((v.lat * Math.PI) / 180));
    if (Math.abs(v.lng - CENTER.lng) > SPREAD || Math.abs(v.lat - CENTER.lat) > SPREAD) {
      v.heading = (v.heading + 180) % 360;
      v.lng = Math.min(CENTER.lng + SPREAD, Math.max(CENTER.lng - SPREAD, v.lng));
      v.lat = Math.min(CENTER.lat + SPREAD, Math.max(CENTER.lat - SPREAD, v.lat));
    }
    return v.speed;
  }

  async function tick() {
    if (ticking) return; // never overlap ticks
    ticking = true;
    try {
      if (!fleet.size) await loadFleet();
      const ids = [...fleet.keys()];
      const now = new Date();
      const docs = [];
      for (let i = 0; i < Math.min(vehiclesPerTick, ids.length); i++) {
        const id = ids[Math.floor(Math.random() * ids.length)];
        const v = fleet.get(id);
        const speed = step(v, now.getTime());
        docs.push({
          ping_id: crypto.randomUUID(),
          vehicle_id: id,
          is_available: Math.random() > 0.25,
          speed_kmh: Math.round(speed * 10) / 10,
          heading_degrees: Math.round(v.heading * 10) / 10,
          location: { type: 'Point', coordinates: [Number(v.lng.toFixed(6)), Number(v.lat.toFixed(6))] },
          created_at: now,
        });
      }
      if (docs.length) await mongo.collection('TelemetryPings').insertMany(docs, { ordered: false });
      state.pings_inserted += docs.length;
      state.last_tick_at = now.toISOString();
      if (state.last_error) log.info?.('[simulator] recovered');
      state.last_error = null;
    } catch (err) {
      if (state.last_error !== err.message) log.warn?.(`[simulator] tick failed: ${err.message}`);
      state.last_error = err.message;
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (timer) return;
      state.running = true;
      tick();
      timer = setInterval(tick, tickMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
      state.running = false;
    },
    tick,
    status: () => ({ ...state, tick_ms: tickMs, vehicles_per_tick: vehiclesPerTick }),
  };
}
