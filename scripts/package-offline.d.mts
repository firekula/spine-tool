export interface PackageOfflineOptions {
  readonly outputDirectory?: string;
  readonly outputArchive?: string;
  readonly skipBuild?: boolean;
  readonly afterDirectoryRead?: (directory: string) => void | Promise<void>;
  readonly afterSnapshot?: () => void | Promise<void>;
}

export function packageOffline(options?: PackageOfflineOptions): Promise<void>;
