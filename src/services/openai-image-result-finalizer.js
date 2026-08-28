import { latestAuthInputRequest } from "./openai-auth-result-finalizer.js";
import { IMAGE_GENERATION_TOOL_NAMES } from "./openai-tool-loop-guard.js";
import { getToolName } from "./openai-tool-policy.js";

const DIRECT_MIAOHUI_TOOL_NAMES = new Set([
  "login",
  "my_account",
  "draw",
  "redraw",
  "photo_tool",
  "find_style",
  "use_style",
  "settings",
  "upload_image",
  "check_job",
  "inpaint",
  "recharge",
  "character_reference",
  "comic_page",
  "character_save",
  "character_list",
  "character_forget",
  "vibe_transfer",
  "scene_save",
  "scene_list",
  "scene_use",
  "scene_forget",
  "character_panel"
]);

function toStringSafe(value) {
  return value === null || value === undefined ? "" : String(value);
}

function jsonText(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content && typeof content === "object" ? jsonText(content) : "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    return typeof part.text === "string" ? part.text
      : typeof part.output_text === "string" ? part.output_text
        : typeof part.content === "string" ? part.content
          : "";
  }).filter(Boolean).join("\n");
}

function redactSensitiveResult(value) {
  return String(value ?? "")
    .replace(/(["']?(?:token_2|password|passwd|pwd|access[_-]?token|authorization)["']?\s*[:=：]\s*["']?)([^\s"'},，。；;！？!?]+)/gi, "$1[已隐藏]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [已隐藏]");
}

function imageUrlFromPart(part) {
  if (!part || typeof part !== "object") return "";
  if (part.type !== "image_url" && part.type !== "input_image" && part.type !== "image") return "";
  const value = typeof part.image_url === "string" ? part.image_url
    : part.image_url?.url ?? part.url ?? part.image ?? part.source?.url;
  return toStringSafe(value).trim();
}

function extractImageUrls(content) {
  const urls = new Set();
  if (Array.isArray(content)) {
    content.forEach((part) => {
      const url = imageUrlFromPart(part);
      if (/^https?:\/\//i.test(url)) urls.add(url);
    });
  }

  const text = textFromContent(content);
  for (const match of text.matchAll(/!\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    const url = toStringSafe(match[1] ?? match[2]).trim();
    if (/^https?:\/\//i.test(url)) urls.add(url);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>"')]*)?/gi)) {
    urls.add(match[0]);
  }
  return [...urls];
}

function toolNameByCallId(messages, endIndex) {
  const names = new Map();
  for (let index = 0; index < endIndex; index += 1) {
    const message = messages[index];
    if (toStringSafe(message?.role).toLowerCase() !== "assistant" || !Array.isArray(message?.tool_calls)) continue;
    message.tool_calls.forEach((call) => {
      const id = toStringSafe(call?.id).trim();
      const name = getToolName(call);
      if (id && name) names.set(id, name);
    });
  }
  return names;
}

export function latestCompletedImageToolResult(messages = []) {
  let lastIndex = messages.length - 1;
  while (lastIndex >= 0 && !messages[lastIndex]) lastIndex -= 1;
  if (lastIndex < 0) return null;

  const message = messages[lastIndex];
  const role = toStringSafe(message?.role).toLowerCase();
  if (role !== "tool" && role !== "function") return null;

  const namesById = toolNameByCallId(messages, lastIndex);
  const name = toStringSafe(message?.name).trim()
    || namesById.get(toStringSafe(message?.tool_call_id).trim())
    || "";
  const imageUrls = extractImageUrls(message?.content);

  // Some clients omit both `name` and the preceding assistant tool-call turn.
  // Actual returned image URLs still prove that generation completed, so finish
  // directly instead of asking the model to invent a check_job call.
  if (imageUrls.length && (!name || IMAGE_GENERATION_TOOL_NAMES.has(name) || name === "check_job")) {
    return { name: name || "image_result", imageUrls };
  }

  if (!DIRECT_MIAOHUI_TOOL_NAMES.has(name)) return null;

  const authInputRequest = latestAuthInputRequest(messages);
  if (authInputRequest) return { name: "auth_input", imageUrls: [], content: authInputRequest };

  // A successful login is not the end of the user's request. Let the selected
  // model see it so it can resume the draw/save action that was blocked by auth.
  if (name === "login") return null;

  if (IMAGE_GENERATION_TOOL_NAMES.has(name) && imageUrls.length) return { name, imageUrls };

  const content = redactSensitiveResult(textFromContent(message?.content).trim());
  return { name, imageUrls: [], content: content || "工具已完成。" };
}

export function formatCompletedImageToolResult(result) {
  if (result?.content) return result.content;
  if (!result?.imageUrls?.length) return "";
  return ["已经完成。", "", ...result.imageUrls.map((url) => `![](${url})`)].join("\n");
}
