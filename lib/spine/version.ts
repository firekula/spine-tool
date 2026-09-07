import {
  isSupportedSpineVersion,
  type RuntimeCompatibility,
  type SupportedSpineVersion,
} from "./runtime-registry";
import { assertSkeletonFileByteBudget } from "@/lib/files/import-limits";

export type { RuntimeCompatibility, SupportedSpineVersion } from "./runtime-registry";

export interface DetectedSpineVersion {
  raw: string | null;
  majorMinor: SupportedSpineVersion | null;
  source: "json-field" | "skel-header" | "ascii-fallback" | "unknown";
  supported: boolean;
  compatibility: RuntimeCompatibility | null;
  /** Conflicting structured SKEL layouts make cross-version Runtime loading unsafe. */
  runtimeBlocked?: boolean;
  /** Legacy family candidate retained only for Atlas export Alpha semantics. */
  legacyCandidate?: SupportedSpineVersion;
  /** A structured legacy 3.x candidate still requires explicit export Alpha. */
  legacyAlphaRequired?: boolean;
}

const SKEL_HEADER_BYTES = 256;
const VERSION_CORE_SOURCE = String.raw`\d+\.\d+(?:\.\d+)?`;
const PRERELEASE_IDENTIFIER_SOURCE = String.raw`[0-9A-Za-z-]+`;
const VERSION_PRERELEASE_SOURCE = String.raw`(?:-${PRERELEASE_IDENTIFIER_SOURCE}(?:\.${PRERELEASE_IDENTIFIER_SOURCE})*)?`;
const VERSION_SOURCE = `${VERSION_CORE_SOURCE}${VERSION_PRERELEASE_SOURCE}`;
const SPINE_VERSION_PATTERN = new RegExp(`^${VERSION_SOURCE}$`);
const ASCII_VERSION_PATTERN = new RegExp(`(?:^|[^0-9A-Za-z._+-])(${VERSION_SOURCE})(?=$|[^0-9A-Za-z._+-])`);

interface DecodedString {
  status: "decoded";
  value: string | null;
  next: number;
}

interface IncompleteString {
  status: "truncated";
}

interface InvalidString {
  status: "invalid";
}

type SpineStringRead = DecodedString | IncompleteString | InvalidString;

interface SkelHeaderVersion {
  value: string | null;
  ambiguous: boolean;
  incomplete?: boolean;
  legacyCandidate?: SupportedSpineVersion;
  legacyAlphaRequired?: boolean;
}

function unknownVersion(): DetectedSpineVersion {
  return { raw: null, majorMinor: null, source: "unknown", supported: false, compatibility: null };
}

export function classifySpineVersion(
  raw: string,
  source: Exclude<DetectedSpineVersion["source"], "unknown">,
): DetectedSpineVersion {
  if (!SPINE_VERSION_PATTERN.test(raw)) {
    return { raw, majorMinor: null, source, supported: false, compatibility: null };
  }
  const match = raw.match(/^(\d+)\.(\d+)/);
  const candidate = match ? `${match[1]}.${match[2]}` : null;
  const majorMinor = candidate && isSupportedSpineVersion(candidate)
    ? candidate
    : null;
  const compatibility = majorMinor === null
    ? null
    : raw.includes("-")
      ? "prerelease"
      : raw === "3.8.75"
        ? "spine-3.8.75"
        : "stable";

  return { raw, majorMinor, source, supported: majorMinor !== null, compatibility };
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

function readSpineString(bytes: Uint8Array, offset: number): SpineStringRead {
  const length = readVarint(bytes, offset);
  if (!length) return { status: "invalid" };
  if (length.value === 0) return { status: "decoded", value: null, next: length.next };
  if (length.value === 1) return { status: "decoded", value: "", next: length.next };

  const byteLength = length.value - 1;
  const end = length.next + byteLength;
  if (byteLength < 0) return { status: "invalid" };
  if (end > bytes.length) return { status: "truncated" };

  return {
    status: "decoded",
    value: new TextDecoder().decode(bytes.subarray(length.next, end)),
    next: end,
  };
}

function readSkelHeaderVersion(bytes: Uint8Array): SkelHeaderVersion {
  const hash = readSpineString(bytes, 0);
  const legacyVersionRead = hash.status === "decoded"
    ? readSpineString(bytes, hash.next)
    : { status: "invalid" } satisfies InvalidString;
  const legacyVersion = legacyVersionRead.status === "decoded" ? legacyVersionRead.value : null;
  // Spine 4.x replaced the serialized hash string with two int32 values.
  // The version string therefore starts at byte 8 in current SKEL files.
  const numericHashVersionRead = readSpineString(bytes, 8);
  const numericHashVersion = numericHashVersionRead.status === "decoded" ? numericHashVersionRead.value : null;
  const family = (value: string | null | undefined): string | null =>
    value?.match(/\d+\.\d+/)?.[0]?.split(".")[0] ?? null;

  // A 4.x numeric-hash header can accidentally make its first eight bytes
  // look like two legacy strings. Prefer the format-specific 4.x candidate;
  // likewise prefer a genuine 3.x candidate from the legacy location.
  const legacyFamily = family(legacyVersion);
  const numericFamily = family(numericHashVersion);
  if (legacyFamily === "3" && numericFamily === "4") {
    const classifiedLegacy = legacyVersion
      ? classifySpineVersion(legacyVersion, "skel-header").majorMinor
      : null;
    return {
      value: null,
      ambiguous: true,
      legacyAlphaRequired: true,
      ...(classifiedLegacy ? { legacyCandidate: classifiedLegacy } : {}),
    };
  }
  if (numericFamily === "4") return { value: numericHashVersion ?? null, ambiguous: false };
  if (legacyFamily === "3") return { value: legacyVersion ?? null, ambiguous: false };

  // Preserve the complete structurally decoded value even when punctuation,
  // whitespace or a suffix makes its syntax invalid. Classification must see
  // and reject the whole raw header instead of accepting an ASCII substring.
  if (legacyVersion && legacyFamily) return { value: legacyVersion, ambiguous: false };
  if (numericHashVersion && numericFamily) return { value: numericHashVersion, ambiguous: false };
  if (legacyVersionRead.status === "truncated" || numericHashVersionRead.status === "truncated") {
    return { value: null, ambiguous: false, incomplete: true };
  }
  return { value: null, ambiguous: false };
}

function findAsciiVersion(bytes: Uint8Array): string | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const match = text.match(ASCII_VERSION_PATTERN);
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
      return classifySpineVersion(parsed.skeleton.spine, "json-field");
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
    if (headerVersion.value !== null) return classifySpineVersion(headerVersion.value, "skel-header");
    if (headerVersion.ambiguous) {
      return {
        raw: null,
        majorMinor: null,
        source: "skel-header",
        supported: false,
        compatibility: null,
        runtimeBlocked: true,
        legacyAlphaRequired: headerVersion.legacyAlphaRequired,
        ...(headerVersion.legacyCandidate ? { legacyCandidate: headerVersion.legacyCandidate } : {}),
      };
    }
    if (headerVersion.incomplete) {
      return unknownVersion();
    }

    const asciiVersion = findAsciiVersion(bytes);
    if (asciiVersion !== null) return classifySpineVersion(asciiVersion, "ascii-fallback");
  } catch {
    // Return a structured unknown result when File reading fails.
  }

  return unknownVersion();
}

/** Detects a Spine 3.5--4.3 skeleton version without loading a SKEL body. */
export async function detectSpineVersion(file: File): Promise<DetectedSpineVersion> {
  assertSkeletonFileByteBudget(file);
  return isJsonFile(file) ? detectJsonVersion(file) : detectSkelVersion(file);
}
