export type SupportedSpineVersion = "3.8" | "4.0" | "4.1" | "4.2";

export interface DetectedSpineVersion {
  raw: string | null;
  majorMinor: SupportedSpineVersion | null;
  source: "json-field" | "skel-header" | "ascii-fallback" | "unknown";
  supported: boolean;
}

const SKEL_HEADER_BYTES = 256;
const SUPPORTED_VERSIONS = new Set<SupportedSpineVersion>(["3.8", "4.0", "4.1", "4.2"]);

interface DecodedString {
  value: string | null;
  next: number;
}

function unknownVersion(): DetectedSpineVersion {
  return { raw: null, majorMinor: null, source: "unknown", supported: false };
}

function versionResult(raw: string, source: Exclude<DetectedSpineVersion["source"], "unknown">): DetectedSpineVersion {
  const match = raw.match(/^(\d+)\.(\d+)(?:\.|$)/);
  const candidate = match ? `${match[1]}.${match[2]}` : null;
  const majorMinor = candidate && SUPPORTED_VERSIONS.has(candidate as SupportedSpineVersion)
    ? candidate as SupportedSpineVersion
    : null;

  return { raw, majorMinor, source, supported: majorMinor !== null };
}

function isJsonFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".json");
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;

  // Spine stores string lengths as an optimize-positive varint. Five bytes
  // cover the 32-bit range and keep malformed input bounded.
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (index * 7);
    if ((byte & 0x80) === 0) return { value, next: offset + index + 1 };
  }

  return null;
}

function readSpineString(bytes: Uint8Array, offset: number): DecodedString | null {
  const length = readVarint(bytes, offset);
  if (!length) return null;
  if (length.value === 0) return { value: null, next: length.next };
  if (length.value === 1) return { value: "", next: length.next };

  const byteLength = length.value - 1;
  const end = length.next + byteLength;
  if (byteLength < 0 || end > bytes.length) return null;

  return { value: new TextDecoder().decode(bytes.subarray(length.next, end)), next: end };
}

function readSkelHeaderVersion(bytes: Uint8Array): string | null {
  const hash = readSpineString(bytes, 0);
  if (!hash) return null;
  const version = readSpineString(bytes, hash.next);
  return version?.value ?? null;
}

function findAsciiVersion(bytes: Uint8Array): string | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const match = text.match(/(?:^|[^0-9.])(\d+\.\d+(?:\.\d+)?)(?=$|[^0-9.])/);
  return match?.[1] ?? null;
}

async function detectJsonVersion(file: File): Promise<DetectedSpineVersion> {
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (
      typeof parsed === "object"
      && parsed !== null
      && "skeleton" in parsed
      && typeof parsed.skeleton === "object"
      && parsed.skeleton !== null
      && "spine" in parsed.skeleton
      && typeof parsed.skeleton.spine === "string"
    ) {
      return versionResult(parsed.skeleton.spine, "json-field");
    }
  } catch {
    // The detector is used during import validation; invalid JSON is simply
    // an undetectable version and is handled by the caller's parser.
  }

  return unknownVersion();
}

async function detectSkelVersion(file: File): Promise<DetectedSpineVersion> {
  try {
    const bytes = new Uint8Array(await file.slice(0, SKEL_HEADER_BYTES).arrayBuffer());
    const headerVersion = readSkelHeaderVersion(bytes);
    if (headerVersion !== null) return versionResult(headerVersion, "skel-header");

    const asciiVersion = findAsciiVersion(bytes);
    if (asciiVersion !== null) return versionResult(asciiVersion, "ascii-fallback");
  } catch {
    // Return a structured unknown result when File reading fails.
  }

  return unknownVersion();
}

/** Detects a Spine 3.8--4.2 skeleton version without loading a SKEL body. */
export async function detectSpineVersion(file: File): Promise<DetectedSpineVersion> {
  return isJsonFile(file) ? detectJsonVersion(file) : detectSkelVersion(file);
}
