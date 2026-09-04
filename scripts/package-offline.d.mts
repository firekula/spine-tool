export interface PackageOfflineOptions {
  readonly outputDirectory?: string;
  readonly outputArchive?: string;
  readonly skipBuild?: boolean;
  readonly afterSnapshot?: () => void | Promise<void>;
}

export function packageOffline(options?: PackageOfflineOptions): Promise<void>;
