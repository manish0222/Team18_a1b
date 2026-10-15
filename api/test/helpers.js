// Test helpers: run the real app on a random port with fake databases.
import http from 'node:http';
import { createApp } from '../src/app.js';

export async function startTestServer(deps) {
  const app = createApp({ corsOrigins: ['*'], logger: { error() {} }, ...deps });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    async get(path) {
      const res = await fetch(base + path);
      return { status: res.status, body: await res.json() };
    },
    async post(path, body) {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Error shaped like the ones node-postgres throws. */
export function pgError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * Fake of src/db/postgres.js. `handlers` is a list of [regex, fn(params)]
 * pairs; the first regex matching the SQL text answers the query.
 * Every executed statement is recorded in `calls`.
 */
export function fakePg(handlers) {
  const calls = [];
  const run = async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    for (const [re, fn] of handlers) {
      if (re.test(sql)) {
        const out = await fn(params, sql);
        return Array.isArray(out) ? { rows: out, rowCount: out.length } : out;
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    calls,
    query: run,
    async withTransaction(fn) {
      calls.push({ sql: 'BEGIN' });
      try {
        const r = await fn({ query: run });
        calls.push({ sql: 'COMMIT' });
        return r;
      } catch (e) {
        calls.push({ sql: 'ROLLBACK' });
        throw e;
      }
    },
    ping: async () => true,
  };
}

export const unusedMongo = {
  collection() { throw new Error('mongo should not be used in this test'); },
  ping: async () => true,
};
