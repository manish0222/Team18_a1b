import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser calls /api/* on the Vite server, which forwards
// to the API on :4000 - no CORS setup needed. Override with VITE_API_TARGET.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://localhost:4000',
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://localhost:4000',
    },
  },
});
