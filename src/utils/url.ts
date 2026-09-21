export const BASE = import.meta.env.BASE_URL;

/**
 * Prefixes a root-relative path with Astro's configured `base`.
 *
 * Astro does not rewrite absolute paths written by hand, so every
 * root-relative href/src must go through this to work both on the domain root
 * and under the GitHub Pages sub-path (see astro.config.mjs).
 */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  const prefix = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return prefix + path;
}
