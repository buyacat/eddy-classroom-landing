/*
 * GitHub Pages build.
 *
 * Pages serves this repo from a sub-path, not a domain root, so the whole site
 * has to be built with Astro's `base` set to it — every absolute href in the
 * app already goes through withBase() (src/utils/url.ts) to pick that up.
 *
 * This is a script rather than an inline env var in package.json because npm
 * runs its scripts through cmd.exe on Windows, where `SITE_BASE=… astro build`
 * is a syntax error rather than an assignment. cross-env would fix that too;
 * a six-line spawn keeps the dependency list at one.
 */
import { spawn } from 'node:child_process';

const base = process.env.SITE_BASE || '/eddy-classroom-landing';

const child = spawn('npx', ['astro', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SITE_BASE: base }
});

child.on('exit', (code) => process.exit(code ?? 1));
