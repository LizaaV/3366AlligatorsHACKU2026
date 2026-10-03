import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // In dev, /api/* goes to the FastAPI backend (cd backend && uv run uvicorn app.main:app --reload)
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
