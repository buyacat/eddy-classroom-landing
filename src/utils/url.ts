export const BASE = import.meta.env.BASE_URL;

export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  const prefix = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return prefix + path;
}
