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

function imageInputsFromMessage(message) {
  if (!Array.isArray(message?.content)) return [];
  return message.content.flatMap((part) => {
    if (part?.type !== "image_url") return [];
    const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    return imageUrl ? [{ url: imageUrl, detail: part.image_url?.detail ?? "auto" }] : [];
  });
}

export function extractLatestUserImageContext(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role ?? "").toLowerCase() !== "user") continue;
    return {
      imageInputs: imageInputsFromMessage(message),
      userText: messageText(message).trim()
    };
  }

  return { imageInputs: [], userText: "" };
}
