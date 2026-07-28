import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  publicDir: false,
  build: {
    minify: 'oxc',
    cssMinify: 'lightningcss',
  },
});
