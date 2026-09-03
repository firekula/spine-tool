import { createHash } from "node:crypto";

import { parse as parseHtml } from "parse5";
import ts from "typescript";

const maxAuditLength = 2 * 1024 * 1024;
const maxCanonicalizationPasses = 8;

// These are complete SHA-256 digests of reviewed Vite output, not filename hashes.
// A source, dependency, minifier, or shared-chunk change invalidates the exception.
const trustedDynamicJavaScript = new Map([
  ["assets/index-DGMIY7HW.js", {
    kind: "vite-modulepreload",
    sha256: "f42ce464ec97023048c52222f58cf2ac10629ac33ba6ecb9b3e33731d3c5a0cb",
  }],
  ["assets/runtime-3_8-CzEJ90xh.js", {
    kind: "spine-runtime",
    sha256: "d8dada3bff06860689b4cc4ed4e2441f5d19af2c14a490a61864c0b82dd53b97",
  }],
  ["assets/runtime-4_0-D5dgLj7g.js", {
    kind: "spine-runtime",
    sha256: "535c8d280ef92489830ffdd6cc8df89fdff4811a93fae338b9973a15dadcb4b8",
  }],
  ["assets/runtime-4_1-DXYkxD30.js", {
    kind: "spine-runtime",
    sha256: "6ba6836b0115324c4e1072cb74200dca893c8dcb837b31df6cbc332f11cb9bbe",
  }],
  ["assets/runtime-4_2-B7F-RhOd.js", {
    kind: "spine-runtime",
    sha256: "47b660f777bacce408464cafeb1fdc3250fb76e0fba4d6be094e4e57f5dade31",
  }],
]);

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
  const type = attributes.find(({ name }) => name === "type")?.value.trim().toLowerCase();
  return !type || type === "module" || /^(?:application|text)\/(?:java|ecma)script$/.test(type);
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
        if (!["src", "href", "srcset", "action"].includes(name)) continue;
        const candidates = name === "srcset" ? srcsetUrls(canonicalUrl(value)) : [value];
        if (candidates.some(isExternalUrl)) occurrences.push(`${path}: ${name}=${value}`);
      }
      if (node.tagName === "script" && executableScript(attributes)) {
        occurrences.push(...externalJavaScriptTargets(`${path} inline script`, nodeText(node)));
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
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left);
    const right = staticString(node.right);
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

function isGlobalReference(expression, name) {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) return node.text === name;
  if (propertyName(node) !== name) return false;
  const receiver = unwrapExpression(propertyReceiver(node));
  return ts.isIdentifier(receiver) && ["globalThis", "self", "window"].includes(receiver.text);
}

function isNavigatorReference(expression, name) {
  const node = unwrapExpression(expression);
  if (propertyName(node) !== name) return false;
  const receiver = unwrapExpression(propertyReceiver(node));
  return ts.isIdentifier(receiver) && receiver.text === "navigator";
}

function referenceKey(expression) {
  const node = unwrapExpression(expression);
  if (ts.isIdentifier(node)) return `identifier:${node.text}`;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this";
  const receiver = propertyReceiver(node);
  const name = propertyName(node);
  if (!receiver || name === undefined) return undefined;
  const parent = referenceKey(receiver);
  return parent ? `${parent}.${name}` : undefined;
}

function isXmlHttpRequestConstruction(expression) {
  const node = unwrapExpression(expression);
  return ts.isNewExpression(node) && isGlobalReference(node.expression, "XMLHttpRequest");
}

function trustedJavaScript(path, contents) {
  const descriptor = trustedDynamicJavaScript.get(path);
  if (!descriptor) return undefined;
  const digest = createHash("sha256").update(contents).digest("hex");
  return digest === descriptor.sha256 ? descriptor : undefined;
}

function vitePreloadCallSignature(call) {
  if (call.arguments.length !== 2) return false;
  const url = unwrapExpression(call.arguments[0]);
  return propertyName(url) === "href" && ts.isIdentifier(unwrapExpression(call.arguments[1]));
}

function allowsTrustedDynamicTarget(trust, category, call) {
  if (trust?.kind === "spine-runtime") return true;
  return trust?.kind === "vite-modulepreload" && category === "fetch" && vitePreloadCallSignature(call);
}

function externalJavaScriptTargets(path, contents) {
  ensureAuditLength(contents, "JavaScript");
  const sourceFile = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const occurrences = [];
  const seen = new Set();
  const xhrReferences = new Set();
  const trust = trustedJavaScript(path, contents);

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

  const collectXhrReferences = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && isXmlHttpRequestConstruction(node.initializer)) {
      const key = referenceKey(node.name);
      if (key) xhrReferences.add(key);
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && isXmlHttpRequestConstruction(node.right)
    ) {
      const key = referenceKey(node.left);
      if (key) xhrReferences.add(key);
    }
    ts.forEachChild(node, collectXhrReferences);
  };
  collectXhrReferences(sourceFile);

  const auditNetworkArgument = (call, argument, category) => {
    if (!argument) {
      record(call, `${category} 缺少 URL 参数`);
      return;
    }
    const value = staticString(argument);
    if (value === undefined) {
      if (!allowsTrustedDynamicTarget(trust, category, call)) record(argument, `${category} 使用动态网络目标`);
      return;
    }
    if (!isSafeOfflineUrl(value)) record(argument, `${category} 使用外部 URL`);
  };

  const isXhrOpenCall = (call) => {
    if (propertyName(call.expression) !== "open") return false;
    const receiver = propertyReceiver(call.expression);
    if (!receiver) return false;
    if (isXmlHttpRequestConstruction(receiver)) return true;
    const key = referenceKey(receiver);
    if (key !== undefined && xhrReferences.has(key)) return true;
    const name = ts.isIdentifier(unwrapExpression(receiver))
      ? unwrapExpression(receiver).text
      : propertyName(receiver);
    return /^(?:xhr|xmlHttpRequest)$/i.test(name ?? "");
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const value = staticString(node.moduleSpecifier);
        if (value !== undefined && !isSafeOfflineUrl(value)) record(node.moduleSpecifier, "module 使用外部 URL");
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        auditNetworkArgument(node, node.arguments[0], "import()");
      } else if (isGlobalReference(node.expression, "fetch")) {
        auditNetworkArgument(node, node.arguments[0], "fetch");
      } else if (isGlobalReference(node.expression, "importScripts")) {
        for (const argument of node.arguments) auditNetworkArgument(node, argument, "importScripts");
      } else if (isGlobalReference(node.expression, "sendBeacon") || isNavigatorReference(node.expression, "sendBeacon")) {
        auditNetworkArgument(node, node.arguments[0], "sendBeacon");
      } else if (isXhrOpenCall(node)) {
        auditNetworkArgument(node, node.arguments[1], "XMLHttpRequest.open");
      }
    } else if (ts.isNewExpression(node)) {
      for (const constructor of ["Worker", "SharedWorker", "WebSocket", "EventSource"]) {
        if (!isGlobalReference(node.expression, constructor)) continue;
        const argument = node.arguments?.[0];
        if ((constructor === "Worker" || constructor === "SharedWorker") && argument) {
          const unwrapped = unwrapExpression(argument);
          if (ts.isNewExpression(unwrapped) && isGlobalReference(unwrapped.expression, "URL")) {
            auditNetworkArgument(node, unwrapped.arguments?.[0], constructor);
            break;
          }
        }
        auditNetworkArgument(node, argument, constructor);
        break;
      }
      if (isGlobalReference(node.expression, "URL")) {
        const value = node.arguments?.[0] ? staticString(node.arguments[0]) : undefined;
        if (value !== undefined && isExternalUrl(value)) record(node.arguments[0], "URL 使用外部目标");
      }
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ["src", "href"].includes(propertyName(node.left) ?? "")
    ) {
      const value = staticString(node.right);
      if (value !== undefined && isExternalUrl(value)) record(node.right, `${propertyName(node.left)} 使用外部 URL`);
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
