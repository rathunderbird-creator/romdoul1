import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Vercel sets this for every build automatically; local dev/build has no such
// commit context, so fall back to a timestamp (still unique per build).
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

// Writes the same id to a static file so a tab left open across a deploy can
// poll it and notice it's running an older build (see UpdateBanner.tsx).
const versionFilePlugin = (): Plugin => ({
  name: 'write-version-file',
  writeBundle(options) {
    writeFileSync(join(options.dir || 'dist', 'version.json'), JSON.stringify({ buildId: BUILD_ID }))
  }
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID)
  },
  server: {
    host: true, // Exposes the server to the network
    // Honour PORT when set (e.g. by tooling that assigns a free port);
    // otherwise fall back to Vite's default of 5173.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    watch: {
      // This project lives on an SMB network share, where Node's native fs
      // watcher throws `UNKNOWN: watch` (errno -4094) and takes the dev
      // server down with it. Polling is slower but survives the share.
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  esbuild: {
    target: 'es2022',
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          // Icons are needed by the shell (sidebar/header) on first paint;
          // charts are not — keep recharts in its own chunk so it only loads
          // on pages that actually render a chart.
          ui: ['lucide-react'],
          charts: ['recharts']
        }
      }
    }
  }
})
