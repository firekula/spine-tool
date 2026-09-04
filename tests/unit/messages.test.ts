import { describe, expect, it } from "vitest";
import { getIssueMessage } from "@/lib/ui/messages";

describe("getIssueMessage", () => {
  it.each([
    "MISSING_ATLAS",
    "MISSING_SKELETON",
    "MISSING_TEXTURE_PAGES",
    "UNSUPPORTED_SPINE_VERSION",
    "INVALID_SKEL_HEADER",
    "SPINE_3_8_75_COMPATIBILITY",
    "SPINE_PRERELEASE_COMPATIBILITY",
    "RUNTIME_CAPABILITY_UNSUPPORTED",
    "WEBGL_UNAVAILABLE",
    "REGION_OUT_OF_BOUNDS",
    "ZIP_FAILED",
  ])("%s 有中文标题、原因和操作建议", (code) => {
    const message = getIssueMessage({ code, severity: "error", subject: "hero" });

    expect(message.title).toMatch(/[\u4e00-\u9fff]/);
    expect(message.reason).toMatch(/[\u4e00-\u9fff]/);
    expect(message.action).toMatch(/[\u4e00-\u9fff]/);
  });

  it("未知错误码也提供可操作的中文兜底信息", () => {
    expect(getIssueMessage({ code: "SOMETHING_NEW", severity: "error" })).toEqual({
      title: "处理失败",
      reason: "工具遇到了尚未分类的问题。",
      action: "请检查所选文件后重试；若问题持续，请记录错误代码。",
    });
  });

  it.each([
    ["MISSING_TEXTURE_PAGE", "Region 缺少纹理页"],
    ["REGION_EXPORT_FAILED", "Region 导出失败"],
  ])("%s 使用专属中文消息而不是未知错误兜底", (code, title) => {
    expect(getIssueMessage({ code, severity: "warning", subject: "hero" })).toMatchObject({ title });
  });

  it("支持范围文案覆盖 Spine 3.5 到 4.3 的全部八条版本线", () => {
    expect(getIssueMessage({ code: "UNSUPPORTED_SPINE_VERSION", severity: "warning" })).toMatchObject({
      reason: "检测到的版本不在明确支持的 Spine 3.5–4.3 版本线内。",
      action: "请选择正确的 Runtime 尝试预览，或用 Spine 3.5–4.3 中对应版本重新导出骨骼。",
    });
  });
});
