export type SupportedSpineVersion = "3.5" | "3.6" | "3.7" | "3.8" | "4.0" | "4.1" | "4.2" | "4.3";

/** Canonical UI/runtime order. Consumers must not maintain a second version list. */
export const SUPPORTED_SPINE_VERSIONS = Object.freeze([
  "3.5", "3.6", "3.7", "3.8", "4.0", "4.1", "4.2", "4.3",
] as const satisfies readonly SupportedSpineVersion[]);

export type RuntimeCompatibility = "stable" | "prerelease" | "spine-3.8.75";

export interface RuntimeDescriptor {
  majorMinor: SupportedSpineVersion;
  requiresExplicitAlphaMode: boolean;
  capabilities: Readonly<{ json: true; skel: boolean }>;
}

const RUNTIME_DESCRIPTORS = {
  "3.5": { majorMinor: "3.5", requiresExplicitAlphaMode: true, capabilities: { json: true, skel: false } },
  "3.6": { majorMinor: "3.6", requiresExplicitAlphaMode: true, capabilities: { json: true, skel: false } },
  "3.7": { majorMinor: "3.7", requiresExplicitAlphaMode: true, capabilities: { json: true, skel: false } },
  "3.8": { majorMinor: "3.8", requiresExplicitAlphaMode: true, capabilities: { json: true, skel: true } },
  "4.0": { majorMinor: "4.0", requiresExplicitAlphaMode: false, capabilities: { json: true, skel: true } },
  "4.1": { majorMinor: "4.1", requiresExplicitAlphaMode: false, capabilities: { json: true, skel: true } },
  "4.2": { majorMinor: "4.2", requiresExplicitAlphaMode: false, capabilities: { json: true, skel: true } },
  "4.3": { majorMinor: "4.3", requiresExplicitAlphaMode: false, capabilities: { json: true, skel: true } },
} as const satisfies Record<SupportedSpineVersion, RuntimeDescriptor>;

export function isSupportedSpineVersion(version: string): version is SupportedSpineVersion {
  return version in RUNTIME_DESCRIPTORS;
}

export function runtimeDescriptor(version: SupportedSpineVersion): RuntimeDescriptor {
  return RUNTIME_DESCRIPTORS[version];
}
