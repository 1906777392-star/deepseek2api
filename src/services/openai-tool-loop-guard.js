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
  const content = toStringSafe(message?.content).trim();
  if (!content) return false;
  return !/(?:^|\b)(?:error|failed|failure)(?:\b|:)|失败|错误|未生成|没有生成/i.test(content);
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
  }
  return blocked;
}

export function filterToolsForRequest(tools = [], messages = []) {
  const blocked = blockedToolNamesForRequest(messages);
  if (!blocked.size) return tools;
  return tools.filter((tool) => !blocked.has(getToolName(tool)));
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
