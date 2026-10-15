// Entry point: wires real PostgreSQL + MongoDB into the app and starts HTTP.
import http from 'node:http';
import { loadConfig } from './config.js';
import { createPostgres } from './db/postgres.js';
import { createMongo } from './db/mongo.js';
import { createApp } from './app.js';
import { createTelemetrySimulator } from './services/telemetrySimulator.js';

const config = loadConfig();
const pg = createPostgres(config.postgres);
const mongo = createMongo(config.mongo);

const simulator = config.simulator.enabled
  ? createTelemetrySimulator({ pg, mongo, tickMs: config.simulator.tickMs, vehiclesPerTick: config.simulator.vehiclesPerTick })
  : null;

const server = http.createServer(
  createApp({ pg, mongo, simulator, corsOrigins: config.corsOrigins, webDist: config.webDist }),
);

server.listen(config.port, () => {
  console.log(`RideSync API listening on http://localhost:${config.port}`);
  console.log(`  PostgreSQL ${config.postgres.user}@${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`);
  console.log(`  MongoDB    ${config.mongo.uri} (db ${config.mongo.dbName})`);
  if (config.webDist) console.log(`  Serving front end from ${config.webDist}`);
  if (simulator) {
    simulator.start();
    console.log(`  Telemetry simulator on (${config.simulator.vehiclesPerTick} pings / ${config.simulator.tickMs} ms)`);
  }
});

async function shutdown() {
  simulator?.stop();
  server.close();
  await Promise.allSettled([pg.end(), mongo.close()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
