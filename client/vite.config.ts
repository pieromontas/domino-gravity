import { defineConfig } from 'vite';

// Public Discord Application ID. Production client builds must embed this even
// when GitHub Actions secrets are unset. Azure App Settings never rewrite the
// Vite bundle — they only reach the Node server at runtime.
const DEFAULT_DISCORD_CLIENT_ID = '1551749381705961514';
if (!process.env.VITE_DISCORD_CLIENT_ID) {
  process.env.VITE_DISCORD_CLIENT_ID = DEFAULT_DISCORD_CLIENT_ID;
}

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  },
  build: {
    target: 'esnext'
  }
});
