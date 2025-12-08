import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,        // Sprint Dashboard on 5174
    strictPort: false, // allow fallback if 5174 is in use
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_URL || 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
