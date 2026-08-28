function latestMessageRole(messages = []) {
  return String(messages.at(-1)?.role ?? "").trim().toLowerCase();
}

function latestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role ?? "").trim().toLowerCase() !== "user") continue;
    if (typeof message?.content === "string") return message.content;
    if (Array.isArray(message?.content)) return message.content.map((part) => part?.text ?? part?.output_text ?? part?.content ?? "").filter(Boolean).join("\n");
    return "";
  }
  return "";
}

function clearlyRequestsToolAction(messages, tools) {
  const names = new Set((tools ?? []).map((tool) => String(tool?.function?.name ?? tool?.name ?? "").trim()).filter(Boolean));
  const value = latestUserText(messages).trim();
  if (!value) return false;

  if (names.has("draw") && /(?:画|生成|出|做|来)(?:一|二|两|三|四|\d+)?\s*张|(?:画|生成|出图|绘制|做图)/i.test(value)) return true;
  if ((names.has("redraw") || names.has("inpaint") || names.has("photo_tool")) && /(?:改|修改|重画|修|去背景|换表情|线稿|上色|水印)/i.test(value)) return true;
  if (names.has("login") && /(?:登录|登陆|这是密码|密码是|密码为)/i.test(value)) return true;
  if (names.has("my_account") && /(?:余额|账户|小鱼干|猫条|当前画风|当前画幅)/i.test(value)) return true;
  if (names.has("character_reference") && /(?:参考这张|用这张.*参考|保持.*角色|同一个角色)/i.test(value)) return true;
  if (names.has("use_style") && /(?:用画风|换成.*画风|选.*画风)/i.test(value)) return true;
  return false;
}

export function inferToolChoiceForRequest(messages, tools, suppliedChoice) {
  const role = latestMessageRole(messages);
  if (role === "tool" || role === "function") return "auto";
  if (suppliedChoice !== undefined && suppliedChoice !== null) return suppliedChoice;
  return clearlyRequestsToolAction(messages, tools) ? "required" : "auto";
}
