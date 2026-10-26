import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 本地把 /api 代理给 vercel dev（若同时运行），或直接指向部署后的地址
    proxy: process.env.API_PROXY
      ? { '/api': { target: process.env.API_PROXY, changeOrigin: true } }
      : undefined,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
})
