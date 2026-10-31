import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Constantes compartidas con el backend (ej. nombres de eventos de socket)
      '@shared': path.resolve(__dirname, '../backend/src/shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Cualquier request a /api, /socket.io o /uploads se proxea al backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
