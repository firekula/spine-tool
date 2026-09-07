import { describe, expect, it } from "vitest";

import { externalRuntimeDependencies } from "../../scripts/offline-runtime-audit.mjs";

describe("离线运行依赖审计", () => {
  it.each([
    '<meta http-equiv="refresh" content="0; url=https://example.invalid/redirect">',
    '<meta content="5;URL=//example.invalid/redirect" http-equiv="REFRESH">',
  ])("识别 HTML meta refresh 导航：%s", (fixture) => {
    expect(externalRuntimeDependencies("index.html", fixture)).not.toEqual([]);
  });

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

  it.each([
    ["formaction", '<button formaction="https://example.invalid/submit">提交</button>'],
    ["poster", '<video poster="https://example.invalid/poster.png"></video>'],
    ["object[data]", '<object data="https://example.invalid/document.pdf"></object>'],
  ])("审计额外的 HTML URL 属性：%s", (_label, fixture) => {
    expect(externalRuntimeDependencies("index.html", fixture)).not.toEqual([]);
  });

  it.each([
    ["style attribute", '<div style="background-image:url(https://example.invalid/background.png)"></div>'],
    ["style element", '<style>@import "https://example.invalid/theme.css";</style>'],
  ])("让内联 CSS 复用远程 URL 审计：%s", (_label, fixture) => {
    expect(externalRuntimeDependencies("index.html", fixture)).not.toEqual([]);
  });

  it("允许 HTML 与内联 CSS 中的相对、data 和 blob 资源", () => {
    const html = [
      '<button formaction="./submit">提交</button>',
      '<video poster="./poster.png"></video>',
      '<video poster="data:image/png;base64,AAAA"></video>',
      '<object data="blob:local-document"></object>',
      '<div style="background:url(./background.png)"></div>',
      '<style>.local { background:url(data:image/png;base64,AAAA) }</style>',
    ].join("");

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

  it.each([
    ["window.navigator.sendBeacon", 'window.navigator.sendBeacon(getEndpoint(), "payload")'],
    ["逗号运算符 fetch", "(0, fetch)(getEndpoint())"],
    ["fetch.call", "fetch.call(globalThis, getEndpoint())"],
    ["globalThis.fetch 别名", "const request = globalThis.fetch; request(getEndpoint())"],
    ["多级全局别名", "const root = globalThis; const request = root.fetch; request(getEndpoint())"],
    ["解构 fetch 别名", "const { fetch: request } = globalThis; request(getEndpoint())"],
    ["绑定后的 fetch 别名", "const request = fetch.bind(globalThis); request(getEndpoint())"],
  ])("拒绝合法的全局网络 API 间接调用：%s", (_label, fixture) => {
    expect(externalRuntimeDependencies("assets/index-a.js", fixture)).not.toEqual([]);
  });

  it.each([
    ["window.open", 'window.open("https://example.invalid/popup")'],
    ["open 动态参数", "open(getTarget())"],
    ["location.assign", 'location.assign("https://example.invalid/assign")'],
    ["location.replace", "window.location.replace(getTarget())"],
    ["location href", 'location.href = "https://example.invalid/href"'],
    ["window location 动态赋值", "window.location = getTarget()"],
    ["document location 动态赋值", "document.location = getTarget()"],
    ["document location href 动态赋值", "document.location.href = getTarget()"],
    ["计算属性 location", 'window["loc" + "ation"]["hr" + "ef"] = "https://example.invalid/calculated"'],
  ])("审计弹窗与页面导航目标：%s", (_label, fixture) => {
    expect(externalRuntimeDependencies("assets/index-a.js", fixture)).not.toEqual([]);
  });

  it.each([
    ["Worker 静态外部 base", 'new Worker(new URL("./worker.js", "https://example.invalid/base/"))'],
    ["SharedWorker 动态 base", 'new SharedWorker(new URL("./worker.js", getBase()))'],
  ])("同时审计 Worker URL 的 path 和 base：%s", (_label, fixture) => {
    expect(externalRuntimeDependencies("assets/index-a.js", fixture)).not.toEqual([]);
  });

  it.each([
    ["无 API 的外链字符串", 'const endpoint = "https://example.invalid/data"'],
    ["常量拼接外链", 'const scheme = "https"; const endpoint = scheme + "://example.invalid/data"'],
    ["常量模板外链", 'const scheme = "wss"; const endpoint = `${scheme}://example.invalid/socket`'],
  ])("拒绝普通应用 chunk 中任意可静态求值的外部 URL：%s", (_label, fixture) => {
    expect(externalRuntimeDependencies("assets/index-a.js", fixture)).not.toEqual([]);
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

  it("来源元数据 URL 不会成为可执行网络目标例外", () => {
    const sourceUrl = "https://github.com/EsotericSoftware/spine-runtimes/tree/";

    expect(externalRuntimeDependencies(
      "assets/runtime-review.js",
      `export const source = { url: "${sourceUrl}" };`,
    )).not.toEqual([]);
    expect(externalRuntimeDependencies(
      "assets/runtime-review.js",
      `fetch("${sourceUrl}");`,
    )).toEqual(expect.arrayContaining([
      expect.stringContaining("fetch 使用外部 URL"),
    ]));
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
      'new Worker("./worker.js")',
      'new SharedWorker(new URL("./shared-worker.js", import.meta.url))',
      'const example = "普通中文说明"',
    ].join(";\n");

    expect(externalRuntimeDependencies("assets/index-a.js", javascript)).toEqual([]);
  });

  it("允许可证明安全的相对、blob 和 import.meta Worker 别名", () => {
    const javascript = [
      'const workerPath = "./worker.js"; new Worker(workerPath)',
      'const blobWorker = "blob:local-worker"; new Worker(blobWorker)',
      'const moduleBase = import.meta.url; new SharedWorker(new URL("./shared-worker.js", moduleBase))',
    ].join(";\n");

    expect(externalRuntimeDependencies("assets/index-a.js", javascript)).toEqual([]);
  });

  it("让 HTML 内可执行 script 复用 JavaScript AST 审计", () => {
    const dynamicScript = '<script type="module">const u = `./${name}`; fetch(u)</script>';
    const staticScript = '<script type="module">import("./runtime-4_2-Ab12cd34.js")</script>';

    expect(externalRuntimeDependencies("index.html", dynamicScript)).not.toEqual([]);
    expect(externalRuntimeDependencies("index.html", staticScript)).toEqual([]);
  });

  it.each([
    "application/x-javascript",
    "text/javascript1.5",
    "text/jscript",
    "text/livescript",
    "text/x-unknown-script",
  ])("把 legacy 或未知 script type 保守视为可执行：%s", (type) => {
    const html = `<script type="${type}">fetch(getEndpoint())</script>`;

    expect(externalRuntimeDependencies("index.html", html)).not.toEqual([]);
  });

  it("只排除明确的 JSON/data script MIME", () => {
    const html = [
      '<script type="application/json">{"url":"https://example.invalid/data-only"}</script>',
      '<script type="application/ld+json; charset=utf-8">{"url":"https://example.invalid/metadata"}</script>',
      '<script type="text/plain">fetch(getEndpoint())</script>',
      '<script type="application/octet-stream">fetch(getEndpoint())</script>',
    ].join("");

    expect(externalRuntimeDependencies("index.html", html)).toEqual([]);
  });
});
