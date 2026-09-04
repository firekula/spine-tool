import type { SpineRuntimeModule } from "./bridge-types";
import type { SupportedSpineVersion } from "./runtime-registry";

const RUNTIME_LOADERS: Partial<Record<SupportedSpineVersion, () => Promise<SpineRuntimeModule>>> = {
  "3.5": () => import("./runtime-3_5"),
  "3.6": () => import("./runtime-3_6"),
  "3.7": () => import("./runtime-3_7"),
  "3.8": () => import("./runtime-3_8"),
  "4.0": () => import("./runtime-4_0"),
  "4.1": () => import("./runtime-4_1"),
  "4.2": () => import("./runtime-4_2"),
  "4.3": () => import("./runtime-4_3"),
};

export async function loadRuntimeModule(version: SupportedSpineVersion): Promise<SpineRuntimeModule> {
  const loader = RUNTIME_LOADERS[version];
  if (!loader) throw new Error(`Spine ${version} 对应 Runtime 尚未安装`);
  return loader();
}
