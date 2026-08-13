import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/route': 'http://localhost:4000',
      '/agents': 'http://localhost:4000',
      '/balances': 'http://localhost:4000',
      '/admin': 'http://localhost:4000',
      '/self-test': 'http://localhost:4000',
      '/auth': 'http://localhost:4000',
      '/history': 'http://localhost:4000',
      '/debug': 'http://localhost:4000',
      '/reputation': 'http://localhost:4000',
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true
      }
    }
  }
})
