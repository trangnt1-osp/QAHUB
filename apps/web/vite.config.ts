/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Resolve workspace code directly so dev HMR sees new shared exports without
  // depending on an ignored dist directory or a separate shared build process.
  resolve: { alias: { '@ospm/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { antd: ['antd', '@ant-design/icons'], charts: ['recharts'], tiptap: ['@tiptap/react', '@tiptap/starter-kit'] } } },
  },
  server: { port: 5173, // regex ^/api/ để không nuốt route SPA /api-keys
    proxy: { '^/api/': { target: process.env.VITE_API_TARGET ?? 'http://localhost:3000', changeOrigin: true } } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], exclude: ['e2e/**', 'node_modules/**'] },
});
