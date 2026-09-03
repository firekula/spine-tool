import { planRegionRestore, type RegionRestorePlan } from "@/lib/atlas/restore-math";
import type { AtlasRegion } from "@/lib/atlas/types";

export interface RestoreRegionInput {
  region: AtlasRegion;
  texturePage: ImageBitmap;
  restoreMultiplier: number;
}

export interface RestoredRegion {
  blob: Blob;
  width: number;
  height: number;
  plan: RegionRestorePlan;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function context2d(element: HTMLCanvasElement, regionName: string): CanvasRenderingContext2D {
  const context = element.getContext("2d");
  if (!context) throw new Error(`Region「${regionName}」无法创建 Canvas 2D context`);
  return context;
}

function pngBlob(element: HTMLCanvasElement, regionName: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    element.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`Region「${regionName}」无法编码为 PNG`));
    }, "image/png");
  });
}

function drawUnrotated(
  context: CanvasRenderingContext2D,
  cropped: ImageBitmap,
  plan: RegionRestorePlan,
): void {
  switch (plan.rotation) {
    case 0:
      break;
    case 90:
      context.translate(0, plan.crop.width);
      context.rotate(-Math.PI / 2);
      break;
    case 180:
      context.translate(plan.crop.width, plan.crop.height);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(plan.crop.height, 0);
      context.rotate(Math.PI / 2);
      break;
  }
  context.drawImage(cropped, 0, 0);
}

export async function restoreRegion(input: RestoreRegionInput): Promise<RestoredRegion> {
  const { region, texturePage, restoreMultiplier } = input;
  const plan = planRegionRestore(region, restoreMultiplier, {
    width: texturePage.width,
    height: texturePage.height,
  });
  const cropped = await createImageBitmap(
    texturePage,
    plan.crop.x,
    plan.crop.y,
    plan.crop.width,
    plan.crop.height,
  );

  try {
    const unrotatedCanvas = canvas(plan.unrotated.width, plan.unrotated.height);
    const unrotatedContext = context2d(unrotatedCanvas, region.name);
    drawUnrotated(unrotatedContext, cropped, plan);

    const originalCanvas = canvas(plan.original.width, plan.original.height);
    const originalContext = context2d(originalCanvas, region.name);
    originalContext.drawImage(unrotatedCanvas, plan.placement.x, plan.placement.y);

    const outputCanvas = canvas(plan.output.width, plan.output.height);
    const outputContext = context2d(outputCanvas, region.name);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(originalCanvas, 0, 0, plan.output.width, plan.output.height);

    return {
      blob: await pngBlob(outputCanvas, region.name),
      width: plan.output.width,
      height: plan.output.height,
      plan,
    };
  } finally {
    cropped.close();
  }
}
