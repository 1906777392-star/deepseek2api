const AUTHENTICATED_TOOL_NAMES = new Set([
  "login",
  "draw",
  "redraw",
  "photo_tool",
  "inpaint",
  "character_reference",
  "comic_page",
  "vibe_transfer",
  "character_panel"
]);

function toStringSafe(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof part.text === "string" ? part.text
        : typeof part.output_text === "string" ? part.output_text
          : typeof part.content === "string" ? part.content
            : "";
    }).filter(Boolean).join("\n");
  }
  return toStringSafe(content);
}

function toolNameForResult(messages, resultIndex) {
  const result = messages[resultIndex];
  const explicitName = toStringSafe(result?.name).trim();
  if (explicitName) return explicitName;
  const callId = toStringSafe(result?.tool_call_id).trim();
  if (!callId) return "";

  for (let index = resultIndex - 1; index >= 0; index -= 1) {
    const calls = messages[index]?.tool_calls;
    if (!Array.isArray(calls)) continue;
    const call = calls.find((item) => toStringSafe(item?.id).trim() === callId);
    const name = toStringSafe(call?.function?.name ?? call?.name).trim();
    if (name) return name;
  }
  return "";
}

function asksFor(value, text) {
  const request = new RegExp(`(?:请|需要|缺少|还缺|必须|填入|提供|发来|发给)[^。；;！!？?]{0,32}${value}|${value}[^。；;！!？?]{0,32}(?:填入|提供|发来|发给|才能|需要|必填)`, "i");
  return request.test(text);
}

export function latestAuthInputRequest(messages = []) {
  let lastIndex = messages.length - 1;
  while (lastIndex >= 0 && !messages[lastIndex]) lastIndex -= 1;
  if (lastIndex < 0) return null;

  const message = messages[lastIndex];
  const role = toStringSafe(message?.role).trim().toLowerCase();
  if (role !== "tool" && role !== "function") return null;

  const toolName = toolNameForResult(messages, lastIndex);
  if (!AUTHENTICATED_TOOL_NAMES.has(toolName)) return null;

  const text = textFromContent(message?.content).trim();
  if (!text || /登录成功|已登录|认证成功/i.test(text)) return null;

  const needsInviteCode = asksFor("邀请码", text);
  const needsLoginCode = asksFor("登录码", text);
  const needsPassword = asksFor("密码", text) || /还没有登录|尚未登录|未登录/i.test(text);

  if (needsInviteCode) {
    return "还缺邀请码。把邀请码发给我，我会接着完成登录。";
  }
  if (needsLoginCode) {
    return "还没有登录。把喵绘密码发给我；如果你已经有登录码，也可以直接发登录码。";
  }
  if (needsPassword) {
    return "还没有登录。把喵绘密码发给我，我会先登录再继续刚才的操作。";
  }
  return null;
}
