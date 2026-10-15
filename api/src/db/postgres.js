// PostgreSQL access: one pool, plus a helper for multi-statement transactions.
import pg from 'pg';

// NUMERIC (money) -> JS number. Values are NUMERIC(10,2), well inside double precision.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// BIGINT (COUNT(*)) -> JS number
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE -> keep 'YYYY-MM-DD' text (avoid timezone shifts when serialising)
pg.types.setTypeParser(1082, (v) => v);

export function createPostgres(config) {
  // Fail fast instead of hanging if the database stops answering.
  const pool = new pg.Pool({ ...config, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 20000 });
  pool.on('error', (err) => console.error('[postgres] idle client error:', err.message));

  return {
    pool,
    query: (text, params) => pool.query(text, params),

    /** Run fn(client) inside BEGIN/COMMIT; ROLLBACK on any error. */
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
        throw err;
      } finally {
        client.release();
      }
    },

    async ping() {
      const { rows } = await pool.query('SELECT 1 AS ok');
      return rows[0].ok === 1;
    },

    end: () => pool.end(),
  };
}
