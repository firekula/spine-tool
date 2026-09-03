import { describe, expect, it } from "vitest";

import { externalRuntimeDependencies } from "../../scripts/offline-runtime-audit.mjs";

describe("离线运行依赖审计", () => {
  it("在 HTML 分词后识别 URL 属性中的换行实体", () => {
    const fixtures = [
      '<img src="https:&NewLine;//example.invalid/image.png">',
      "<a href=https:&#10;//example.invalid/link>外部链接</a>",
      '<img srcset="./local.png 1x, https:&Tab;//example.invalid/remote.png 2x">',
      '<form action="https:&#13;//example.invalid/submit"></form>',
      '<img src="&#1;https://example.invalid/control-prefixed.png">',
    ];

    for (const fixture of fixtures) {
      expect(externalRuntimeDependencies("index.html", fixture), fixture).not.toEqual([]);
    }
  });

  it("按浏览器首属性语义审计重复 URL 属性", () => {
    const dangerousFirst = [
      '<img src="https://example.invalid/first.png" src="./safe.png">',
      '<a href="https://example.invalid/first" href="./safe">链接</a>',
      '<img srcset="https://example.invalid/first.png 1x" srcset="./safe.png 1x">',
      '<form action="https://example.invalid/first" action="./safe"></form>',
    ];

    for (const fixture of dangerousFirst) {
      expect(externalRuntimeDependencies("index.html", fixture), fixture).not.toEqual([]);
    }
    expect(externalRuntimeDependencies(
      "index.html",
      '<img src="./safe.png" src="https://example.invalid/ignored.png">',
    )).toEqual([]);
  });

  it("不把 pre 和非执行 script 的实体文本当成可执行标签", () => {
    const html = [
      "<pre>&#60;img src=https://example.invalid/text-only&#62;</pre>",
      "<pre>&lt;script src=https://example.invalid/text-only&gt;&lt;/script&gt;</pre>",
      '<script type="application/json">{"help":"&#60;img src=https://example.invalid/text-only&#62;"}</script>',
    ].join("");

    expect(externalRuntimeDependencies("index.html", html)).toEqual([]);
  });

  it("把 srcset 的 data URL 逗号留在同一候选中", () => {
    const html = '<img srcset="data:text/plain,https://example.invalid/not-a-request 1x, ./local.png 2x">';

    expect(externalRuntimeDependencies("index.html", html)).toEqual([]);
  });

  it("识别所有 JavaScript 字符串语法中的静态外部 URL", () => {
    const fixtures = [
      'fetch("https://example.invalid/data")',
      "import('https://example.invalid/module.js')",
      "xhr.open(`GET`, `https://example.invalid/bare-xhr`)",
      "const xhr = new XMLHttpRequest(); xhr.open(`GET`, `https://example.invalid/data`)",
      "new WebSocket(`wss://example.invalid/socket`)",
      "new EventSource(`//example.invalid/events`)",
      'fetch("https:" + "//example.invalid/composed")',
      'fetch("\\x01https://example.invalid/control-prefixed")',
    ];

    for (const fixture of fixtures) {
      expect(externalRuntimeDependencies("assets/index-a.js", fixture), fixture).not.toEqual([]);
    }
  });

  it("拒绝普通应用代码中无法静态证明安全的网络参数", () => {
    const fixtures = [
      'const u = "./local.json"; fetch(u)',
      "const u = `./${specifier}`; import(u)",
      "const u = makeUrl(); xhr.open(`GET`, u)",
      "const u = makeUrl(); const xhr = new XMLHttpRequest(); xhr.open(`GET`, u)",
      "const u = `wss://${host}/socket`; new WebSocket(u)",
      "const u = `/events/${channel}`; new EventSource(u)",
      'fetch("https://example.invalid/" + path)',
    ];

    for (const fixture of fixtures) {
      expect(externalRuntimeDependencies("assets/index-a.js", fixture), fixture).not.toEqual([]);
    }
  });

  it("识别 navigator.sendBeacon 的静态和动态网络目标", () => {
    expect(externalRuntimeDependencies(
      "assets/index-a.js",
      'navigator.sendBeacon("https://example.invalid/metrics", "payload")',
    )).not.toEqual([]);
    expect(externalRuntimeDependencies(
      "assets/index-a.js",
      'const endpoint = getEndpoint(); navigator.sendBeacon(endpoint, "payload")',
    )).not.toEqual([]);
  });

  it("不因可信文件名或 Vite helper 调用形状跳过 hash 校验", () => {
    expect(externalRuntimeDependencies(
      "assets/runtime-3_8-CzEJ90xh.js",
      "const url = getUrl(); fetch(url)",
    )).not.toEqual([]);
    expect(externalRuntimeDependencies(
      "assets/index-DGMIY7HW.js",
      "const options = {}; const link = document.createElement('link'); fetch(link.href, options)",
    )).not.toEqual([]);
  });

  it("允许静态的 hashed 相对路径、blob、data 和中文字符串", () => {
    const javascript = [
      'import("./runtime-3_8-Ab12cd34.js")',
      'fetch("blob:local-data")',
      "fetch(`data:text/plain,离线中文`)",
      "const xhr = new XMLHttpRequest(); xhr.open(`GET`, `../assets/local.json`)",
      "new WebSocket(`/local-socket`)",
      "new EventSource(`./local-events`)",
      'fetch("./assets/" + "local.json")',
      'const example = \'fetch("https://example.invalid/text-only")\'',
    ].join(";\n");

    expect(externalRuntimeDependencies("assets/index-a.js", javascript)).toEqual([]);
  });

  it("让 HTML 内可执行 script 复用 JavaScript AST 审计", () => {
    const dynamicScript = '<script type="module">const u = `./${name}`; fetch(u)</script>';
    const staticScript = '<script type="module">import("./runtime-4_2-Ab12cd34.js")</script>';

    expect(externalRuntimeDependencies("index.html", dynamicScript)).not.toEqual([]);
    expect(externalRuntimeDependencies("index.html", staticScript)).toEqual([]);
  });
});
