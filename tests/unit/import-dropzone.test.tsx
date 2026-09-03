import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportDropzone } from "@/components/import-dropzone";

afterEach(() => cleanup());

describe("ImportDropzone classification lifecycle", () => {
  it("Atlas text 读取期间卸载后不把迟到 classification 交给导入流水线", async () => {
    let resolveAtlasText!: (text: string) => void;
    let markTextStarted!: () => void;
    const textStarted = new Promise<void>((resolve) => { markTextStarted = resolve; });
    const atlasText = new Promise<string>((resolve) => { resolveAtlasText = resolve; });
    const atlasFile = new File(["pending"], "hero.atlas");
    Object.defineProperty(atlasFile, "text", {
      value: () => {
        markTextStarted();
        return atlasText;
      },
    });
    const onImport = vi.fn();
    const onError = vi.fn();
    const view = render(<ImportDropzone onImport={onImport} onError={onError} />);

    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: {
        files: [
          atlasFile,
          new File(["{}"], "hero.json"),
          new File(["png"], "page.png", { type: "image/png" }),
        ],
      },
    });
    await textStarted;
    view.unmount();

    await act(async () => {
      resolveAtlasText("page.png\nsize: 1,1");
      await atlasText;
      await Promise.resolve();
    });

    expect(onImport).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
