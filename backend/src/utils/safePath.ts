import path from 'path';

/**
 * Join `parts` onto `baseDir` and guarantee the result stays inside `baseDir`.
 * Returns the resolved absolute path, or `null` if the result would escape
 * `baseDir` (path traversal via `..`, absolute segments, or a sibling whose
 * name shares a prefix, e.g. `problems/9` vs `problems/99`).
 */
export function safeJoin(baseDir: string, ...parts: string[]): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target === base || target.startsWith(base + path.sep)) return target;
  return null;
}

/** True if `name` is a single path component (no separators, not `.`/`..`). */
export function isPlainName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}
