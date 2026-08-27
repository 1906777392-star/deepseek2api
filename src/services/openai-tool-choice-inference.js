import { IMAGE_GENERATION_TOOL_NAMES } from "./openai-tool-loop-guard.js";
import { getToolName } from "./openai-tool-policy.js";

function toText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part) => part?.text ?? part?.output_text ?? part?.content ?? "").filter(Boolean).join("\n");
}

function latestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (String(messages[index]?.role ?? "").toLowerCase() === "user") return toText(messages[index]).trim();
  }
  return "";
}

function latestMessageRole(messages = []) {
  return String(messages.at(-1)?.role ?? "").toLowerCase();
}

function forced(name) {
  return { type: "function", function: { name } };
}

function isSearchTool(name) {
  return /(?:search|web|browse|fetch|scrape|research|docs|github|联网|搜索|检索|查询)/i.test(name);
}

function isToolIntent(text) {
  return /(?:调用|使用|用)(?:一下|下|这个|该|这些|那个)?\s*(?:mcp|工具)|(?:调用|使用)\s*mcp|(?:查一下|查查|查询一下|搜索一下|搜一下|联网查|上网查|核实一下|验证一下)|(?:找|找找|找一下|推荐|推荐一下)(?:一些|几个|个|点|下)?[^。！？\n]{0,32}(?:mcp|工具|项目|服务|服务器)|(?:有哪些|有什么)(?:好玩|有趣|实用|值得用|推荐)?[^。！？\n]{0,24}(?:mcp|工具|项目|服务|服务器)|(?:find|search|browse|look\s*up|recommend|list)\s+(?:some|any|useful|fun)?\s*(?:mcp|tools?|servers?|projects?)/i.test(text);
}

function isImageIntent(text) {
  return /(?:再来|再画|重画|重新画|生成|画一张|画张|出一张|换一张|改图|重绘|继续画|draw|generate|redraw|edit\s+(?:the\s+)?image)/i.test(text);
}

export function inferToolChoiceForRequest(messages, tools, suppliedChoice) {
  // A tool result is a continuation of the already-started request. Some
  // clients resend tool_choice=required/forced on every loop iteration, so
  // this check must happen before accepting the supplied choice.
  const role = latestMessageRole(messages);
  if (role === "tool" || role === "function") return "auto";

  if (suppliedChoice !== undefined && suppliedChoice !== null && suppliedChoice !== "auto") return suppliedChoice;

  const names = [...new Set((tools ?? []).map(getToolName).filter(Boolean))];
  if (!names.length) return suppliedChoice;

  const userText = latestUserText(messages);
  if (isToolIntent(userText)) {
    const searchName = names.find(isSearchTool);
    return searchName ? forced(searchName) : "required";
  }

  if (!names.some((name) => IMAGE_GENERATION_TOOL_NAMES.has(name)) || !isImageIntent(userText)) return suppliedChoice;

  if (names.includes("redraw") && /(?:重绘|改图|修改这张|只改|轻微改|重画这张|redraw|edit)/i.test(userText)) return forced("redraw");
  if (names.includes("character_reference") && /(?:同一角色|保持角色|保留角色|换动作|换场景|角色参考|same character|new scene)/i.test(userText)) return forced("character_reference");
  if (names.includes("draw")) return forced("draw");
  return "required";
}
