function contentPartText(part) {
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.output_text === "string") return part.output_text;
  if (typeof part.content === "string") return part.content;
  return "";
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map(contentPartText).filter(Boolean).join("\n");
}

function normalizeImageUrl(value) {
  return String(value ?? "").trim().replace(/^<|>$/g, "");
}

function imageInputsFromMessage(message) {
  if (!Array.isArray(message?.content)) return [];
  return message.content.flatMap((part) => {
    if (part?.type !== "image_url" && part?.type !== "input_image") return [];
    const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    const url = normalizeImageUrl(imageUrl);
    return url ? [{ url, detail: part.image_url?.detail ?? "auto" }] : [];
  });
}

function collectMarkdownImageUrls(text, output) {
  const source = String(text ?? "");
  const pattern = /!\[[^\]]*]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  for (const match of source.matchAll(pattern)) {
    const url = normalizeImageUrl(match[1] ?? match[2]);
    if (url) output.add(url);
  }
}

function collectMessageImageUrls(message, output) {
  imageInputsFromMessage(message).forEach(({ url }) => output.add(normalizeImageUrl(url)));
  collectMarkdownImageUrls(messageText(message), output);
}

function collectReplayedAssistantImageUrls(messages, latestUserIndex) {
  const urls = new Set();
  for (let index = 0; index < latestUserIndex; index += 1) {
    const message = messages[index];
    const role = String(message?.role ?? "").toLowerCase();
    if (role === "user" || role === "system" || role === "developer") continue;
    collectMessageImageUrls(message, urls);
  }
  return urls;
}

export function extractLatestUserImageContext(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role ?? "").toLowerCase() !== "user") continue;

    const replayedUrls = collectReplayedAssistantImageUrls(messages, index);
    const imageInputs = imageInputsFromMessage(message).filter(({ url }) => !replayedUrls.has(normalizeImageUrl(url)));
    return {
      imageInputs,
      userText: messageText(message).trim()
    };
  }

  return { imageInputs: [], userText: "" };
}
