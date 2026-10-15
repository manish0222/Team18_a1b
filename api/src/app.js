// Builds the request handler. Dependencies (pg, mongo, simulator) are passed
// in, so tests can supply fakes and never need a real database.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Router } from './router.js';
import { HttpError, sendJson, readJson } from './http.js';
import { toHttpError } from './errors.js';
import { registerHealth } from './routes/health.js';
import { registerRiders } from './routes/riders.js';
import { registerVehicles } from './routes/vehicles.js';
import { registerTrips } from './routes/trips.js';
import { registerAnalytics } from './routes/analytics.js';
import { registerMap } from './routes/map.js';
import { registerReviews } from './routes/reviews.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export function createApp({ pg, mongo, simulator = null, corsOrigins = [], webDist = null, logger = console }) {
  const router = new Router();
  const deps = { pg, mongo, simulator };
  registerHealth(router, deps);
  registerRiders(router, deps);
  registerVehicles(router, deps);
  registerTrips(router, deps);
  registerAnalytics(router, deps);
  registerMap(router, deps);
  registerReviews(router, deps);

  async function serveStatic(pathname, res) {
    if (!webDist) return false;
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(webDist, safe);
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
    } catch {
      file = path.join(webDist, 'index.html'); // SPA fallback
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
      return true;
    } catch {
      return false;
    }
  }

  return async function handler(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    const cors = origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {};

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }

    try {
      if (!url.pathname.startsWith('/api/')) {
        if (await serveStatic(url.pathname, res)) return;
        throw new HttpError(404, 'NOT_FOUND', `No route for ${url.pathname}`);
      }
      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'NOT_FOUND', `No API route for ${req.method} ${url.pathname}`);
      if (match.methodNotAllowed) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not supported here.`);

      const query = Object.fromEntries(url.searchParams.entries());
      const body = await readJson(req);
      const result = await match.handler({ req, params: match.params, query, body });
      sendJson(res, req.method === 'POST' && match.pattern === '/api/trips' ? 201 : 200, result ?? {}, cors);
    } catch (err) {
      const httpErr = toHttpError(err);
      if (httpErr.status >= 500) logger.error?.(`[api] ${req.method} ${url.pathname} ->`, err);
      sendJson(res, httpErr.status, {
        error: { code: httpErr.code, message: httpErr.message, details: httpErr.details },
      }, cors);
    } finally {
      if (process.env.API_LOG_REQUESTS !== 'false' && logger === console && url.pathname.startsWith('/api/')) {
        console.log(`${req.method} ${url.pathname}${url.search} ${res.statusCode} ${Date.now() - started}ms`);
      }
    }
  };
}
