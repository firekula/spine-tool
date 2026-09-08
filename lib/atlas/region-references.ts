import type { AtlasDocument } from "@/lib/atlas/types";

export type RegionReferenceProblemKind = "outer-whitespace" | "missing";

export interface RegionReferenceProblem {
  kind: RegionReferenceProblemKind;
  slotName: string;
  attachmentName: string;
  /** Region name the skeleton asks the atlas for (attachment `path`, else the attachment name). */
  referencedName: string;
  /** Atlas region name that matches once outer whitespace is removed; only for `outer-whitespace`. */
  atlasRegionName?: string;
}

// Region and mesh attachments are the only kinds that resolve a region in the
// atlas. Linked meshes inherit their parent's region, and bounding boxes,
// paths, clipping and points have no texture region at all.
const REGION_BACKED_TYPES = new Set<string | undefined>([undefined, "region", "mesh"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Finds region/mesh attachments whose atlas lookup cannot succeed.
 *
 * Spine trims the outer whitespace of every Atlas region name while parsing,
 * but keeps an attachment `path` verbatim. A `path` such as `"yanjing "` in the
 * skeleton therefore never matches the atlas region `yanjing`, and the runtime
 * only reports the generic "Region not found in atlas" error. This detects that
 * mismatch (and genuinely missing regions) before the runtime is asked to load.
 */
export function findRegionReferenceProblems(
  atlas: AtlasDocument,
  skeletonJson: unknown,
): RegionReferenceProblem[] {
  if (!isRecord(skeletonJson) || !Array.isArray(skeletonJson.skins)) return [];
  const regionNames = new Set(atlas.regions.map((region) => region.name));
  const problems: RegionReferenceProblem[] = [];
  for (const skin of skeletonJson.skins) {
    if (!isRecord(skin) || !isRecord(skin.attachments)) continue;
    for (const [slotName, slotAttachments] of Object.entries(skin.attachments)) {
      if (!isRecord(slotAttachments)) continue;
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (!isRecord(attachment)) continue;
        const type = typeof attachment.type === "string" ? attachment.type : undefined;
        if (!REGION_BACKED_TYPES.has(type)) continue;
        const referencedName = typeof attachment.path === "string" ? attachment.path : attachmentName;
        if (regionNames.has(referencedName)) continue;
        const trimmedName = referencedName.trim();
        const whitespaceOnly = trimmedName !== referencedName && regionNames.has(trimmedName);
        problems.push({
          kind: whitespaceOnly ? "outer-whitespace" : "missing",
          slotName,
          attachmentName,
          referencedName,
          atlasRegionName: whitespaceOnly ? trimmedName : undefined,
        });
      }
    }
  }
  return problems;
}
