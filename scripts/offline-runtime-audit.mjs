import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parse as parseHtml } from "parse5";
import ts from "typescript";

const offlineAssetManifest = JSON.parse(readFileSync(new URL("./offline-assets.json", import.meta.url), "utf8"));
if (offlineAssetManifest.version !== 1 || !Array.isArray(offlineAssetManifest.assets)) {
  throw new Error("离线完整资产 manifest 格式无效。");
}
export const trustedOfflineAssetDescriptors = Object.freeze(
  offlineAssetManifest.assets.map((descriptor) => Object.freeze({ ...descriptor })),
);

const maxAuditLength = 2 * 1024 * 1024;
const maxCanonicalizationPasses = 8;

// These are complete SHA-256 digests of reviewed Vite output, not filename hashes.
// A source, dependency, minifier, or shared-chunk change invalidates the exception.
// Static URL allowances cover inert metadata/namespaces only; network sinks are
// audited independently and still reject the same exact URL when executable.
export const trustedOfflineRuntimeDescriptors = Object.freeze([
  Object.freeze({
    version: "3_5",
    path: "assets/runtime-3_5-CF7THh20.js",
    sha256: "f04096b69db90dbd263fcefa61ba9f52e6f5d6726c880e36da961b0e03b59e16",
    allowedStaticExternalUrls: Object.freeze([
      "https://github.com/EsotericSoftware/spine-runtimes/tree/afdbbc2044fb56c762d4e2eb54b63b1bb9276a48/spine-ts",
    ]),
  }),
  Object.freeze({
    version: "3_6",
    path: "assets/runtime-3_6-D9p7RgVT.js",
    sha256: "8c9e902eb697282de66e81171fdd2dc8e0c9761429ff5d9c2cc8f99e1e592328",
    allowedStaticExternalUrls: Object.freeze([
      "https://github.com/EsotericSoftware/spine-runtimes/tree/654c20e5b0e523040b6366bbd1042510d2645134/spine-ts",
    ]),
  }),
  Object.freeze({
    version: "3_7",
    path: "assets/runtime-3_7-DYRq2djF.js",
    sha256: "d991785f8be2ec87d6ed22ff43bb344f15814d4500f8ba791942f298b8a45d45",
    allowedStaticExternalUrls: Object.freeze([
      "https://github.com/EsotericSoftware/spine-runtimes/tree/9639bcc81722d7178fd9d1cdc1a3d55a4c91f989/spine-ts",
    ]),
  }),
  Object.freeze({
    version: "3_8",
    path: "assets/runtime-3_8-B9Vc_0ir.js",
    sha256: "1f2881b7f1037d1eb79ea4a6e12c2ef552aebd62637d9443b697b0fb7dbcab34",
    allowedStaticExternalUrls: Object.freeze([
      "https://github.com/EsotericSoftware/spine-runtimes/tree/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts",
    ]),
  }),
  Object.freeze({
    version: "4_0",
    path: "assets/runtime-4_0-BR-V870y.js",
    sha256: "7e51a93c1ecee62fb57e84dac255398c25de3ff7049504eee5d4edc18fe36751",
    allowedStaticExternalUrls: Object.freeze([
      "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.0.31.tgz",
    ]),
  }),
  Object.freeze({
    version: "4_1",
    path: "assets/runtime-4_1-CphynOwC.js",
    sha256: "04b4c4c7405e5d50ec99a2ca8265f8e54810178b288e709fb3496c800bc0ae5a",
    allowedStaticExternalUrls: Object.freeze([
      "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.1.56.tgz",
    ]),
  }),
  Object.freeze({
    version: "4_2",
    path: "assets/runtime-4_2-CqAES-ir.js",
    sha256: "1e611e343a136b6003aa2f80e58970e6197e451d8524c77cca843c2ff2c07d72",
    allowedStaticExternalUrls: Object.freeze([
      "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.2.120.tgz",
    ]),
  }),
  Object.freeze({
    version: "4_3",
    path: "assets/runtime-4_3-C8pusc3x.js",
    sha256: "b70517bb3a7ff07ae88c446f00127b9bc923b91ef37f9a82b6f5435ddfbd0d4d",
    allowedStaticExternalUrls: Object.freeze([
      "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-4.3.9.tgz",
    ]),
  }),
]);

export const trustedOfflineRuntimeHelperDescriptors = Object.freeze([
  Object.freeze({
    path: "assets/runtime-factory-GPLej-A5.js",
    sha256: "d71f386aa734ba67abdab85240c7b12b6e5ab46b000e715f2adf60cb06bd2fe7",
  }),
]);

const trustedMainJavaScript = trustedOfflineAssetDescriptors.find(({ path }) => /^assets\/index-.*\.js$/.test(path));
if (!trustedMainJavaScript) throw new Error("离线完整资产 manifest 缺少主 JavaScript chunk。");

const trustedDynamicJavaScript = new Map([
  [trustedMainJavaScript.path, {
    kind: "vite-modulepreload",
    sha256: trustedMainJavaScript.sha256,
    allowedStaticExternalUrls: [
      "https://reactjs.org/docs/error-decoder.html?invariant=",
      "http://www.w3.org/1999/xlink",
      "http://www.w3.org/XML/1998/namespace",
      "http://www.w3.org/2000/svg",
      "http://www.w3.org/1998/Math/MathML",
      "http://www.w3.org/1999/xhtml",
    ],
  }],
  ...trustedOfflineRuntimeDescriptors.map(({ path, sha256, allowedStaticExternalUrls }) => [path, {
    kind: "spine-runtime",
    sha256,
    allowedStaticExternalUrls,
  }]),
  ...trustedOfflineRuntimeHelperDescriptors.map(({ path, sha256 }) => [path, {
    kind: "spine-runtime-helper",
    sha256,
    allowedStaticExternalUrls: [],
  }]),
]);

const trustedOfflineRuntimeArtifacts = new Map([
  ...trustedOfflineRuntimeDescriptors,
  ...trustedOfflineRuntimeHelperDescriptors,
].map((descriptor) => [descriptor.path, descriptor]));

function ensureAuditLength(contents, format) {
  if (contents.length > maxAuditLength) {
    throw new Error(`${format} 审计输入超过 ${maxAuditLength} 字符限制。`);
  }
}

function codePoint(character) {
  const value = Number.parseInt(character, 16);
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(value);
}

function canonicalize(contents, decode, format) {
  ensureAuditLength(contents, format);
  let canonical = contents;
  for (let pass = 0; pass < maxCanonicalizationPasses; pass += 1) {
    const decoded = decode(canonical);
    if (decoded.length > maxAuditLength) throw new Error(`${format} 规范化结果超过 ${maxAuditLength} 字符限制。`);
    if (decoded === canonical) return decoded;
    canonical = decoded;
  }
  throw new Error(`${format} 规范化在 ${maxCanonicalizationPasses} 轮后仍未稳定，已拒绝打包。`);
}

function decodeCssEscapes(contents) {
  return contents.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([\s\S])/gi, (_match, hex, character) => hex ? codePoint(hex) : character);
}

function canonicalUrl(value) {
  ensureAuditLength(value, "URL 属性");
  // WHATWG URL parsing removes tab/newline/carriage-return anywhere, then
  // strips leading and trailing C0 controls and spaces.
  return value
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "")
    .trim();
}

function isExternalUrl(value) {
  const canonical = canonicalUrl(value);
  return /^(?:https?|wss?):/i.test(canonical) || /^[\\/]{2}/.test(canonical);
}

function isSafeOfflineUrl(value) {
  const canonical = canonicalUrl(value);
  if (/^[\\/]{2}/.test(canonical)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(canonical)?.[1]?.toLowerCase();
  return !scheme || scheme === "blob" || scheme === "data";
}

function srcsetUrls(value) {
  const urls = [];
  let position = 0;
  while (position < value.length) {
    while (position < value.length && (/[\t\n\f\r ]/.test(value[position]) || value[position] === ",")) position += 1;
    if (position >= value.length) break;

    const start = position;
    while (position < value.length && !/[\t\n\f\r ]/.test(value[position])) position += 1;
    let url = value.slice(start, position);
    let endedWithComma = false;
    while (url.endsWith(",")) {
      endedWithComma = true;
      url = url.slice(0, -1);
    }
    if (url) urls.push(url);
    if (endedWithComma) continue;

    let parentheses = 0;
    while (position < value.length) {
      const character = value[position];
      position += 1;
      if (character === "(") parentheses += 1;
      else if (character === ")" && parentheses > 0) parentheses -= 1;
      else if (character === "," && parentheses === 0) break;
    }
  }
  return urls;
}

function executableScript(attributes) {
  const rawType = attributes.find(({ name }) => name === "type")?.value.trim().toLowerCase();
  if (!rawType) return true;
  const type = rawType.split(";", 1)[0].trim();
  const explicitDataType = type === "application/json"
    || type === "text/json"
    || type === "text/plain"
    || type === "application/octet-stream"
    || /\+json$/.test(type);
  return !explicitDataType;
}

function nodeText(node) {
  return (node.childNodes ?? [])
    .filter((child) => child.nodeName === "#text")
    .map((child) => child.value)
    .join("");
}

function externalHtmlTargets(path, contents) {
  ensureAuditLength(contents, "HTML");
  const occurrences = [];
  const document = parseHtml(contents);

  const visit = (node) => {
    if (node.tagName) {
      const attributes = node.attrs ?? [];
      for (const { name, value } of attributes) {
        const urlAttribute = ["src", "href", "srcset", "action", "formaction", "poster"].includes(name)
          || (node.tagName === "object" && name === "data");
        if (urlAttribute) {
          const candidates = name === "srcset" ? srcsetUrls(canonicalUrl(value)) : [value];
          if (candidates.some(isExternalUrl)) occurrences.push(`${path}: ${name}=${value}`);
        }
        if (name === "style") {
          occurrences.push(...externalCssTargets(`${path} ${node.tagName}[style]`, value));
        }
      }
      if (node.tagName === "script" && executableScript(attributes)) {
        occurrences.push(...externalJavaScriptTargets(`${path} inline script`, nodeText(node)));
      }
      if (node.tagName === "style") {
        occurrences.push(...externalCssTargets(`${path} inline style`, nodeText(node)));
      }
      if (node.tagName === "meta") {
        const httpEquiv = attributes.find(({ name }) => name === "http-equiv")?.value.trim().toLowerCase();
        const content = attributes.find(({ name }) => name === "content")?.value ?? "";
        if (httpEquiv === "refresh") {
          const target = /(?:^|;)\s*url\s*=\s*([\s\S]*)$/i.exec(content)?.[1]?.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
          if (target && isExternalUrl(target)) occurrences.push(`${path}: meta refresh=${target}`);
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };

  visit(document);
  return occurrences;
}

function unwrapExpression(node) {
  let expression = node;
  while (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function staticString(expression) {
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expressionValue = staticString(span.expression);
      if (expressionValue === undefined) return undefined;
      value += expressionValue + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function bindingPropertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return ts.isComputedPropertyName(node) ? staticString(node.expression) : undefined;
}

function collectJavaScriptBindings(sourceFile) {
  const bindings = new Map();
  const add = (name, descriptor) => {
    const descriptors = bindings.get(name) ?? [];
    descriptors.push(descriptor);
    bindings.set(name, descriptors);
  };

  const bind = (name, initializer) => {
    if (ts.isIdentifier(name)) {
      add(name.text, { kind: "expression", expression: initializer });
      return;
    }
    if (!ts.isObjectBindingPattern(name)) return;
    for (const element of name.elements) {
      if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
      const member = bindingPropertyName(element.propertyName) ?? element.name.text;
      add(element.name.text, { kind: "property", receiver: initializer, name: member });
    }
  };

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) bind(node.name, node.initializer);
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(unwrapExpression(node.left))
    ) {
      add(unwrapExpression(node.left).text, { kind: "expression", expression: node.right });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function resolvedStaticString(expression, values) {
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return values.get(node.text);
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expressionValue = resolvedStaticString(span.expression, values);
      if (expressionValue === undefined) return undefined;
      value += expressionValue + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolvedStaticString(node.left, values);
    const right = resolvedStaticString(node.right, values);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function propertyName(expression) {
  const node = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) return staticString(node.argumentExpression);
  return undefined;
}

function propertyReceiver(expression) {
  const node = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return node.expression;
  return undefined;
}

function trustedJavaScript(path, contents) {
  const descriptor = trustedDynamicJavaScript.get(path);
  if (!descriptor) return undefined;
  const digest = createHash("sha256").update(contents).digest("hex");
  return digest === descriptor.sha256 ? descriptor : undefined;
}

export function matchesTrustedOfflineRuntime(path, contents) {
  return trustedJavaScript(path, contents)?.kind === "spine-runtime";
}

export function matchesTrustedOfflineRuntimeArtifact(path, contents) {
  const descriptor = trustedOfflineRuntimeArtifacts.get(path);
  if (!descriptor) return false;
  return createHash("sha256").update(contents).digest("hex") === descriptor.sha256;
}

function vitePreloadCallSignature(call) {
  if (call.arguments.length !== 2) return false;
  const url = unwrapExpression(call.arguments[0]);
  return propertyName(url) === "href" && ts.isIdentifier(unwrapExpression(call.arguments[1]));
}

function allowsTrustedDynamicTarget(trust, category, call) {
  if (trust?.kind === "spine-runtime" || trust?.kind === "spine-runtime-helper") return true;
  if (trust?.kind !== "vite-modulepreload") return false;
  if (category === "fetch") return vitePreloadCallSignature(call);
  // Vite rewrites `new Worker(new URL(..., import.meta.url))` to a resolved
  // `"" + new URL(...).href` expression. The complete main-chunk hash is the
  // narrow reviewed boundary for this local Worker target.
  return category.startsWith("Worker") || category.startsWith("SharedWorker");
}

function externalJavaScriptTargets(path, contents) {
  ensureAuditLength(contents, "JavaScript");
  const sourceFile = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const occurrences = [];
  const seen = new Set();
  const trust = trustedJavaScript(path, contents);
  // Exact hash-pinned helpers have already been reviewed byte-for-byte. Avoid
  // building a whole-bundle alias graph for them; their narrowly allowed
  // dynamic calls are still checked below by syntax and trust kind.
  const bindings = trust ? new Map() : collectJavaScriptBindings(sourceFile);

  const record = (node, reason) => {
    const key = `${node.pos}:${node.end}:${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const snippet = node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 160);
    occurrences.push(`${path}:${start.line + 1}:${start.character + 1}: ${reason}: ${snippet}`);
  };

  for (const diagnostic of sourceFile.parseDiagnostics) {
    const start = diagnostic.start ?? 0;
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    occurrences.push(`${path}:${location.line + 1}:${location.character + 1}: JavaScript 无法解析: ${message}`);
  }

  const callableKinds = new Set(["fetch", "importScripts", "sendBeacon", "xhrOpen", "open", "locationNavigate"]);
  const globalMembers = new Map([
    ["fetch", "fetch"],
    ["importScripts", "importScripts"],
    ["sendBeacon", "sendBeacon"],
    ["Worker", "Worker"],
    ["SharedWorker", "SharedWorker"],
    ["WebSocket", "WebSocket"],
    ["EventSource", "EventSource"],
    ["XMLHttpRequest", "XMLHttpRequest"],
    ["URL", "URL"],
    ["open", "open"],
    ["location", "location"],
  ]);

  const kindsForProperty = (receiverKinds, name) => {
    const kinds = new Set();
    for (const receiverKind of receiverKinds) {
      if (receiverKind === "global") {
        if (["globalThis", "self", "window"].includes(name)) kinds.add("global");
        if (name === "navigator") kinds.add("navigator");
        const globalMember = globalMembers.get(name);
        if (globalMember) kinds.add(globalMember);
      }
      if (receiverKind === "document" && name === "location") kinds.add("location");
      if (receiverKind === "navigator" && name === "sendBeacon") kinds.add("sendBeacon");
      if (receiverKind === "xhr" && name === "open") kinds.add("xhrOpen");
      if (receiverKind === "location" && (name === "assign" || name === "replace")) kinds.add("locationNavigate");
      if (callableKinds.has(receiverKind) && (name === "call" || name === "apply")) {
        kinds.add(`${receiverKind}:${name}`);
      }
    }
    return kinds;
  };

  const addKinds = (target, source) => {
    for (const kind of source) target.add(kind);
    return target;
  };

  const bindingKinds = new Map();
  const directIdentifierKinds = (name) => {
    const kinds = new Set();
    if (["globalThis", "self", "window"].includes(name)) kinds.add("global");
    if (name === "document") kinds.add("document");
    if (name === "navigator") kinds.add("navigator");
    if (name === "location") kinds.add("location");
    const globalMember = globalMembers.get(name);
    if (globalMember) kinds.add(globalMember);
    if (/^(?:xhr|xmlHttpRequest)$/i.test(name)) kinds.add("xhr");
    return kinds;
  };

  const resolveValueKinds = (expression) => {
    const node = unwrapExpression(expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return resolveValueKinds(node.right);
    }
    if (ts.isConditionalExpression(node)) {
      return addKinds(
        resolveValueKinds(node.whenTrue),
        resolveValueKinds(node.whenFalse),
      );
    }

    const kinds = new Set();
    if (ts.isIdentifier(node)) {
      return addKinds(directIdentifierKinds(node.text), bindingKinds.get(node.text) ?? []);
    }

    const receiver = propertyReceiver(node);
    const name = propertyName(node);
    if (receiver && name !== undefined) return kindsForProperty(resolveValueKinds(receiver), name);

    if (ts.isNewExpression(node)) {
      if (resolveValueKinds(node.expression).has("XMLHttpRequest")) kinds.add("xhr");
      return kinds;
    }

    if (ts.isCallExpression(node)) {
      const callReceiver = propertyReceiver(node.expression);
      if (callReceiver && propertyName(node.expression) === "bind") {
        for (const kind of resolveValueKinds(callReceiver)) {
          if (callableKinds.has(kind)) kinds.add(kind);
        }
      }
    }
    return kinds;
  };

  const kindDependencies = (expression, dependencies = new Set()) => {
    const node = unwrapExpression(expression);
    if (ts.isIdentifier(node)) {
      dependencies.add(node.text);
      return dependencies;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return kindDependencies(node.right, dependencies);
    }
    if (ts.isConditionalExpression(node)) {
      kindDependencies(node.whenTrue, dependencies);
      return kindDependencies(node.whenFalse, dependencies);
    }
    const receiver = propertyReceiver(node);
    if (receiver && propertyName(node) !== undefined) return kindDependencies(receiver, dependencies);
    if (ts.isNewExpression(node)) return kindDependencies(node.expression, dependencies);
    if (ts.isCallExpression(node)) {
      const callReceiver = propertyReceiver(node.expression);
      if (callReceiver && propertyName(node.expression) === "bind") {
        return kindDependencies(callReceiver, dependencies);
      }
    }
    return dependencies;
  };

  const kindDependents = new Map();
  for (const [target, descriptors] of bindings) {
    for (const descriptor of descriptors) {
      const expression = descriptor.kind === "expression" ? descriptor.expression : descriptor.receiver;
      for (const dependency of kindDependencies(expression)) {
        const dependents = kindDependents.get(dependency) ?? new Set();
        dependents.add(target);
        kindDependents.set(dependency, dependents);
      }
    }
  }

  const kindQueue = [...bindings.keys()];
  const queuedKinds = new Set(kindQueue);
  for (let position = 0; position < kindQueue.length; position += 1) {
    const name = kindQueue[position];
    queuedKinds.delete(name);
    const kinds = bindingKinds.get(name) ?? new Set();
    const previousSize = kinds.size;
    for (const descriptor of bindings.get(name) ?? []) {
      const descriptorKinds = descriptor.kind === "expression"
        ? resolveValueKinds(descriptor.expression)
        : kindsForProperty(resolveValueKinds(descriptor.receiver), descriptor.name);
      addKinds(kinds, descriptorKinds);
    }
    bindingKinds.set(name, kinds);
    if (kinds.size === previousSize) continue;
    for (const dependent of kindDependents.get(name) ?? []) {
      if (queuedKinds.has(dependent)) continue;
      queuedKinds.add(dependent);
      kindQueue.push(dependent);
    }
  }

  const staticValues = new Map();
  if (!trust) {
    const staticDependencies = (expression, dependencies = new Set()) => {
      const node = unwrapExpression(expression);
      if (ts.isIdentifier(node)) dependencies.add(node.text);
      else if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) staticDependencies(span.expression, dependencies);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        staticDependencies(node.left, dependencies);
        staticDependencies(node.right, dependencies);
      }
      return dependencies;
    };

    const staticDependents = new Map();
    for (const [target, descriptors] of bindings) {
      for (const descriptor of descriptors) {
        if (descriptor.kind !== "expression") continue;
        for (const dependency of staticDependencies(descriptor.expression)) {
          const dependents = staticDependents.get(dependency) ?? new Set();
          dependents.add(target);
          staticDependents.set(dependency, dependents);
        }
      }
    }

    const staticQueue = [...bindings.keys()];
    const queuedStatic = new Set(staticQueue);
    for (let position = 0; position < staticQueue.length; position += 1) {
      const name = staticQueue[position];
      queuedStatic.delete(name);
      if (staticValues.has(name)) continue;
      const descriptors = bindings.get(name) ?? [];
      const values = descriptors.map((descriptor) => descriptor.kind === "expression"
        ? resolvedStaticString(descriptor.expression, staticValues)
        : undefined);
      if (values.length === 0 || values.some((value) => value === undefined) || new Set(values).size !== 1) continue;
      staticValues.set(name, values[0]);
      for (const dependent of staticDependents.get(name) ?? []) {
        if (queuedStatic.has(dependent)) continue;
        queuedStatic.add(dependent);
        staticQueue.push(dependent);
      }
    }
  }

  const isImportMetaUrl = (expression, resolving = new Set()) => {
    const node = unwrapExpression(expression);
    if (ts.isIdentifier(node)) {
      if (resolving.has(node.text)) return false;
      const descriptors = bindings.get(node.text) ?? [];
      if (descriptors.length === 0) return false;
      const next = new Set(resolving).add(node.text);
      return descriptors.every((descriptor) => descriptor.kind === "expression"
        && isImportMetaUrl(descriptor.expression, next));
    }
    if (propertyName(node) !== "url") return false;
    const receiver = unwrapExpression(propertyReceiver(node));
    return ts.isMetaProperty(receiver)
      && receiver.keywordToken === ts.SyntaxKind.ImportKeyword
      && receiver.name.text === "meta";
  };

  const auditNetworkArgument = (
    call,
    argument,
    category,
    allowImportMetaUrl = false,
    allowResolvedStatic = false,
  ) => {
    if (!argument) {
      record(call, `${category} 缺少 URL 参数`);
      return;
    }
    if (allowImportMetaUrl && isImportMetaUrl(argument)) return;
    const value = allowResolvedStatic
      ? resolvedStaticString(argument, staticValues)
      : staticString(argument);
    if (value === undefined) {
      if (!allowsTrustedDynamicTarget(trust, category, call)) record(argument, `${category} 使用动态网络目标`);
      return;
    }
    if (!isSafeOfflineUrl(value)) record(argument, `${category} 使用外部 URL`);
  };

  const appliedArguments = (argument) => {
    const node = argument && unwrapExpression(argument);
    return node && ts.isArrayLiteralExpression(node) ? [...node.elements] : undefined;
  };

  const auditCallableInvocation = (call) => {
    for (const resolvedKind of resolveValueKinds(call.expression)) {
      const [kind, adapter = "direct"] = resolvedKind.split(":");
      if (!callableKinds.has(kind)) continue;

      let argumentsList = [...call.arguments];
      if (adapter === "call") argumentsList = argumentsList.slice(1);
      if (adapter === "apply") {
        const applied = appliedArguments(argumentsList[1]);
        if (!applied) {
          record(argumentsList[1] ?? call, `${kind} 使用动态参数列表`);
          continue;
        }
        argumentsList = applied;
      }

      if (kind === "importScripts") {
        if (argumentsList.length === 0) auditNetworkArgument(call, undefined, kind);
        for (const argument of argumentsList) auditNetworkArgument(call, argument, kind);
      } else {
        const index = kind === "xhrOpen" ? 1 : 0;
        const category = kind === "xhrOpen"
          ? "XMLHttpRequest.open"
          : kind === "locationNavigate"
            ? "location 导航"
            : kind === "open"
              ? "window.open"
              : kind;
        auditNetworkArgument(call, argumentsList[index], category);
      }
    }
  };

  const visit = (node) => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)
      || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      const value = resolvedStaticString(node, staticValues);
      if (
        value !== undefined
        && isExternalUrl(value)
        && !trust?.allowedStaticExternalUrls.includes(value)
      ) record(node, "JavaScript 包含未经批准的静态外部 URL");
    }

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const value = staticString(node.moduleSpecifier);
        if (value !== undefined && !isSafeOfflineUrl(value)) record(node.moduleSpecifier, "module 使用外部 URL");
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        auditNetworkArgument(node, node.arguments[0], "import()");
      } else auditCallableInvocation(node);
    } else if (ts.isNewExpression(node)) {
      for (const constructor of ["Worker", "SharedWorker", "WebSocket", "EventSource"]) {
        if (!resolveValueKinds(node.expression).has(constructor)) continue;
        const argument = node.arguments?.[0];
        if ((constructor === "Worker" || constructor === "SharedWorker") && argument) {
          const unwrapped = unwrapExpression(argument);
          if (ts.isNewExpression(unwrapped) && resolveValueKinds(unwrapped.expression).has("URL")) {
            auditNetworkArgument(node, unwrapped.arguments?.[0], `${constructor} path`, false, true);
            if ((unwrapped.arguments?.length ?? 0) > 1) {
              auditNetworkArgument(node, unwrapped.arguments?.[1], `${constructor} base`, true, true);
            }
            break;
          }
        }
        auditNetworkArgument(
          node,
          argument,
          constructor,
          false,
          constructor === "Worker" || constructor === "SharedWorker",
        );
        break;
      }
      if (resolveValueKinds(node.expression).has("URL")) {
        for (const argument of node.arguments?.slice(0, 2) ?? []) {
          const value = staticString(argument);
          if (value !== undefined && isExternalUrl(value)) record(argument, "URL 使用外部目标");
        }
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapExpression(node.left);
      const leftName = ts.isIdentifier(left) ? left.text : propertyName(left);
      const receiver = propertyReceiver(left);
      const navigationTarget = leftName === "location"
        && resolveValueKinds(left).has("location")
        || leftName === "href" && receiver && resolveValueKinds(receiver).has("location");
      if (navigationTarget) {
        const value = resolvedStaticString(node.right, staticValues);
        if (value === undefined) record(node.right, "location 导航使用动态目标");
        else if (!isSafeOfflineUrl(value)) record(node.right, "location 导航使用外部 URL");
      } else if (["src", "href"].includes(leftName ?? "")) {
        const value = staticString(node.right);
        if (value !== undefined && isExternalUrl(value)) record(node.right, `${leftName} 使用外部 URL`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return occurrences;
}

function externalCssTargets(path, contents) {
  const occurrences = [];
  const canonical = canonicalize(contents, decodeCssEscapes, "CSS");
  for (const pattern of [/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi, /url\(\s*["']?(?:https?:)?\/\//gi]) {
    for (const match of canonical.matchAll(pattern)) occurrences.push(`${path}: ${match[0]}`);
  }
  return occurrences;
}

export function externalRuntimeDependencies(path, contents) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".html")) return externalHtmlTargets(path, contents);
  if (lowerPath.endsWith(".css")) return externalCssTargets(path, contents);
  return lowerPath.endsWith(".js") ? externalJavaScriptTargets(path, contents) : [];
}
