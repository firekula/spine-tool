import type { AppIssue } from "@/lib/issues/types";

export interface IssueMessage {
  title: string;
  reason: string;
  action: string;
}

const ISSUE_MESSAGES: Record<string, IssueMessage> = {
  MISSING_ATLAS: {
    title: "缺少 Atlas 文件",
    reason: "本次选择中没有找到 .atlas 文件。",
    action: "请重新选择，并加入该骨骼对应的一个 Atlas 文件。",
  },
  MULTIPLE_ATLAS: {
    title: "Atlas 文件过多",
    reason: "一次只能处理一个 Atlas 文件。",
    action: "请只保留同一套资源的一个 .atlas 文件后重试。",
  },
  MISSING_SKELETON: {
    title: "缺少骨骼文件",
    reason: "本次选择中没有找到 Spine JSON 或 SKEL。",
    action: "请重新选择，并加入一个与 Atlas 配套的 .json 或 .skel 文件。",
  },
  MULTIPLE_SKELETON: {
    title: "骨骼文件过多",
    reason: "一次只能预览一个 Spine 骨骼。",
    action: "请只保留一个 .json 或 .skel 文件后重试。",
  },
  MISSING_TEXTURE_FILES: {
    title: "缺少 PNG 纹理",
    reason: "本次选择中没有可供 Atlas 使用的 PNG 文件。",
    action: "请加入 Atlas 对应的全部 PNG 纹理页后重试。",
  },
  MISSING_TEXTURE_PAGES: {
    title: "缺少纹理页",
    reason: "Atlas 声明的 PNG 纹理页没有全部选中。",
    action: "请补齐上述 PNG 文件，并保持文件名与 Atlas 中的声明一致。",
  },
  AMBIGUOUS_TEXTURE_PAGE: {
    title: "纹理页名称有歧义",
    reason: "多个 PNG 使用了相同的末级文件名，工具无法安全匹配。",
    action: "请按 Atlas 中的相对路径整理文件名，或移除重复候选后重试。",
  },
  UNUSED_TEXTURES: {
    title: "存在未使用的 PNG",
    reason: "这些 PNG 没有被当前 Atlas 声明。",
    action: "可以继续处理；若它们本应使用，请检查 Atlas 页名称。",
  },
  MISSING_PAGE: {
    title: "Atlas 缺少纹理页",
    reason: "Atlas 为空，或页面声明缺少有效名称和尺寸。",
    action: "请从 Spine 重新导出 Atlas，或补齐页面名称及 size 字段。",
  },
  DUPLICATE_PAGE: {
    title: "Atlas 纹理页重名",
    reason: "同一个页面名称在 Atlas 中出现了多次。",
    action: "请让每个纹理页使用唯一名称后重新导入。",
  },
  INCOMPLETE_REGION: {
    title: "Region 字段不完整",
    reason: "Region 缺少裁切尺寸、原始尺寸或透明边距信息。",
    action: "请补齐错误详情指出的字段，或从 Spine 重新导出 Atlas。",
  },
  INVALID_SIZE: {
    title: "Atlas 尺寸无效",
    reason: "页面或 Region 的宽高不是大于 0 的有限数字。",
    action: "请修正对应行的尺寸值后重新导入。",
  },
  INVALID_VALUE: {
    title: "Atlas 字段格式无效",
    reason: "字段的数字个数或值格式不符合 Atlas 规范。",
    action: "请按错误详情中的格式建议修正对应行。",
  },
  UNSUPPORTED_SPINE_VERSION: {
    title: "Spine 版本不在支持范围",
    reason: "检测到的版本不在明确支持的 Spine 3.5–4.3 版本线内。",
    action: "请选择正确的 Runtime 尝试预览，或用 Spine 3.5–4.3 中对应版本重新导出骨骼。",
  },
  UNDETECTABLE_SPINE_VERSION: {
    title: "无法识别 Spine 版本",
    reason: "JSON 中没有有效版本字段，或骨骼头部不完整。",
    action: "请选择导出该文件时使用的 Runtime 版本后再加载。",
  },
  INVALID_SKEL_HEADER: {
    title: "无法读取 SKEL 版本",
    reason: "SKEL 头部不完整，或没有可识别的 Spine 版本。",
    action: "请确认文件未损坏，再手动选择导出它的 Runtime 版本。",
  },
  INVALID_JSON: {
    title: "JSON 骨骼无效",
    reason: "Runtime 无法解析骨骼 JSON。",
    action: "请检查 JSON 是否完整，并确认所选 Runtime 与导出版本一致。",
  },
  SPINE_3_8_75_COMPATIBILITY: {
    title: "Spine 3.8.75 尽力兼容",
    reason: "官方 Spine 3.8 Runtime 将这个精确导出版本标记为存在已知问题；工具只移除主动拒绝，并原样尝试读取骨骼数据。",
    action: "可以继续尝试预览；若失败，请尽量用其他 Spine 3.8 补丁版本重新导出。Atlas Region 仍可继续导出。",
  },
  SPINE_PRERELEASE_COMPATIBILITY: {
    title: "Spine 预发布版本兼容风险",
    reason: "检测到 Beta、Alpha 或其他预发布版本；同一主次版本的 Runtime 可尝试加载，但不保证兼容。",
    action: "可以继续预览与导出；若加载或渲染异常，请用对应 Spine 稳定版重新导出。",
  },
  RUNTIME_CAPABILITY_UNSUPPORTED: {
    title: "当前 Runtime 不支持 SKEL",
    reason: "Spine 3.5–3.7 的官方 Web Runtime 仅支持 JSON 骨骼。",
    action: "请用同一 Spine 版本重新导出 JSON；工具不会跨版本尝试读取 SKEL。",
  },
  WEBGL_UNAVAILABLE: {
    title: "浏览器无法启动 WebGL",
    reason: "当前浏览器或图形环境没有提供可用的 WebGL context。",
    action: "请启用硬件加速或改用支持 WebGL 的最新版浏览器；Atlas 仍可继续导出。",
  },
  PREVIEW_LOAD_FAILED: {
    title: "Spine 预览加载失败",
    reason: "所选 Runtime 无法读取当前骨骼、Atlas 或纹理。",
    action: "请核对导出版本和文件组合后重新导入；若 Atlas 已就绪，仍可继续导出 Region。",
  },
  IMAGE_DECODE_FAILED: {
    title: "PNG 纹理解码失败",
    reason: "浏览器无法把某张 PNG 解码为图像。",
    action: "请重新导出或替换错误详情指出的 PNG 文件。",
  },
  REGION_OUT_OF_BOUNDS: {
    title: "Region 超出纹理范围",
    reason: "Region 的裁切矩形落在所属 PNG 纹理页之外。",
    action: "请检查 Atlas 与 PNG 是否来自同一次导出；其他有效 Region 仍会继续处理。",
  },
  MISSING_TEXTURE_PAGE: {
    title: "Region 缺少纹理页",
    reason: "导出该 Region 时没有找到它所属的 PNG 纹理页。",
    action: "请重新导入 Atlas 声明的完整 PNG 文件；其他有效 Region 已继续处理。",
  },
  REGION_EXPORT_FAILED: {
    title: "Region 导出失败",
    reason: "该 Region 在裁切、恢复透明边距、缩放或 PNG 编码阶段失败。",
    action: "请按错误详情检查 Atlas 数值、倍率和浏览器图像支持；其他有效 Region 已继续处理。",
  },
  ZIP_FAILED: {
    title: "ZIP 生成失败",
    reason: "浏览器在恢复图片或打包文件时发生错误。",
    action: "请修正详情中的 Region 或倍率问题后重试，并确认浏览器有足够内存。",
  },
  IMPORT_FAILED: {
    title: "导入失败",
    reason: "浏览器无法读取或校验所选文件。",
    action: "请检查文件是否完整、可读，然后重新选择。",
  },
};

const UNKNOWN_MESSAGE: IssueMessage = {
  title: "处理失败",
  reason: "工具遇到了尚未分类的问题。",
  action: "请检查所选文件后重试；若问题持续，请记录错误代码。",
};

export function getIssueMessage(issue: AppIssue): IssueMessage {
  return ISSUE_MESSAGES[issue.code] ?? UNKNOWN_MESSAGE;
}
