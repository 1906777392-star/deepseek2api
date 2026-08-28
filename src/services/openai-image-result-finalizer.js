import { latestAuthInputRequest } from "./openai-auth-result-finalizer.js";
import { IMAGE_GENERATION_TOOL_NAMES } from "./openai-tool-loop-guard.js";
import { getToolName } from "./openai-tool-policy.js";

function toStringSafe(value) {
  return value === null || value === undefined ? "" : String(value);
}

function textFromContent(content) {
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

  const authInputRequest = latestAuthInputRequest(messages);
  if (authInputRequest) return { name: "auth_input", imageUrls: [], content: authInputRequest };

  const namesById = toolNameByCallId(messages, lastIndex);
  const name = toStringSafe(message?.name).trim()
    || namesById.get(toStringSafe(message?.tool_call_id).trim())
    || "";
  if (!IMAGE_GENERATION_TOOL_NAMES.has(name)) return null;

  const imageUrls = extractImageUrls(message?.content);
  if (!imageUrls.length) return null;
  return { name, imageUrls };
}

export function formatCompletedImageToolResult(result) {
  if (result?.content) return result.content;
  if (!result?.imageUrls?.length) return "";
  return ["已经完成。", "", ...result.imageUrls.map((url) => `![](${url})`)].join("\n");
}
