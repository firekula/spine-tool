/**
 * Normalises an Atlas Region name into a ZIP-relative PNG path. The allocator
 * owns collision handling so repeated Atlas names remain predictable.
 */
export interface ZipPathAllocator {
  allocate(regionName: string): string;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const DRIVE_SEGMENT = /^[a-zA-Z]:$/;
const DRIVE_PREFIX = /^[a-zA-Z]:/;
const WINDOWS_INVALID_CHARACTERS = /[<>:"/\\|?*]/g;
const WINDOWS_TRAILING_DOTS_OR_SPACES = /[. ]+$/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_SEGMENT_LENGTH = 100;
const MAX_ZIP_PATH_LENGTH = 240;

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  let result = value.slice(0, maximum);
  const last = result.charCodeAt(result.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1);
  return result;
}

function truncatePortableSegment(value: string, maximum: number): string {
  let shortened = truncate(value, maximum).replace(WINDOWS_TRAILING_DOTS_OR_SPACES, "");
  if (WINDOWS_DEVICE_NAME.test(shortened)) {
    shortened = `_${truncate(shortened, Math.max(0, maximum - 1))}`;
  }
  return shortened;
}

function safeSegment(segment: string): string | null {
  let cleaned = segment.replace(CONTROL_CHARACTERS, "").trim();
  if (!cleaned || cleaned === "." || cleaned === ".." || DRIVE_SEGMENT.test(cleaned)) return null;
  cleaned = cleaned
    .replace(DRIVE_PREFIX, "")
    .replace(WINDOWS_INVALID_CHARACTERS, "_")
    .replace(WINDOWS_TRAILING_DOTS_OR_SPACES, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (WINDOWS_DEVICE_NAME.test(cleaned)) cleaned = `_${cleaned}`;
  cleaned = truncate(cleaned, MAX_SEGMENT_LENGTH).replace(WINDOWS_TRAILING_DOTS_OR_SPACES, "");
  return cleaned || null;
}

function withPngExtension(parts: string[]): string[] {
  const lastIndex = parts.length - 1;
  const last = parts[lastIndex]!;
  const stem = /\.png$/i.test(last) ? last.slice(0, -4) : last;
  parts[lastIndex] = `${truncate(stem, MAX_SEGMENT_LENGTH - 4)}.png`;
  return parts;
}

function withinPortablePathLength(parts: string[]): string[] {
  if (parts.join("/").length <= MAX_ZIP_PATH_LENGTH) return parts;
  const filename = parts.at(-1) ?? "region.png";
  const directories: string[] = [];
  let used = filename.length;
  for (const directory of parts.slice(0, -1)) {
    const available = MAX_ZIP_PATH_LENGTH - used - 1;
    if (available <= 0) break;
    const shortened = truncatePortableSegment(directory, available);
    if (!shortened) break;
    directories.push(shortened);
    used += shortened.length + 1;
    if (shortened.length < directory.length) break;
  }
  return [...directories, filename];
}

function normalisePath(regionName: string): string {
  const parts = String(regionName)
    .replace(/\\/g, "/")
    .split("/")
    .map(safeSegment)
    .filter((segment): segment is string => segment !== null);
  return withinPortablePathLength(withPngExtension(parts.length > 0 ? parts : ["region"])).join("/");
}

function suffixed(path: string, occurrence: number): string {
  if (occurrence === 1) return path;
  const slash = path.lastIndexOf("/");
  const directory = slash === -1 ? "" : path.slice(0, slash + 1);
  const filename = slash === -1 ? path : path.slice(slash + 1);
  const suffix = `-${occurrence}.png`;
  const maximumFilenameLength = Math.min(
    MAX_SEGMENT_LENGTH,
    MAX_ZIP_PATH_LENGTH - directory.length,
  );
  const stem = truncate(filename.slice(0, -4), Math.max(1, maximumFilenameLength - suffix.length));
  return `${directory}${stem}${suffix}`;
}

function collisionKey(path: string): string {
  return path.normalize("NFC").toLocaleLowerCase("en-US");
}

export function createZipPathAllocator(): ZipPathAllocator {
  const occurrences = new Map<string, number>();
  const allocated = new Set<string>();
  return {
    allocate(regionName: string): string {
      const normalised = normalisePath(regionName);
      const normalisedKey = collisionKey(normalised);
      let occurrence = (occurrences.get(normalisedKey) ?? 0) + 1;
      let path = suffixed(normalised, occurrence);
      while (allocated.has(collisionKey(path))) {
        occurrence += 1;
        path = suffixed(normalised, occurrence);
      }
      occurrences.set(normalisedKey, occurrence);
      allocated.add(collisionKey(path));
      return path;
    },
  };
}
