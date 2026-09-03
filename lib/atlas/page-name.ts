/**
 * Returns the canonical identity used for an Atlas texture page at every
 * import, parse, Runtime, and export boundary.
 */
export function normalizeAtlasPageName(name: string): string {
  return String(name).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

/** Builds a canonical lookup and rejects aliases that would be ambiguous. */
export function normalizeAtlasPageMap<T>(
  entries: Iterable<readonly [string, T]>,
): Map<string, T> {
  const normalized = new Map<string, T>();
  const originals = new Map<string, string>();
  for (const [name, value] of entries) {
    const identity = normalizeAtlasPageName(name);
    const previous = originals.get(identity);
    if (previous !== undefined) {
      throw new Error(`Atlas 纹理页名称规范化后冲突：「${previous}」与「${name}」均对应「${identity}」。`);
    }
    originals.set(identity, name);
    normalized.set(identity, value);
  }
  return normalized;
}
