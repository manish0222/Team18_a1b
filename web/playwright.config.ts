import { defineConfig } from '@playwright/test';

// E2E tests drive the real UI against the real API + seeded databases.
// Start the API (cd api && npm start) and the web app (npm run dev) first,
// or set BASE_URL to wherever the app is served.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
