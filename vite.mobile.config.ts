import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'mobile'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 1431 },
  build: {
    outDir: resolve(__dirname, 'mobile-dist'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
})
