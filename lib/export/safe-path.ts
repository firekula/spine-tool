/**
 * Normalises an Atlas Region name into a ZIP-relative PNG path. The allocator
 * owns collision handling so repeated Atlas names remain predictable.
 */
export interface ZipPathAllocator {
  allocate(regionName: string): string;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const DRIVE_SEGMENT = /^[a-zA-Z]:$/;

function safeSegment(segment: string): string | null {
  const cleaned = segment.replace(CONTROL_CHARACTERS, "").trim();
  if (!cleaned || cleaned === "." || cleaned === ".." || DRIVE_SEGMENT.test(cleaned)) return null;
  const withoutDrivePrefix = cleaned.replace(/^[a-zA-Z]:/, "");
  return withoutDrivePrefix || null;
}

function withPngExtension(parts: string[]): string[] {
  const lastIndex = parts.length - 1;
  const last = parts[lastIndex]!;
  parts[lastIndex] = /\.png$/i.test(last) ? `${last.slice(0, -4)}.png` : `${last}.png`;
  return parts;
}

function normalisePath(regionName: string): string {
  const parts = String(regionName)
    .replace(/\\/g, "/")
    .split("/")
    .map(safeSegment)
    .filter((segment): segment is string => segment !== null);
  return withPngExtension(parts.length > 0 ? parts : ["region"]).join("/");
}

function suffixed(path: string, occurrence: number): string {
  if (occurrence === 1) return path;
  const slash = path.lastIndexOf("/");
  const directory = slash === -1 ? "" : path.slice(0, slash + 1);
  const filename = slash === -1 ? path : path.slice(slash + 1);
  return `${directory}${filename.slice(0, -4)}-${occurrence}.png`;
}

export function createZipPathAllocator(): ZipPathAllocator {
  const occurrences = new Map<string, number>();
  const allocated = new Set<string>();
  return {
    allocate(regionName: string): string {
      const normalised = normalisePath(regionName);
      let occurrence = (occurrences.get(normalised) ?? 0) + 1;
      let path = suffixed(normalised, occurrence);
      while (allocated.has(path)) {
        occurrence += 1;
        path = suffixed(normalised, occurrence);
      }
      occurrences.set(normalised, occurrence);
      allocated.add(path);
      return path;
    },
  };
}
