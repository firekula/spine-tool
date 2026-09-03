import { useId, useRef, useState } from "react";
import type { AppIssue } from "@/lib/issues/types";
import {
  classifyImport,
  type ImportBundle,
  ImportValidationError,
} from "@/lib/files/import-files";

export interface ImportDropzoneProps {
  inputId?: string;
  disabled?: boolean;
  onImport: (bundle: ImportBundle) => void | Promise<void>;
  onError?: (issue: AppIssue) => void;
}

interface SelectionSummary {
  atlas?: string;
  skeleton?: string;
  pngCount: number;
}

function getSelectionSummary(files: File[]): SelectionSummary {
  const byExtension = (extension: string) => files.find((file) =>
    file.name.toLowerCase().endsWith(extension),
  )?.name;

  return {
    atlas: byExtension(".atlas"),
    skeleton: byExtension(".json") ?? byExtension(".skel"),
    pngCount: files.filter((file) => file.name.toLowerCase().endsWith(".png")).length,
  };
}

function asIssue(error: unknown): AppIssue {
  if (error instanceof ImportValidationError) return error;
  return {
    code: "IMPORT_FAILED",
    severity: "error",
    details: [error instanceof Error ? error.message : "无法读取所选文件。"],
  };
}

export function ImportDropzone({ inputId: suppliedInputId, disabled = false, onImport, onError }: ImportDropzoneProps) {
  const generatedInputId = useId();
  const inputId = suppliedInputId ?? generatedInputId;
  const inputRef = useRef<HTMLInputElement>(null);
  const importLockRef = useRef(false);
  const [summary, setSummary] = useState<SelectionSummary>({ pngCount: 0 });
  const [missingPages, setMissingPages] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = async (files: File[]) => {
    if (disabled || importLockRef.current) return;

    importLockRef.current = true;
    setSummary(getSelectionSummary(files));
    setMissingPages([]);
    setErrorMessage(null);
    setIsImporting(true);
    try {
      const bundle = await classifyImport(files);
      await onImport(bundle);
    } catch (error) {
      const issue = asIssue(error);
      setMissingPages(issue.code === "MISSING_TEXTURE_PAGES" ? issue.details ?? [] : []);
      setErrorMessage(error instanceof Error ? error.message : "无法读取所选文件。");
      onError?.(issue);
    } finally {
      importLockRef.current = false;
      setIsImporting(false);
    }
  };

  return (
    <section
      className={`import-dropzone${isDragging ? " is-dragging" : ""}`}
      aria-busy={isImporting}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled && !isImporting) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        void processFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept=".atlas,.json,.skel,.png,image/png"
        hidden
        disabled={disabled || isImporting}
        onChange={(event) => {
          void processFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <p>拖放 Atlas、JSON/SKEL 和 PNG，或选择文件。</p>
      <button
        type="button"
        className="button button-primary"
        disabled={disabled || isImporting}
        onClick={() => inputRef.current?.click()}
      >
        {isImporting ? "正在验证…" : "选择文件"}
      </button>
      <p className="import-local-note">文件仅在本地处理。</p>
      {errorMessage && <p className="import-error" role="alert">{errorMessage}</p>}
      <dl className="import-summary" aria-label="已识别的导入文件">
        <div><dt>Atlas</dt><dd>{summary.atlas ?? "未选择"}</dd></div>
        <div><dt>骨骼</dt><dd>{summary.skeleton ?? "未选择"}</dd></div>
        <div><dt>PNG</dt><dd>{summary.pngCount} 张</dd></div>
        {missingPages.length > 0 && <div><dt>缺失页</dt><dd>{missingPages.join("、")}</dd></div>}
      </dl>
    </section>
  );
}
