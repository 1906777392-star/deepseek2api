import { randomUUID } from "node:crypto";

const TOOL_BLOCK_PATTERN = /<(?:[a-z0-9_:-]+:)?(tool_call|function_call|invoke)\b([^>]*)>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/gi;
const TOOL_SELFCLOSE_PATTERN = /<(?:[a-z0-9_:-]+:)?invoke\b([^>]*)\/>/gi;
const TOOL_KV_PATTERN = /<(?:[a-z0-9_:-]+:)?([a-z0-9_.-]+)\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?\1>/gi;
const TOOL_NAME_PATTERNS = Object.freeze([
  /<(?:[a-z0-9_:-]+:)?tool_name\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?tool_name>/i,
  /<(?:[a-z0-9_:-]+:)?function_name\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?function_name>/i,
  /<(?:[a-z0-9_:-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?name>/i,
  /<(?:[a-z0-9_:-]+:)?function\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?function>/i
]);
const TOOL_ARGS_PATTERNS = Object.freeze([
  /<(?:[a-z0-9_:-]+:)?input\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?input>/i,
  /<(?:[a-z0-9_:-]+:)?arguments\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?arguments>/i,
  /<(?:[a-z0-9_:-]+:)?argument\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?argument>/i,
  /<(?:[a-z0-9_:-]+:)?parameters\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?parameters>/i,
  /<(?:[a-z0-9_:-]+:)?parameter\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?parameter>/i,
  /<(?:[a-z0-9_:-]+:)?args\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?args>/i,
  /<(?:[a-z0-9_:-]+:)?params\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_:-]+:)?params>/i
]);
const TOOL_ATTR_PATTERN = /(name|function|tool)\s*=\s*"([^"]+)"/i;

function toStringSafe(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function stripFencedCodeBlocks(text) {
  return toStringSafe(text).replace(/```[\s\S]*?```/g, " ");
}

function decodeXmlText(text) {
  const raw = toStringSafe(text).trim();
  const cdataMatch = raw.match(/^<!\[CDATA\[([\s\S]*?)]]>$/i);
  const source = cdataMatch?.[1] ?? raw;
  return source
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&#x27;", "'");
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function findTagValue(text, patterns) {
  const source = toStringSafe(text);

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1] !== undefined) {
      return decodeXmlText(match[1]);
    }
  }

  return "";
}

function appendMarkupValue(output, key, value) {
  if (!Object.hasOwn(output, key)) {
    output[key] = value;
    return;
  }

  const current = output[key];
  output[key] = Array.isArray(current) ? [...current, value] : [current, value];
}

function parseMarkupValue(raw) {
  const text = decodeXmlText(raw);

  if (!text.trim()) {
    return "";
  }

  if (text.includes("<") && text.includes(">")) {
    const nested = parseMarkupInput(text);
    if (nested && Object.keys(nested).length > 0) {
      return nested;
    }
  }

  const parsedJson = parseJsonObject(text);
  if (parsedJson) {
    return parsedJson;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseMarkupObject(text) {
  const output = {};

  for (const match of toStringSafe(text).matchAll(TOOL_KV_PATTERN)) {
    const key = toStringSafe(match[1]).trim();
    if (!key) {
      continue;
    }

    appendMarkupValue(output, key, parseMarkupValue(match[2]));
  }

  return output;
}

function parseMarkupInput(raw) {
  const text = decodeXmlText(raw);
  const markupObject = parseMarkupObject(text);

  if (Object.keys(markupObject).length > 0) {
    return markupObject;
  }

  return parseJsonObject(text) ?? {};
}

function normalizeJsonArguments(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "{}";
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return "{}";
}

function buildParsedToolCall(name, argumentsText) {
  const normalizedArguments = argumentsText.trim() ? argumentsText.trim() : "{}";
  return {
    id: `call_${randomUUID().replaceAll("-", "")}`,
    name,
    argumentsText: normalizedArguments,
    input: parseJsonObject(normalizedArguments) ?? parseMarkupInput(normalizedArguments)
  };
}

function parseMarkupBlock(attrs, inner) {
  const jsonTool = parseJsonObject(inner);
  const jsonName = toStringSafe(
    jsonTool?.name ?? jsonTool?.tool_name ?? jsonTool?.function_name ?? jsonTool?.function?.name
  ).trim();
  const usesAliasName = Boolean(jsonName && !jsonTool?.name && !jsonTool?.function?.name);
  const hasExplicitArguments = Boolean(jsonTool && (
    ["input", "arguments", "parameters", "args"].some((key) => Object.hasOwn(jsonTool, key)) ||
    (jsonTool.function && Object.hasOwn(jsonTool.function, "arguments"))
  ));
  if (jsonName && (!usesAliasName || hasExplicitArguments)) {
    const jsonArguments = jsonTool?.input ?? jsonTool?.arguments ?? jsonTool?.parameters ??
      jsonTool?.args ?? jsonTool?.function?.arguments ?? {};
    return buildParsedToolCall(jsonName, normalizeJsonArguments(jsonArguments));
  }

  const attrName = attrs.match(TOOL_ATTR_PATTERN)?.[2] ?? "";
  const name = attrName.trim() || findTagValue(inner, TOOL_NAME_PATTERNS).trim();
  if (!name) {
    return null;
  }

  const argsRaw = findTagValue(inner, TOOL_ARGS_PATTERNS);
  const parsedInput = argsRaw ? parseMarkupInput(argsRaw) : parseMarkupObject(inner);
  const argumentsText = JSON.stringify(parsedInput && Object.keys(parsedInput).length ? parsedInput : {});
  return buildParsedToolCall(name, argumentsText);
}

function parseMarkupToolCalls(text) {
  const output = [];
  const source = toStringSafe(text).trim();

  for (const match of source.matchAll(TOOL_BLOCK_PATTERN)) {
    const parsed = parseMarkupBlock(toStringSafe(match[2]).trim(), toStringSafe(match[3]).trim());
    if (parsed) {
      output.push(parsed);
    }
  }

  for (const match of source.matchAll(TOOL_SELFCLOSE_PATTERN)) {
    const parsed = parseMarkupBlock(toStringSafe(match[1]).trim(), "");
    if (parsed) {
      output.push(parsed);
    }
  }

  return output;
}

function filterAllowedToolCalls(calls, allowedToolNames) {
  if (!allowedToolNames?.length) {
    return calls;
  }

  const allowed = new Set(allowedToolNames.map((name) => toStringSafe(name).trim()).filter(Boolean));
  return calls.filter((call) => allowed.has(call.name));
}

export function parseToolCallsFromText(text, allowedToolNames = []) {
  const source = toStringSafe(text);
  if (!source.trim()) {
    return [];
  }

  if (!stripFencedCodeBlocks(source).match(/<(tool_calls|tool_call|function_call|invoke|tool_use)\b/i)) {
    return [];
  }

  return filterAllowedToolCalls(parseMarkupToolCalls(source), allowedToolNames);
}
