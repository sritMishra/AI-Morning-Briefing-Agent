import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard talks to the server on PORT 4000; proxy /api during dev so we
// avoid CORS fuss and can call relative paths.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4400',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
