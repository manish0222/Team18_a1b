// GET /api/health - lets the UI show which database is down instead of a blank page.
export function registerHealth(router, { pg, mongo, simulator }) {
  router.get('/api/health', async () => {
    const check = async (fn) => {
      const started = Date.now();
      try {
        await fn();
        return { ok: true, ms: Date.now() - started };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    };
    const [postgres, mongodb] = await Promise.all([check(() => pg.ping()), check(() => mongo.ping())]);
    return {
      postgres,
      mongodb,
      simulator: simulator ? simulator.status() : { enabled: false },
      time: new Date().toISOString(),
    };
  });
}
