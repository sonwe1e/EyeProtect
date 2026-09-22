import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // `electron` is a devDependency, so the externalize-deps plugin (which
    // reads `dependencies`) leaves it to be bundled. Bundling it inlines the
    // package's `index.js`, whose `path.txt` lookup then resolves against
    // `out/main` instead of `node_modules/electron`, so the app aborts with
    // "Electron failed to install correctly". `ssr.noExternal` is forced to
    // true by electron-vite's preset, but an explicit `ssr.external` entry
    // still wins — keep `electron` a real import in the main bundle.
    ssr: { external: ['electron'] },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Same as main, plus the sandboxed preload must `require('electron')`
    // literally (verify:build enforces that shape).
    ssr: { external: ['electron'] },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          emergency: resolve(__dirname, 'src/preload/emergency.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    publicDir: resolve(__dirname, 'public'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
});
