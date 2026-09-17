import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 期望固定的 dev 端口，失败即报错而不是换端口
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4096,
  },
  clearScreen: false,
});
