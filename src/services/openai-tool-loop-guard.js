import { getToolFunction, getToolName } from "./openai-tool-policy.js";

export const IMAGE_GENERATION_TOOL_NAMES = Object.freeze(new Set([
  "draw",
  "redraw",
  "photo_tool",
  "inpaint",
  "character_reference",
  "comic_page",
  "vibe_transfer",
  "character_panel"
]));

function toStringSafe(value) {
  return value === null || value === undefined ? "" : String(value);
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    return typeof part.text === "string" ? part.text
      : typeof part.output_text === "string" ? part.output_text
        : typeof part.content === "string" ? part.content
          : "";
  }).filter(Boolean).join("\n");
}

function contentHasImage(content) {
  if (typeof content === "string") return /!\[[^\]]*]\(\s*(?:https?:\/\/|data:image\/)/i.test(content);
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    if (part.type !== "image_url" && part.type !== "input_image" && part.type !== "image") return false;
    const value = typeof part.image_url === "string" ? part.image_url
      : part.image_url?.url ?? part.url ?? part.image ?? part.source?.url;
    return Boolean(toStringSafe(value).trim());
  });
}

function latestUserMessageIndex(messages) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (toStringSafe(messages[index]?.role).toLowerCase() === "user") return index;
  }
  return -1;
}

function toolCallsFromAssistant(message) {
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.flatMap((call) => {
    const name = getToolName(call);
    const id = toStringSafe(call?.id).trim();
    return name ? [{ id, name }] : [];
  });
}

function toolResultLooksSuccessful(message) {
  const content = contentText(message?.content).trim();
  if (contentHasImage(message?.content)) return true;
  if (/图片已生成|图像已生成|生成成功|处理完成|任务已完成/i.test(content)) return true;
  if (!content) return false;
  return !/(?:^|\b)(?:error|failed|failure)(?:\b|:)|失败|错误|未生成|没有生成/i.test(content);
}

function toolResultTextMessages(messages = []) {
  return messages.filter((message) => {
    const role = toStringSafe(message?.role).toLowerCase();
    return role === "tool" || role === "function";
  }).map((message) => contentText(message?.content));
}

export function hasPendingJobContext(messages = []) {
  const results = toolResultTextMessages(messages);
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const content = results[index];
    if (!/(?:任务码|job[_ ]?id)\s*[:：]?\s*[A-Z0-9]{5}\b/i.test(content)) continue;
    if (/图片已生成|图像已生成|生成成功|处理完成|任务已完成|已经完成/i.test(content)) return false;
    return /还在画|正在生成|处理中|排队|pending|任务码/i.test(content);
  }
  return false;
}

export function completedToolNamesSinceLatestUser(messages = []) {
  const start = latestUserMessageIndex(messages);
  if (start < 0) return new Set();

  const callNamesById = new Map();
  const completed = new Set();
  for (let index = start + 1; index < messages.length; index += 1) {
    const message = messages[index];
    const role = toStringSafe(message?.role).toLowerCase();
    if (role === "assistant") {
      toolCallsFromAssistant(message).forEach(({ id, name }) => {
        if (id) callNamesById.set(id, name);
      });
      continue;
    }
    if ((role !== "tool" && role !== "function") || !toolResultLooksSuccessful(message)) continue;
    const linkedName = callNamesById.get(toStringSafe(message?.tool_call_id).trim());
    const name = toStringSafe(message?.name).trim() || linkedName || "";
    if (name) completed.add(name);
  }
  return completed;
}

export function blockedToolNamesForRequest(messages = []) {
  const completed = completedToolNamesSinceLatestUser(messages);
  const blocked = new Set(completed);
  if ([...completed].some((name) => IMAGE_GENERATION_TOOL_NAMES.has(name))) {
    IMAGE_GENERATION_TOOL_NAMES.forEach((name) => blocked.add(name));
    blocked.add("check_job");
  }
  return blocked;
}

export function filterToolsForRequest(tools = [], messages = []) {
  const blocked = blockedToolNamesForRequest(messages);
  const pendingJob = hasPendingJobContext(messages);
  return tools.filter((tool) => {
    const name = getToolName(tool);
    if (blocked.has(name)) return false;
    if (name === "check_job" && !pendingJob) return false;
    return true;
  });
}

export function limitImageGenerationCalls(calls = []) {
  let keptImageGeneration = false;
  return calls.filter((call) => {
    if (!IMAGE_GENERATION_TOOL_NAMES.has(toStringSafe(call?.name).trim())) return true;
    if (keptImageGeneration) return false;
    keptImageGeneration = true;
    return true;
  });
}
