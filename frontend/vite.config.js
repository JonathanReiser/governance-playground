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
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
