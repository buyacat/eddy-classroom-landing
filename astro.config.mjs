import { defineConfig } from 'astro/config';

// Production deploys to the domain root; the GitHub Pages preview serves the
// site from a sub-path and sets SITE_BASE via `npm run build:pages`.
const base = process.env.SITE_BASE || '/';

export default defineConfig({
  output: 'static',
  base,
  build: {
    format: 'directory',
    inlineStylesheets: 'always'
  }
});
