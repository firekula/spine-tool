export interface TrustedOfflineRuntimeDescriptor {
  readonly version: string;
  readonly path: string;
  readonly sha256: string;
  readonly allowedStaticExternalUrls: readonly string[];
}

export interface TrustedOfflineRuntimeHelperDescriptor {
  readonly path: string;
  readonly sha256: string;
}

export const trustedOfflineRuntimeDescriptors: readonly TrustedOfflineRuntimeDescriptor[];
export const trustedOfflineRuntimeHelperDescriptors: readonly TrustedOfflineRuntimeHelperDescriptor[];
export function matchesTrustedOfflineRuntime(path: string, contents: string | Uint8Array): boolean;
export function matchesTrustedOfflineRuntimeArtifact(path: string, contents: string | Uint8Array): boolean;
export function externalRuntimeDependencies(path: string, contents: string): string[];
