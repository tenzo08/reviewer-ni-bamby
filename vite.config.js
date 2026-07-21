import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Only relevant to `vite dev` (i.e. `npm run dev:local`). Real `vercel dev`
// intercepts /api/* itself before it ever reaches the Vite subprocess, and
// `vite build` doesn't run a dev server at all -- so this proxy has no
// effect on the Vercel-based flow or the production build.
const LOCAL_API_PORT = process.env.LOCAL_API_PORT || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${LOCAL_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
