import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Writes /build.json with this build's id (VITE_BUILD_ID, set by the Docker
// build), which running apps compare with their own to offer a reload.
const buildIdFile = () => ({
  name: 'build-id-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'build.json',
      source: JSON.stringify({ build_id: process.env.VITE_BUILD_ID ?? '' }),
    })
  },
})

export default defineConfig({
  plugins: [
    react(),
    buildIdFile(),
  ],
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // New domain-first layout:
      '@app': path.resolve(__dirname, './src/app'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@features': path.resolve(__dirname, './src/features'),
      '@hooks': path.resolve(__dirname, './src/shared/hooks'),
      '@routing': path.resolve(__dirname, './src/app/routing'),
      buffer: 'buffer/',
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // No source maps in production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,    // Remove console.* calls
        drop_debugger: true,   // Remove debugger statements
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace']
      },
      mangle: {
        safari10: true
      }
    },
    rollupOptions: {
      output: {
        // Function form is required under Vite 5/6 — the historical
        // object form silently produces an empty ``vendor-react``
        // chunk (the chunk file emits, but React + React-DOM end up
        // inlined into the main app chunk instead of split out).
        // See the matching function-form impl in vite.config.js.
        // Note ``antd`` + ``rc-*`` get their own chunk to dedupe
        // shared ant-design internals across lazy page chunks.
        manualChunks(id) {
          // One chunk per language, named explicitly: an un-named dynamic
          // import is named after its module's basename, and every locale
          // barrel is ``locales/<lng>/index.ts``, so they would all collide
          // on ``index``. Only ``de`` is statically reachable, so only
          // ``locale-de`` reaches the boot path.
          const locale = id.match(/\/shared\/i18n\/locales\/([a-z]{2})\//);
          if (locale) return `locale-${locale[1]}`;
          // The Buffer polyfill gets a chunk of its own. main.tsx imports
          // ``buffer`` eagerly to polyfill ``globalThis.Buffer``, and
          // @react-pdf uses it too. Left unassigned, Rollup may park
          // ``buffer`` or what it requires (``ieee754``, ``base64-js``) in the
          // PDF chunk — which one depends on the rest of the module graph —
          // and that welds the entry to the chunk and drags the whole
          // ~450 kB PDF stack onto the boot critical path behind a few kB.
          if (/node_modules\/(?:buffer|ieee754|base64-js)\//.test(id)) {
            return 'vendor-buffer';
          }
          // ~450 kB gzip, and only about a fifth of it is @react-pdf
          // itself: the bulk is fontkit, pdfkit and yoga-layout's wasm,
          // which it pulls in. Naming the chunk keeps that whole stack
          // behind the lazy PDF routes instead of duplicating it across
          // every page chunk that touches a PDF.
          if (id.includes('node_modules/@react-pdf/')) return 'vendor-pdf';
          if (id.includes('node_modules/react-router')) return 'vendor-router';
          if (
            id.includes('node_modules/axios/') ||
            id.includes('node_modules/@tanstack/react-query')
          ) {
            return 'vendor-api';
          }
          if (
            id.includes('node_modules/antd/') ||
            id.includes('node_modules/@ant-design/') ||
            id.includes('node_modules/rc-')
          ) {
            return 'vendor-antd';
          }
          // Match ``react`` + ``react-dom`` but NOT ``react-router``,
          // ``react-i18next``, ``react-pdf``, etc.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) {
            return 'vendor-react';
          }
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]'
      }
    },
    // PDF rendering (@react-pdf/renderer) is genuinely large and lives in its
    // own lazy chunk; the main bundle is also above 1MB. Both are acceptable
    // for an authenticated-staff SPA. Raise threshold to silence cosmetic warning.
    chunkSizeWarningLimit: 1800,
    cssCodeSplit: true,
    assetsInlineLimit: 4096, // 4kb - inline small assets as base64
  },
  // Optimizations
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom']
  }
})