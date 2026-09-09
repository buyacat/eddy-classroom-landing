// Astro's `base` config (set via the SITE_BASE env var, see astro.config.mjs)
// is a GitHub Pages-only concern: the real deploy will sit on the client's own
// domain root, while the Pages preview lives under /eddy-classroom-landing/.
// Astro does not rewrite hardcoded absolute paths on its own, so every
// root-relative href/src in the app has to go through withBase() to survive
// both. The same helper, with the same reasoning, is in the Dr.STEM repo.
export const BASE = import.meta.env.BASE_URL;

export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  const prefix = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return prefix + path;
}
