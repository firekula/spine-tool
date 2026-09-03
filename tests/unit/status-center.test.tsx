import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusCenter } from "@/components/status-center";

afterEach(cleanup);

describe("StatusCenter", () => {
  it("同时展示严重性、对象、原因、细节和下一步", () => {
    render(<StatusCenter issues={[
      {
        code: "MISSING_TEXTURE_PAGES",
        severity: "error",
        subject: "hero.atlas",
        details: ["page-b.png"],
      },
      {
        code: "UNUSED_TEXTURES",
        severity: "warning",
        subject: "额外 PNG",
        details: ["unused.png"],
      },
    ]} />);

    const center = screen.getByRole("region", { name: "问题中心" });
    expect(within(center).getByText("缺少纹理页")).toBeTruthy();
    expect(within(center).getByText("hero.atlas")).toBeTruthy();
    expect(within(center).getByText(/Atlas 声明的 PNG/)).toBeTruthy();
    expect(within(center).getByText("page-b.png")).toBeTruthy();
    expect(within(center).getByText(/补齐上述 PNG/)).toBeTruthy();
    expect(within(center).getByText("错误")).toBeTruthy();
    expect(within(center).getByText("警告")).toBeTruthy();
  });
});
