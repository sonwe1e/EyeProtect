import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Web (Tauri) build of the existing React renderer.
 *
 * The Electron build keeps `electron.vite.config.ts` untouched; this config
 * only exists so the same `src/renderer` tree can be served into the Tauri
 * shell (`src-tauri`). Entry points:
 * - `web.html`  → the SPA for pet / bubble / workbench / alert windows
 * - `dim.html`  → the fullscreen focused-rest dim mask page
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/web.html'),
        dim: resolve(__dirname, 'src/renderer/dim.html')
      }
    }
  },
  server: {
    port: 5199,
    strictPort: true
  }
});
