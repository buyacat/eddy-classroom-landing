/**
 * GitHub Pages build: runs `astro build` with `base` set to the sub-path Pages
 * serves the repo from (see src/utils/url.ts).
 *
 * A script rather than an inline env var, because npm runs scripts through
 * cmd.exe on Windows, where `SITE_BASE=… astro build` is a syntax error.
 */
import { spawn } from 'node:child_process';

const base = process.env.SITE_BASE || '/eddy-classroom-landing';

const child = spawn('npx', ['astro', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SITE_BASE: base }
});

child.on('exit', (code) => process.exit(code ?? 1));
