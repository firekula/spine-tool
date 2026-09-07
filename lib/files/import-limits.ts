import type { AppIssue } from "@/lib/issues/types";

export const MAX_SELECTED_IMPORT_FILE_COUNT = 66;
export const MAX_TEXTURE_PAGE_COUNT = 64;
export const MAX_ATLAS_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_SKELETON_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_TEXTURE_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_TEXTURE_TOTAL_FILE_BYTES = 256 * 1024 * 1024;

export class ImportResourceLimitError extends Error implements AppIssue {
  readonly severity = "error" as const;

  constructor(
    public readonly code: "INPUT_FILE_SIZE_EXCEEDED" | "TEXTURE_MEMORY_BUDGET_EXCEEDED",
    public readonly subject: string | undefined,
    public readonly details: string[],
  ) {
    super(details[0] ?? code);
    this.name = "ImportResourceLimitError";
  }
}

function assertSafeFileSize(file: File, label: string, maximum: number): number {
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 0 || size > maximum) {
    throw new ImportResourceLimitError(
      "INPUT_FILE_SIZE_EXCEEDED",
      file.name,
      [`${label}「${file.name}」超过 ${maximum / 1024 / 1024} MiB 文件字节安全预算，或声明大小无效。`],
    );
  }
  return size;
}

export function assertSkeletonFileByteBudget(file: File): void {
  assertSafeFileSize(file, "骨骼文件", MAX_SKELETON_FILE_BYTES);
}

export function assertImportFileByteBudget(
  atlasFile: File,
  skeletonFile: File,
  textureFiles: Iterable<File>,
): void {
  assertSafeFileSize(atlasFile, "Atlas 文件", MAX_ATLAS_FILE_BYTES);
  assertSkeletonFileByteBudget(skeletonFile);

  let count = 0;
  let totalBytes = 0;
  for (const texture of textureFiles) {
    count += 1;
    if (count > MAX_TEXTURE_PAGE_COUNT) {
      throw new ImportResourceLimitError(
        "TEXTURE_MEMORY_BUDGET_EXCEEDED",
        texture.name,
        [`一次最多选择 ${MAX_TEXTURE_PAGE_COUNT} 张 PNG 纹理（实际至少 ${count} 张）。`],
      );
    }
    const bytes = assertSafeFileSize(texture, "PNG 纹理", MAX_TEXTURE_FILE_BYTES);
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TEXTURE_TOTAL_FILE_BYTES) {
      throw new ImportResourceLimitError(
        "INPUT_FILE_SIZE_EXCEEDED",
        texture.name,
        [`全部 PNG 纹理文件累计超过 ${MAX_TEXTURE_TOTAL_FILE_BYTES / 1024 / 1024} MiB 文件字节安全预算。`],
      );
    }
  }
}

export function assertSelectedImportFileCount(files: readonly File[]): void {
  if (files.length > MAX_SELECTED_IMPORT_FILE_COUNT) {
    throw new ImportResourceLimitError(
      "TEXTURE_MEMORY_BUDGET_EXCEEDED",
      undefined,
      [`一次最多选择一个 Atlas、一个骨骼文件和 ${MAX_TEXTURE_PAGE_COUNT} 张 PNG（共 ${MAX_SELECTED_IMPORT_FILE_COUNT} 个文件）。`],
    );
  }
}
