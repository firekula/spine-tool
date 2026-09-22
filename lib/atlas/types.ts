/** A texture page declared by a Spine Atlas file. */
export interface AtlasPage {
  name: string;
  /**
   * Export box of this page in pixels: the union of the size the Atlas declares
   * and the decoded PNG size, filled in once the page is decoded. A PNG smaller
   * than the declared box is read as if the missing right and bottom pixels were
   * transparent, so every packed Region still restores a complete image.
   */
  width: number;
  height: number;
  /** Decoded PNG size; smaller than width/height when the Atlas declares more. */
  imageWidth?: number;
  imageHeight?: number;
  /** Texture export scale written by Spine, for example 0.5 for a 50% atlas. */
  scale?: number;
  /** Whether this page stores premultiplied-alpha RGB; absent on older Atlas files. */
  pma?: boolean;
  custom: Record<string, string>;
}

/**
 * A Region normalized across the pre-4.0 and 4.x Atlas field formats.
 * Offsets use the Atlas left/bottom coordinate convention and rotation is
 * expressed as the counter-clockwise degrees applied while packing. Export
 * restoration applies the inverse transform.
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
