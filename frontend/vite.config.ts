import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // In dev, /api/* goes to the FastAPI backend (cd backend && uv run uvicorn app.main:app --reload).
  // Override with VITE_PROXY_TARGET (e.g. a teammate's machine) in .env.local.
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000';
  return {
    plugins: [react()],
    base: './',
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          // Live runs are server-sent events: keep the socket open for long agent runs.
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
  };
});
