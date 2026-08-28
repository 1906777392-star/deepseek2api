import { AsyncLocalStorage } from "node:async_hooks";
import { getToolFunction, getToolName } from "./openai-tool-policy.js";

const contextStorage = new AsyncLocalStorage();
const AUTHENTICATED_TOOLS = new Set([
  "my_account", "draw", "redraw", "photo_tool", "find_style", "use_style", "settings",
  "upload_image", "check_job", "inpaint", "recharge", "character_reference", "comic_page",
  "character_save", "character_list", "character_forget", "vibe_transfer", "scene_save",
  "scene_list", "scene_use", "scene_forget", "character_panel", "view_image"
]);
const IMAGE_FIELD_BY_TOOL = Object.freeze({
  redraw: "image_2",
  photo_tool: "image_2",
  character_reference: "character_image",
  vibe_transfer: "reference_image",
  character_panel: "character"
});

function text(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => part?.text ?? part?.output_text ?? part?.content ?? "").filter(Boolean).join("\n");
}

function parseArguments(call) {
  try {
    const value = JSON.parse(call?.argumentsText || JSON.stringify(call?.input ?? {}));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (String(messages[index]?.role ?? "").toLowerCase() === "user") return text(messages[index]?.content).trim();
  }
  return "";
}

function toolNameByCallId(messages) {
  const names = new Map();
  for (const message of messages) {
    if (String(message?.role ?? "").toLowerCase() !== "assistant" || !Array.isArray(message?.tool_calls)) continue;
    for (const call of message.tool_calls) {
      const id = String(call?.id ?? "").trim();
      const name = getToolName(call);
      if (id && name) names.set(id, name);
    }
  }
  return names;
}

function rememberedValues(messages) {
  const names = toolNameByCallId(messages);
  let loginCode = "";
  let imageCode = "";

  for (const message of messages) {
    const role = String(message?.role ?? "").toLowerCase();
    if (role === "assistant" && Array.isArray(message?.tool_calls)) {
      for (const call of message.tool_calls) {
        const args = parseArguments({ argumentsText: call?.function?.arguments ?? call?.arguments });
        if (!loginCode) loginCode = String(args.token_2 ?? args.token ?? "").trim();
        if (!imageCode) imageCode = String(args.image_code ?? "").trim().toUpperCase();
      }
      continue;
    }
    if (role !== "tool" && role !== "function") continue;
    const body = text(message?.content);
    const name = String(message?.name ?? names.get(String(message?.tool_call_id ?? "").trim()) ?? "").trim();
    if (name === "login" || /登录成功|已登录|认证成功/i.test(body)) {
      const match = body.match(/登录码\s*[:：]\s*([A-Za-z0-9_-]{4,64})/i);
      if (match) loginCode = match[1];
    }
    const imageMatch = body.match(/(?:图片码|image[_ ]?code)\s*[:：]?\s*([A-Z0-9]{5})\b/i);
    if (imageMatch) imageCode = imageMatch[1].toUpperCase();
  }
  return { imageCode, loginCode };
}

function requestedCount(value) {
  const source = String(value || "");
  const digit = source.match(/(?:生成|画|做|出|来|要)?\s*([1-4])\s*张/);
  if (digit) return Number(digit[1]);
  const chinese = source.match(/(?:生成|画|做|出|来|要)?\s*([一二两三四])\s*张/);
  if (!chinese) return 0;
  return ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 })[chinese[1]] || 0;
}

function schemaProperties(tool) {
  return getToolFunction(tool)?.parameters?.properties ?? {};
}

export function runWithOpenAiToolContext(messages, callback) {
  return contextStorage.run({ messages: Array.isArray(messages) ? messages : [] }, callback);
}

export function recoverContextualToolArguments(calls = [], tools = []) {
  const messages = contextStorage.getStore()?.messages ?? [];
  if (!messages.length) return calls;
  const { imageCode, loginCode } = rememberedValues(messages);
  const count = requestedCount(latestUserText(messages));
  const toolByName = new Map(tools.map((tool) => [getToolName(tool), tool]).filter(([name]) => name));

  return calls.map((call) => {
    const name = String(call?.name ?? "").trim();
    const args = parseArguments(call);
    const properties = schemaProperties(toolByName.get(name));

    if (AUTHENTICATED_TOOLS.has(name) && loginCode) {
      if (Object.hasOwn(properties, "token_2") && isEmpty(args.token_2)) args.token_2 = loginCode;
      else if (Object.hasOwn(properties, "token") && isEmpty(args.token)) args.token = loginCode;
    }

    const imageField = IMAGE_FIELD_BY_TOOL[name];
    if (imageField && Object.hasOwn(properties, imageField) && isEmpty(args[imageField]) && imageCode) {
      args[imageField] = imageCode;
    }

    if (count && Object.hasOwn(properties, "count") && isEmpty(args.count)) args.count = count;

    return { ...call, argumentsText: JSON.stringify(args), input: args };
  });
}
