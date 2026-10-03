import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react()],
    // Absolute: the share page lives at /proof/<slug>, where relative asset URLs would not resolve.
    base: '/',
    // In dev, /api/* goes to the FastAPI backend (cd backend && uv run uvicorn app.main:app --reload).
    server: { proxy: { '/api': env.VITE_DEV_API_TARGET || 'http://localhost:8000' } },
  };
});
