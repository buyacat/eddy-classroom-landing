import { defineConfig } from 'astro/config';

const base = process.env.SITE_BASE || '/';

export default defineConfig({
  output: 'static',
  base,
  build: {
    format: 'directory',
    inlineStylesheets: 'always'
  }
});
