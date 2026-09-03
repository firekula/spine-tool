import type { SpineRuntimeModule } from "./bridge-types";
import type { SupportedSpineVersion } from "./version";

const RUNTIME_LOADERS = {
  "3.8": () => import("./runtime-3_8"),
  "4.0": () => import("./runtime-4_0"),
  "4.1": () => import("./runtime-4_1"),
  "4.2": () => import("./runtime-4_2"),
} satisfies Record<SupportedSpineVersion, () => Promise<SpineRuntimeModule>>;

export async function loadRuntimeModule(version: SupportedSpineVersion): Promise<SpineRuntimeModule> {
  const loader = RUNTIME_LOADERS[version];
  if (!loader) throw new Error(`不支持的 Spine Runtime 版本: ${String(version)}`);
  return loader();
}
