import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Local stats backend: `npx wrangler dev --config wrangler.dev.jsonc` (port 8787)
    proxy: { '/api': 'http://localhost:8787' },
  },
});
