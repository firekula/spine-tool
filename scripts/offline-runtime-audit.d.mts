export interface TrustedOfflineRuntimeDescriptor {
  readonly version: string;
  readonly path: string;
  readonly sha256: string;
  readonly allowedStaticExternalUrls: readonly string[];
}

export const trustedOfflineRuntimeDescriptors: readonly TrustedOfflineRuntimeDescriptor[];
export const allowedOfflineRuntimeHelperPaths: readonly string[];
export function matchesTrustedOfflineRuntime(path: string, contents: string | Uint8Array): boolean;
export function externalRuntimeDependencies(path: string, contents: string): string[];
