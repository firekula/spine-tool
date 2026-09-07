import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Windows PowerShell 5.1 启动器", () => {
  it.each(["offline", "ready-to-run"])("%s 中的中文脚本使用 UTF-8 BOM，避免 ANSI 误读", (directory) => {
    const bytes = readFileSync(`${directory}/Start-Offline.ps1`);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toContain("无法启动");
  });

  it("发布副本与源脚本完全一致，CMD 使用当前进程的执行策略参数", () => {
    expect(readFileSync("ready-to-run/Start-Offline.ps1")).toEqual(readFileSync("offline/Start-Offline.ps1"));
    for (const directory of ["offline", "ready-to-run"]) {
      const cmd = readFileSync(`${directory}/启动离线工具.cmd`, "utf8");
      expect(cmd).toContain('-ExecutionPolicy Bypass -File "%~dp0Start-Offline.ps1"');
      expect(cmd).not.toContain("Set-ExecutionPolicy");
    }
  });
});
