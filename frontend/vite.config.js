import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tttResearchPersistence } from './tttPersistencePlugin.js'

export default defineConfig({
  plugins: [react(), tttResearchPersistence()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/asset-[hash].[ext]',
      },
    },
  },
  server: {
    // Honour the port the environment assigns. Vite does not read PORT on its own,
    // and nothing here needs 5173 specifically — server.js allows any localhost
    // origin (`/^http:\/\/localhost:\d+$/`) and the persistence plugin's routes are
    // same-origin and relative. Falls back to Vite's default when PORT is unset.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
