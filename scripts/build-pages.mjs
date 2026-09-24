import { spawn } from 'node:child_process';

const base = process.env.SITE_BASE || '/eddy-classroom-landing';

const child = spawn('npx', ['astro', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SITE_BASE: base }
});

child.on('exit', (code) => process.exit(code ?? 1));
