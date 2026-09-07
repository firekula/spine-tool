import { describe, expect, it } from "vitest";

import { trustedOfflineAssetDescriptors } from "../../scripts/offline-runtime-audit.mjs";
import { packageOffline } from "../../scripts/package-offline.mjs";

const completePackageOptions: NonNullable<Parameters<typeof packageOffline>[0]> = {
  outputDirectory: "/tmp/offline-output",
  outputArchive: "/tmp/offline.zip",
  launcherDirectory: "/tmp/offline-launchers",
  skipBuild: true,
  afterDirectoryRead: async (_directory) => undefined,
  afterLauncherDirectoryRead: async (_directory) => undefined,
  afterSnapshot: async () => undefined,
  beforeArchiveCommit: async () => undefined,
  afterArchiveTargetOpened: async () => undefined,
};

describe("Node 脚本声明", () => {
  it("暴露离线打包钩子与完整资产 descriptors", () => {
    expect(completePackageOptions.launcherDirectory).toBe("/tmp/offline-launchers");
    expect(Array.isArray(trustedOfflineAssetDescriptors)).toBe(true);
  });
});
