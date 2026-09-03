const maxAuditLength = 2 * 1024 * 1024;
const maxCanonicalizationPasses = 8;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codePoint(character) {
  const value = Number.parseInt(character, 16);
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(value);
}

function canonicalize(contents, decode, format) {
  if (contents.length > maxAuditLength) throw new Error(`${format} 审计输入超过 ${maxAuditLength} 字符限制。`);
  let canonical = contents;
  for (let pass = 0; pass < maxCanonicalizationPasses; pass += 1) {
    const decoded = decode(canonical);
    if (decoded.length > maxAuditLength) throw new Error(`${format} 规范化结果超过 ${maxAuditLength} 字符限制。`);
    if (decoded === canonical) return decoded;
    canonical = decoded;
  }
  throw new Error(`${format} 规范化在 ${maxCanonicalizationPasses} 轮后仍未稳定，已拒绝打包。`);
}

function decodeJavaScriptEscapes(contents) {
  return contents
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_match, braced, fixed, hex) => codePoint(braced ?? fixed ?? hex))
    .replace(/\\\//g, "/");
}

const htmlNamedEntities = new Map([
  ["amp", "&"], ["apos", "'"], ["colon", ":"], ["newline", "\n"], ["period", "."], ["sol", "/"], ["tab", "\t"],
]);

function decodeHtmlEntities(contents) {
  return contents.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?|&([a-z][a-z0-9]+);?/gi, (match, hex, decimal, named) => {
    if (hex) return codePoint(hex);
    if (decimal) return codePoint(Number.parseInt(decimal, 10).toString(16));
    return htmlNamedEntities.get(named.toLowerCase()) ?? match;
  });
}

function decodeCssEscapes(contents) {
  return contents.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([\s\S])/gi, (_match, hex, character) => hex ? codePoint(hex) : character);
}

function isExternalUrl(value) {
  return /^(?:https?:)?\/\//i.test(value.trim()) || /^wss:\/\//i.test(value.trim());
}

function htmlStartTagEnd(contents, start) {
  let quote = "";
  for (let index = start + 1; index < contents.length; index += 1) {
    const character = contents[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function htmlTagAttributes(tag) {
  const attributes = new Map();
  const attribute = /\b([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of tag.matchAll(attribute)) attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  return attributes;
}

function executableScript(attributes) {
  const type = attributes.get("type")?.trim().toLowerCase();
  return !type || type === "module" || /^(?:application|text)\/(?:java|ecma)script$/.test(type);
}

function externalHtmlAttributes(path, contents) {
  const occurrences = [];
  for (let start = 0; start < contents.length;) {
    const tagStart = contents.indexOf("<", start);
    if (tagStart < 0) break;
    if (contents.startsWith("<!--", tagStart)) {
      const commentEnd = contents.indexOf("-->", tagStart + 4);
      start = commentEnd < 0 ? contents.length : commentEnd + 3;
      continue;
    }
    const opening = /^<[A-Za-z][\w:-]*/.exec(contents.slice(tagStart));
    if (!opening) {
      start = tagStart + 1;
      continue;
    }
    const end = htmlStartTagEnd(contents, tagStart);
    if (end < 0) break;
    const tag = contents.slice(tagStart, end + 1);
    const tagName = opening[0].slice(1).toLowerCase();
    const attributes = htmlTagAttributes(tag);
    for (const [name, value] of attributes) {
      if (!["src", "href", "srcset", "action"].includes(name)) continue;
      const candidates = name === "srcset" ? value.split(",") : [value];
      if (candidates.some(isExternalUrl)) occurrences.push(`${path}: ${name}=${value}`);
    }
    start = end + 1;
    if (tagName === "script" || tagName === "style") {
      const closing = new RegExp(`</\\s*${escapeRegExp(tagName)}\\s*>`, "ig");
      closing.lastIndex = start;
      const close = closing.exec(contents);
      const bodyEnd = close?.index ?? contents.length;
      if (tagName === "script" && executableScript(attributes)) {
        occurrences.push(...externalJavaScriptTargets(`${path} inline script`, contents.slice(start, bodyEnd)));
      }
      start = close ? close.index + close[0].length : contents.length;
    }
  }
  return occurrences;
}

function externalJavaScriptTargets(path, contents) {
  const occurrences = [];
  const canonical = canonicalize(contents, decodeJavaScriptEscapes, "JavaScript");
  const record = (pattern) => {
    for (const match of canonical.matchAll(pattern)) occurrences.push(`${path}: ${match[0]}`);
  };
  record(/\bimport\s*\(\s*["'`](?:https?:)?\/\//gi);
  record(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](?:https?:)?\/\//gi);
  record(/\bimportScripts\s*\(\s*["'`](?:https?:)?\/\//gi);
  record(/\b(?:fetch|(?:window|self|globalThis)\s*\.\s*fetch)\s*\(\s*["'`](?:https?:)?\/\//gi);
  record(/\.\s*open\s*\(\s*["'][^"']*["']\s*,\s*["'`](?:https?:)?\/\//gi);
  record(/\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(?:new\s+URL\s*\(\s*)?["'`](?:https?:)?\/\//gi);
  record(/\bnew\s+(?:WebSocket|EventSource)\s*\(\s*["'`](?:(?:https?|wss?):)?\/\//gi);
  record(/\bnew\s+URL\s*\(\s*["'`](?:https?:)?\/\//gi);
  record(/\b(?:navigator\s*\.\s*)?sendBeacon\s*\(\s*["'`](?:https?:)?\/\//gi);
  record(/\.\s*(?:src|href)\s*=\s*["'`](?:https?:)?\/\//gi);
  record(/\b(?:import|importScripts|fetch|(?:window|self|globalThis)\s*\.\s*fetch|sendBeacon)\s*\(\s*`[^`]*\$\{/gi);
  record(/\.\s*open\s*\(\s*["'][^"']*["']\s*,\s*`[^`]*\$\{/gi);
  record(/\bnew\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(\s*`[^`]*\$\{/gi);
  for (const match of canonical.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+URL\s*\(\s*)?["'`](?:https?:)?\/\//gi)) {
    const name = match[1];
    const reference = escapeRegExp(name);
    const externalBindingUse = new RegExp([
      `\\b(?:fetch|(?:window|self|globalThis)\\s*\\.\\s*fetch|importScripts|sendBeacon)\\s*\\(\\s*${reference}\\b`,
      `\\bimport\\s*\\(\\s*${reference}\\b`,
      `\\bnew\\s+(?:Worker|SharedWorker|WebSocket|EventSource)\\s*\\(\\s*${reference}\\b`,
      `\\.\\s*open\\s*\\(\\s*["'][^"']*["']\\s*,\\s*${reference}\\b`,
    ].join("|"), "i");
    if (externalBindingUse.test(canonical)) occurrences.push(`${path}: 外部 URL 变量 ${name}`);
  }
  return occurrences;
}

export function externalRuntimeDependencies(path, contents) {
  if (path.endsWith(".html")) return externalHtmlAttributes(path, canonicalize(contents, decodeHtmlEntities, "HTML"));
  if (path.endsWith(".css")) {
    const occurrences = [];
    const canonical = canonicalize(contents, decodeCssEscapes, "CSS");
    for (const pattern of [/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi, /url\(\s*["']?(?:https?:)?\/\//gi]) {
      for (const match of canonical.matchAll(pattern)) occurrences.push(`${path}: ${match[0]}`);
    }
    return occurrences;
  }
  return path.endsWith(".js") ? externalJavaScriptTargets(path, contents) : [];
}
