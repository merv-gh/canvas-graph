import { defineConfig } from 'vite';

// Library build: bundle frontend/lib.ts into one self-contained IIFE that
// exposes `window.GraphViewer.createGraphViewer(...)`. CSS and DOM templates are
// inlined by lib.ts (?inline / ?raw), so the output is a single .js file with no
// external assets — a host page drops in one <script> and calls one function.
export default defineConfig({
  root: 'frontend',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: {
      entry: 'lib.ts',
      name: 'GraphViewer',
      formats: ['iife'],
      fileName: () => 'graph-viewer.js',
    },
    outDir: '../dist-lib',
    emptyOutDir: true,
    cssCodeSplit: false,
    copyPublicDir: false,
    minify: false,
  },
});
