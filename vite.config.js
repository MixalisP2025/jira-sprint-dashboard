import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// Plugin: stamp the service worker with the current build timestamp
// so every build produces a unique cache name, forcing the PWA to update.
function stampServiceWorker() {
  return {
    name: 'stamp-sw',
    closeBundle() {
      const swPath = path.resolve('dist', 'sw.js');
      if (!fs.existsSync(swPath)) return;
      const timestamp = Date.now();
      let content = fs.readFileSync(swPath, 'utf8');
      content = content.replace('BUILD_TIMESTAMP', timestamp);
      fs.writeFileSync(swPath, content);
      console.log(`[stamp-sw] Cache name stamped with timestamp: ${timestamp}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_URL || 'http://localhost:4001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
