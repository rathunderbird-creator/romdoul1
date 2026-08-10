import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
          ui: ['lucide-react', 'recharts']
        }
      }
    }
  }
})
