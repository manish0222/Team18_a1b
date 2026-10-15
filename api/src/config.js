// Configuration: reads ../.env (shared with the Assignment 1 seeders), then
// api/.env, then real environment variables (highest priority).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadConfig(env = process.env) {
  const merged = {
    ...parseEnvFile(path.resolve(here, '../../.env')),
    ...parseEnvFile(path.resolve(here, '../.env')),
    ...env,
  };
  const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
  const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

  return {
    port: int(merged.API_PORT ?? merged.PORT, 4000),
    corsOrigins: (merged.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',').map((s) => s.trim()).filter(Boolean),
    postgres: {
      host: merged.POSTGRES_HOST ?? 'localhost',
      port: int(merged.POSTGRES_PORT, 5432),
      database: merged.POSTGRES_DB ?? 'ridesync_db',
      user: merged.POSTGRES_USER ?? 'postgres',
      password: merged.POSTGRES_PASSWORD ?? 'postgres',
      max: int(merged.POSTGRES_POOL_SIZE, 10),
    },
    mongo: {
      uri: merged.MONGO_URI ?? 'mongodb://localhost:27017/',
      dbName: merged.MONGO_DB ?? 'ridesync_db',
    },
    simulator: {
      enabled: bool(merged.SIMULATE_TELEMETRY, true),
      tickMs: int(merged.SIMULATOR_TICK_MS, 5000),
      vehiclesPerTick: int(merged.SIMULATOR_VEHICLES_PER_TICK, 150),
    },
    webDist: merged.WEB_DIST ? path.resolve(here, '..', merged.WEB_DIST) : null,
  };
}
