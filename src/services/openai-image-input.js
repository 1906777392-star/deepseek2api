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

function previousAssistantText(messages, latestUserIndex) {
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    if (String(messages[index]?.role ?? "").toLowerCase() !== "assistant") continue;
    return messageText(messages[index]).trim();
  }
  return "";
}

function requestsVisualInspection(messages, latestUserIndex, userText) {
  const text = String(userText ?? "").trim();
  if (/(?:看(?:看|一下|下|见|懂)?|查看|检查|比较|对比|分析|识别|判断|观察|构图|位置|动作|画面|图里|变了|变化|区别|差异|视觉)/i.test(text)) {
    return true;
  }

  if (!/^(?:你)?(?:试试|看吧|看看|可以|行|好|嗯|对)[吧啊呀。！!？?]*$/i.test(text)) {
    return false;
  }
  return /(?:view_image|看图|查看|检查|比较|对比|图片|画面|视觉)/i.test(previousAssistantText(messages, latestUserIndex));
}

export function extractLatestUserImageContext(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role ?? "").toLowerCase() !== "user") continue;

    const userText = messageText(message).trim();
    const replayedUrls = collectReplayedAssistantImageUrls(messages, index);
    const allowReplayedImages = requestsVisualInspection(messages, index, userText);
    const imageInputs = imageInputsFromMessage(message).filter(({ url }) => (
      allowReplayedImages || !replayedUrls.has(normalizeImageUrl(url))
    ));
    return { imageInputs, userText };
  }

  return { imageInputs: [], userText: "" };
}
