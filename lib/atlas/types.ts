/** A texture page declared by a Spine Atlas file. */
export interface AtlasPage {
  name: string;
  width: number;
  height: number;
  /** Texture export scale written by Spine, for example 0.5 for a 50% atlas. */
  scale?: number;
  custom: Record<string, string>;
}

/**
 * A Region normalized across the pre-4.0 and 4.x Atlas field formats.
 * Offsets use the Atlas left/bottom coordinate convention and rotation is
 * expressed as clockwise degrees.
 */
export interface AtlasRegion {
  name: string;
  pageName: string;
  index: number;
  x: number;
  y: number;
  packedWidth: number;
  packedHeight: number;
  originalWidth: number;
  originalHeight: number;
  offsetLeft: number;
  offsetBottom: number;
  rotation: number;
  custom: Record<string, string>;
}

export interface AtlasDocument {
  pages: AtlasPage[];
  regions: AtlasRegion[];
}
