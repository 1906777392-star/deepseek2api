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

function availableToolNames(tools) {
  return new Set((tools ?? []).map((tool) => String(tool?.function?.name ?? tool?.name ?? "").trim()).filter(Boolean));
}

function forcedTool(name) {
  return { type: "function", function: { name } };
}

function inferExplicitTool(messages, tools) {
  const names = availableToolNames(tools);
  const value = latestUserText(messages).trim();
  if (!value) return null;

  if (names.has("login") && /(?:登录|登陆|这是密码|密码是|密码为)/i.test(value)) return forcedTool("login");
  if (names.has("my_account") && /(?:余额|账户|小鱼干|猫条|当前画风|当前画幅)/i.test(value)) return forcedTool("my_account");
  if (names.has("character_reference") && /(?:参考这张|用这张.*参考|保持.*角色|同一个角色)/i.test(value)) return forcedTool("character_reference");
  if (names.has("use_style") && /(?:用画风|换成.*画风|选.*画风)/i.test(value)) return forcedTool("use_style");
  if (names.has("redraw") && /(?:改这张|修改这张|重画这张|还是这张)/i.test(value)) return forcedTool("redraw");
  if (names.has("inpaint") && /(?:只改|局部重绘|涂过|涂抹区域)/i.test(value)) return forcedTool("inpaint");
  if (names.has("photo_tool") && /(?:去背景|换表情|转线稿|线稿上色|去文字水印|去水印)/i.test(value)) return forcedTool("photo_tool");
  if (names.has("draw") && /(?:画|生成|出|做|来)(?:一|二|两|三|四|\d+)?\s*张|(?:画|生成|出图|绘制|做图)/i.test(value)) return forcedTool("draw");
  return null;
}

export function inferToolChoiceForRequest(messages, tools, suppliedChoice) {
  const role = latestMessageRole(messages);
  if (role === "tool" || role === "function") return "auto";
  if (suppliedChoice !== undefined && suppliedChoice !== null) return suppliedChoice;
  return inferExplicitTool(messages, tools) ?? "auto";
}
