export interface PackageOfflineOptions {
  readonly outputDirectory?: string;
  readonly outputArchive?: string;
  readonly launcherDirectory?: string;
  readonly skipBuild?: boolean;
  readonly afterDirectoryRead?: (directory: string) => void | Promise<void>;
  readonly afterLauncherDirectoryRead?: (directory: string) => void | Promise<void>;
  readonly afterSnapshot?: () => void | Promise<void>;
  readonly beforeArchiveCommit?: () => void | Promise<void>;
  readonly afterArchiveTargetOpened?: () => void | Promise<void>;
}

export function packageOffline(options?: PackageOfflineOptions): Promise<void>;
