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

function forced(name) {
  return { type: "function", function: { name } };
}

export function inferToolChoiceForRequest(messages, tools, suppliedChoice) {
  if (suppliedChoice !== undefined && suppliedChoice !== null && suppliedChoice !== "auto") return suppliedChoice;

  const names = new Set((tools ?? []).map(getToolName).filter(Boolean));
  if (!names.size) return suppliedChoice;

  const userText = latestUserText(messages);
  const explicitToolRequest = /(?:调用|使用|用)(?:一下|下|这个|该|这些|那个)?\s*(?:mcp|MCP|工具)|(?:调用|使用)\s*(?:mcp|MCP)|(?:查一下|查查|查询一下|搜索一下|搜一下|联网查|上网查|核实一下|验证一下)/i.test(userText);
  if (explicitToolRequest) return "required";

  if (![...names].some((name) => IMAGE_GENERATION_TOOL_NAMES.has(name))) return suppliedChoice;

  const explicitImageAction = /(?:再来|再画|重画|重新画|生成|画一张|画张|出一张|换一张|改图|重绘|继续画)/i.test(userText);
  if (!explicitImageAction) return suppliedChoice;

  if (names.has("redraw") && /(?:重绘|改图|修改这张|只改|轻微改|重画这张)/i.test(userText)) return forced("redraw");
  if (names.has("character_reference") && /(?:同一角色|保持角色|保留角色|换动作|换场景|角色参考)/i.test(userText)) return forced("character_reference");

  if (names.has("draw")) return forced("draw");
  return "required";
}
