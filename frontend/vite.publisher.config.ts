import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist-publisher', rollupOptions: { input: 'publisher/index.html' } },
});
