import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    allowedHosts: ['localhost'],
    cors: {
      origin: 'http://localhost:5173',
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      clientPort: 5173,
    },
  }
});
