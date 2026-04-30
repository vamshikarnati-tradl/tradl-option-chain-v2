import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Silence noisy-but-benign proxy errors (peer disconnects, refresh-races).
// Real connection issues — refused, timeout, name resolution — still log.
const SILENT_CODES = new Set(['EPIPE', 'ECONNRESET']);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code && SILENT_CODES.has(code)) return;
            console.error('[vite] api proxy error:', err.message);
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code && SILENT_CODES.has(code)) return;
            console.error('[vite] ws proxy error:', err.message);
          });
        },
      },
    },
  },
});
